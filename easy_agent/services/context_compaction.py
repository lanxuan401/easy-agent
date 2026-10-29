"""手动压缩编排：校验、会话互斥、摘要适配与 checkpoint 保存。"""
from __future__ import annotations

import asyncio
import logging
from types import SimpleNamespace

from fastapi import HTTPException

from easy_agent.agent.manual_compaction import CompactionBusyError, CompactionError, compact_checkpoint
from easy_agent.services.agent_manager import (
    get_agent_config, get_cached_session_agent, get_or_create_agent_for_session,
    get_session_expert, is_session_streaming,
)
from easy_agent.services.session_guard import reserve_session
from easy_agent.services.session_runtime import SessionBusyError, acquire_stream, release_stream
from easy_agent.services.session_thread import session_thread_active, session_thread_in_use

logger = logging.getLogger(__name__)
COMPACTION_TIMEOUT_SECONDS = 300


def compaction_supported() -> bool:
    config = get_agent_config() or {}
    return session_thread_in_use(config) and bool(
        getattr(getattr(config.get("config"), "summarization", None), "enabled", True)
    )


async def compact_session(repo, session_id: str, username: str, model: str | None = None) -> dict:
    # 归属校验必须早于状态读取、Agent 创建和锁操作。
    session = repo.get_owned_session(session_id, username)
    if not compaction_supported():
        raise HTTPException(400, "当前未启用会话级上下文压缩，暂不支持手动压缩")
    lease = reserve_session(session_id)
    db_locked = False
    try:
        if is_session_streaming(session_id):
            raise HTTPException(409, "本会话正在生成回复，请稍后重试")
        # 与聊天共用 DB 流锁。压缩期间也拒绝其他实例上的生成。
        acquire_stream(repo.database, session_id)
        db_locked = True
        # 持锁后重新读取审批状态，兼容旧 thread 上遗留的审批。
        session = repo.get_owned_session(session_id, username)
        last = (session.messages or [{}])[-1]
        if last.get("pending_approval") or any(
            item.get("approval_status") == "pending"
            for item in [*(last.get("tool_calls") or []), *(last.get("blocks") or [])]
        ):
            raise HTTPException(409, "当前会话等待审批，请先处理审批后再压缩")
        async with asyncio.timeout(COMPACTION_TIMEOUT_SECONDS):
            agent = get_cached_session_agent(session_id)
            if agent is None:
                agent = await get_or_create_agent_for_session(
                    session_id, username, session.workspace_name or "", model_name=model,
                    expert_agent_id=get_session_expert(session_id),
                )
            if not session_thread_active(agent):
                raise HTTPException(400, "当前使用旧 thread 模式，暂不支持手动压缩")
            backend = agent._build_backend(["/skills/builtin/", "/user-skills/"])
            summary_agent = agent
            if model and model != getattr(agent, "model_name", model):
                from easy_agent.agent.model import create_model

                # 只切换本次摘要的模型，保留缓存代理的专家提示词、联网与工具装配。
                summary_agent = SimpleNamespace(
                    agent=agent.agent, config=agent.config,
                    model=create_model(agent.config, model_name=model, session_id=session_id),
                    model_name=model, max_steps=agent.max_steps,
                    system_prompt=getattr(agent, "system_prompt", ""),
                    context_agent=agent,
                )
            report = {"after_message_index": len(session.messages or []) - 1}
            changed = await compact_checkpoint(summary_agent, session_id, backend, report=report, history=session.messages or [])
        return {
            "session_id": session_id,
            "status": "compacted" if changed else "skipped",
            "message": report.get("message") or ("已压缩" if changed else "当前无需压缩"),
            "compaction": report if "context_tokens" in report or changed else None,
            "reason": report.get("reason"),
        }
    except (SessionBusyError, CompactionBusyError) as exc:
        raise HTTPException(409, str(exc)) from exc
    except HTTPException:
        raise
    except TimeoutError as exc:
        raise HTTPException(504, "上下文压缩超时，请重试") from exc
    except CompactionError as exc:
        raise HTTPException(500, str(exc)) from exc
    except Exception as exc:
        logger.exception("手动压缩失败 | session=%s", session_id)
        raise HTTPException(500, "上下文压缩失败，请重试") from exc
    finally:
        try:
            if db_locked:
                release_stream(repo.database, session_id)
        finally:
            lease.release()


async def compaction_messages(session_id: str, messages: list[dict]) -> list[dict]:
    """归属校验后读取展示投影；不构建 Agent，不改数据库消息或 usage。"""
    if not compaction_supported():
        return messages
    from easy_agent.persistence.checkpoints import get_session_checkpointer

    try:
        saver = get_session_checkpointer(session_id)
        saved = await saver.aget_tuple({"configurable": {"thread_id": session_id}})
        records = (saved.checkpoint.get("channel_values") or {}).get("context_compactions", []) if saved else []
        projected = [dict(message) for message in messages]
        for record in records:
            index = record.get("after_message_index", -1)
            if 0 <= index < len(projected):
                projected[index].setdefault("context_compactions", []).append(record)
        return projected
    except Exception:
        logger.warning("读取压缩展示记录失败 | session=%s", session_id, exc_info=True)
        return messages
