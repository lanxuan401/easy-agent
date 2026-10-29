"""合并后压缩回归：真实图、SQLite 持久化及下一轮复用，不调用在线模型。"""
from types import SimpleNamespace

import pytest
from deepagents import create_deep_agent
from deepagents.backends import FilesystemBackend
from langchain_core.messages import AIMessage, HumanMessage
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver

from easy_agent.agent.manual_compaction import compact_checkpoint
from easy_agent.agent.summarization import build_summarization_middleware
from easy_agent.bootstrap.config import Config
from easy_agent.services.session_thread import plan_turn
from tests.agent.test_turn_context import Recorder


def build(root, saver):
    config = Config.from_yaml(Config.resolve_config_path())
    config.llm.context_length = 8192
    config.models = {}
    config.summarization.coverage_enabled = False
    config.summarization.snapshot_enabled = False
    config.agent.session_thread = True
    model = Recorder()
    backend = FilesystemBackend(root_dir=root, virtual_mode=True)
    summ = build_summarization_middleware(config, model, backend)
    graph = create_deep_agent(model=model, backend=backend, middleware=[summ], checkpointer=saver)
    return SimpleNamespace(config=config, model=model, model_name=None, agent=graph, max_steps=5), backend


def history():
    return [
        {"role": role, "content": f"turn {i} " + "history detail " * 250}
        for i in range(8) for role in ("user", "assistant")
    ]


async def test_manual_compaction_reopens_and_next_turn_uses_summary(tmp_path):
    rows = history()
    checkpoint = str(tmp_path / "checkpoint.db")
    async with AsyncSqliteSaver.from_conn_string(checkpoint) as saver:
        agent, backend = build(tmp_path, saver)
        report = {"after_message_index": len(rows) - 1}
        assert await compact_checkpoint(agent, "s", backend, history=rows, report=report)
        assert report["status"] == "compacted"
        assert report["context_tokens"] < report["before_tokens"]
        assert agent.model.of("summary")
        assert not agent.model.of("agent")
        before = await agent.agent.aget_state({"configurable": {"thread_id": "s"}})
        assert len(before.values["messages"]) == len(rows)
        assert not before.next
    async with AsyncSqliteSaver.from_conn_string(checkpoint) as saver:
        agent, backend = build(tmp_path, saver)
        restored = await agent.agent.aget_state({"configurable": {"thread_id": "s"}})
        assert restored.values["_summarization_event"] == before.values["_summarization_event"]
        assert restored.values["context_compactions"] == [report]
        repeated = {"after_message_index": len(rows) - 1}
        assert not await compact_checkpoint(agent, "s", backend, history=rows, report=repeated)
        assert repeated["reason"] == "already_compacted"
        assert not agent.model.calls
        plan = await plan_turn(agent, session_id="s", turn_id="next", history=rows, raw="continue")
        assert plan.mode == "continue"
        await agent.agent.ainvoke({"messages": plan.messages}, {"configurable": {"thread_id": "s"}})
        assert "SUMMARY" in str(agent.model.of("agent"))


async def test_recent_only_skips_without_calling_model(tmp_path):
    async with AsyncSqliteSaver.from_conn_string(str(tmp_path / "checkpoint.db")) as saver:
        agent, backend = build(tmp_path, saver)
        report = {"after_message_index": 1}
        rows = [{"role": "user", "content": "hello"}, {"role": "assistant", "content": "hi"}]
        assert not await compact_checkpoint(agent, "s", backend, history=rows, report=report)
        assert report["reason"] == "recent_only"
        assert not agent.model.calls


async def test_summary_failure_does_not_commit_hydrated_history(tmp_path, monkeypatch):
    from easy_agent.agent.history_summarizer import HistorySummarizer

    async def fail(*args, **kwargs):
        raise ValueError("summary failed")

    monkeypatch.setattr(HistorySummarizer, "ainvoke", fail)
    async with AsyncSqliteSaver.from_conn_string(str(tmp_path / "checkpoint.db")) as saver:
        agent, backend = build(tmp_path, saver)
        with pytest.raises(ValueError, match="summary failed"):
            await compact_checkpoint(agent, "s", backend, history=history(), report={})
        saved = await agent.agent.aget_state({"configurable": {"thread_id": "s"}})
        assert not saved.values
        assert not agent.model.of("agent")


async def test_automatic_compaction_preserves_raw_history(tmp_path):
    async with AsyncSqliteSaver.from_conn_string(str(tmp_path / "checkpoint.db")) as saver:
        agent, _ = build(tmp_path, saver)
        messages = [HumanMessage(row["content"]) if row["role"] == "user" else AIMessage(row["content"])
                    for row in history()]
        await agent.agent.ainvoke({"messages": messages}, {"configurable": {"thread_id": "auto"}})
        saved = await agent.agent.aget_state({"configurable": {"thread_id": "auto"}})
        assert saved.values["_summarization_event"]["compaction_mode"] == "automatic"
        assert len(saved.values["messages"]) >= len(messages)
        assert agent.model.of("summary")
        assert "SUMMARY" in str(agent.model.of("agent"))
