"""手动压缩接口的认证、归属与会话互斥回归。"""
from types import SimpleNamespace

import pytest

from easy_agent.services import context_compaction as compact
from easy_agent.services.session_guard import reserve_session


@pytest.fixture
def compaction_agent(monkeypatch):
    calls = []
    monkeypatch.setattr(compact, "compaction_supported", lambda: True)
    monkeypatch.setattr(compact, "is_session_streaming", lambda sid: False)
    monkeypatch.setattr(compact, "session_thread_active", lambda agent: True)
    monkeypatch.setattr(compact, "get_cached_session_agent", lambda sid: SimpleNamespace(
        model_name="chosen", _build_backend=lambda paths: object(),
    ))

    async def run(agent, sid, backend, *, report, history):
        calls.append(sid)
        report.update(context_tokens=100, context_length=8192, status="compacted", id="compact-1")
        return True

    monkeypatch.setattr(compact, "compact_checkpoint", run)
    return calls


def session(client):
    result = client.post("/agent/sessions", json={"title": "compact regression"})
    assert result.status_code == 200
    return result.json()["session_id"]


def test_compact_releases_lock_for_next_request(client, compaction_agent):
    sid = session(client)
    for _ in range(2):
        result = client.post(f"/agent/sessions/{sid}/context/compact", json={"model": "chosen"})
        assert result.status_code == 200, result.text
        assert result.json()["status"] == "compacted"
    assert compaction_agent == [sid, sid]


def test_chat_lease_blocks_compact(client, compaction_agent):
    sid = session(client)
    lease = reserve_session(sid)
    try:
        assert client.post(f"/agent/sessions/{sid}/context/compact", json={}).status_code == 409
        assert not compaction_agent
    finally:
        lease.release()


def test_pending_approval_blocks_compact(client, db, compaction_agent):
    sid = session(client)
    db.add_message(sid, {"role": "assistant", "content": "approval", "pending_approval": {"thread_id": "t"}})
    assert client.post(f"/agent/sessions/{sid}/context/compact", json={}).status_code == 409
    assert not compaction_agent


def test_ownership_checked_before_capability_or_agent(client, monkeypatch):
    sid = session(client)
    from easy_agent.app import app
    from easy_agent.middleware import get_current_username

    app.dependency_overrides[get_current_username] = lambda: "another-user"

    def unexpected():
        pytest.fail("must reject ownership before inspecting capability")

    monkeypatch.setattr(compact, "compaction_supported", unexpected)
    assert client.post(f"/agent/sessions/{sid}/context/compact", json={}).status_code in (403, 404)


def test_compact_requires_jwt(auth_client):
    assert auth_client.post("/agent/sessions/missing/context/compact", json={}).status_code == 401


def test_failed_summary_releases_lock(client, compaction_agent, monkeypatch):
    sid = session(client)

    async def fail(*args, **kwargs):
        raise compact.CompactionError("summary failed")

    monkeypatch.setattr(compact, "compact_checkpoint", fail)
    for _ in range(2):
        result = client.post(f"/agent/sessions/{sid}/context/compact", json={})
        assert result.status_code == 500
        assert result.json()["detail"] == "summary failed"
