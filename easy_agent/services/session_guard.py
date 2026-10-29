"""会话写入互斥：HTTP 准备和后台 SSE 共用同一租约。"""
from __future__ import annotations

from fastapi import HTTPException

from easy_agent.services.session_runtime import SessionBusyError, acquire_stream, release_stream

_leases: dict[str, SessionLease] = {}


class SessionLease:
    def __init__(self, session_id: str):
        self.session_id = session_id
        self.references = 1
        self.database = None

    def retain(self):
        self.references += 1
        return self

    def release(self):
        self.references -= 1
        if self.references == 0 and _leases.get(self.session_id) is self:
            try:
                if self.database is not None:
                    release_stream(self.database, self.session_id)
            finally:
                del _leases[self.session_id]


def reserve_session(session_id: str) -> SessionLease:
    # 检查与登记间没有 await。同一事件循环原子执行，跨实例由 DB 锁保护。
    if session_id in _leases:
        raise HTTPException(409, "本会话正在生成回复或压缩上下文，请稍后重试")
    lease = SessionLease(session_id)
    _leases[session_id] = lease
    return lease


class ChatSessionGuard:
    def __init__(self):
        self.lease = None

    def acquire(self, database, session_id):
        self.lease = reserve_session(session_id)
        try:
            acquire_stream(database, session_id)
            self.lease.database = database
        except SessionBusyError as exc:
            raise HTTPException(409, str(exc)) from exc


async def guard_chat_session():
    guard = ChatSessionGuard()
    try:
        yield guard
    finally:
        if guard.lease is not None:
            guard.lease.release()
