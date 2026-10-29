"""当前 DeepAgents 摘要私有 API 的集中适配层；不执行 agent 主模型。"""
from __future__ import annotations

from collections.abc import Mapping
from datetime import UTC, datetime
from uuid import uuid4

from deepagents.middleware.filesystem import FilesystemMiddleware
from deepagents.middleware.memory import MemoryMiddleware
from deepagents.middleware.skills import SkillsMiddleware
from langchain.agents.middleware.types import ModelRequest
from langgraph.runtime import Runtime

from easy_agent.agent.context_estimation import estimate_context_tokens  # noqa: F401 - compatibility re-export
from easy_agent.agent.context_estimation import calibrated_context_tokens, model_identity

from easy_agent.agent.compaction_observability import (
    compaction_context, public_summary_report, apersist_summary_report,
)
from easy_agent.agent.model import resolve_context_length
from easy_agent.agent.run_config import build_run_config
from easy_agent.agent.summarization import build_summarization_middleware
from easy_agent.services.hitl_state import pending_hitl_interrupts
from easy_agent.services.stream_messages import build_context_messages, history_turn_id


class CompactionError(RuntimeError):
    pass


class CompactionBusyError(CompactionError):
    pass


def _compiled_tools(graph, fallback=()) -> list:
    """Include framework-injected tools as well as configured MCP/application tools.

    ToolNode's registry is private; keep the compatibility access in this adapter.
    Runtime capability/skill filtering can still change the next request's tools.
    """
    nodes = getattr(graph, "nodes", None)
    tool_node = nodes.get("tools") if isinstance(nodes, Mapping) else None
    bound = getattr(tool_node, "bound", None)
    tools_by_name = getattr(bound, "_tools_by_name", None)
    if isinstance(tools_by_name, Mapping):
        return list(tools_by_name.values())
    return list(fallback or ())


async def _estimate_request(agent, backend, values: dict, tools) -> ModelRequest:
    """Render read-only prompt fragments and filter tools as for a new turn.

    Fresh loads happen in a local state dict only: no model, tool, or graph is run.
    Transient turn_context from the previous turn is deliberately not reused.
    """
    source = getattr(agent, "context_agent", agent)
    state = dict(values)
    request = ModelRequest(
        model=agent.model, messages=[], tools=tools,
        system_prompt=getattr(agent, "system_prompt", ""),
        state=state, runtime=Runtime(context=getattr(source, "session_context", None)),
    )
    # No wrapper invocation: that could offload large messages or proceed to a model.
    filesystem = FilesystemMiddleware(backend=backend)
    request = filesystem._filter_unsupported_tools_and_apply_prompt(request)
    resolve_skills = getattr(source, "_resolve_skills_paths", None)
    skills_paths = resolve_skills() if resolve_skills else []
    if skills_paths:
        skills = SkillsMiddleware(backend=backend, sources=skills_paths)
        state.update(await skills.abefore_agent({"skills_metadata": None}, request.runtime, {}) or {})
        request = skills.modify_request(request)
    resolve_memory = getattr(source, "_memory_sources", None)
    memory_sources = resolve_memory() if resolve_memory else list((state.get("memory_contents") or {}).keys())
    if memory_sources:
        memory = MemoryMiddleware(backend=backend, sources=memory_sources)
        if resolve_memory:
            state.update(await memory.abefore_agent({}, request.runtime, {}) or {})
        request = memory.modify_request(request)
    return request


def _history_usage_anchor(agent, request, raw, event, summ):
    """Bootstrap older checkpoints lacking a fully observed request sample.

    Only use usage for an explicitly matching model. Reconstruct the latest
    input, excluding its answer; do not scale with cumulative or summary usage.
    """
    from easy_agent.agent.turn_context import render_turn_request

    model = agent.model
    model_name = getattr(model, "model_name", None) or getattr(model, "model", None)
    cutoff = (event or {}).get("cutoff_index", 0)
    for index in range(len(raw) - 1, cutoff - 1, -1):
        message = raw[index]
        if message.type != "ai" or not message.usage_metadata:
            continue
        metadata = message.response_metadata or {}
        if not model_name or model_name != (metadata.get("model_name") or metadata.get("model")):
            return None
        actual = message.usage_metadata.get("input_tokens", 0)
        if not actual:
            return None
        prefix = summ._apply_event_to_messages(raw[:index], event)
        rendered = render_turn_request(request.override(messages=prefix))
        approximate = estimate_context_tokens(
            rendered.messages, system_prompt=request.system_message.text if request.system_message else "",
            tools=request.tools,
        )
        return {"model_identity": model_identity(model), "input_tokens": actual,
                "approximate_tokens": approximate, "source": "reconstructed_history"}
    return None


def terminal_node(graph) -> str:
    """从实际编译图找唯一的无条件结束节点，绝不猜测 middleware 名称。"""
    edges = graph.get_graph().edges
    candidates = {
        edge.source for edge in edges
        if edge.target == "__end__" and not edge.conditional and edge.source != "__start__"
    }
    candidates = {
        name for name in candidates
        if all(edge.target == "__end__" and not edge.conditional for edge in edges if edge.source == name)
    }
    if len(candidates) != 1:
        raise CompactionError("当前代理图无法安全保存摘要，请检查框架兼容性")
    return candidates.pop()


async def compact_checkpoint(agent, session_id: str, backend, *, report: dict | None = None, history: list[dict] | None = None) -> bool:
    graph = agent.agent
    state = await graph.aget_state(build_run_config(agent, session_id))
    if state.next or pending_hitl_interrupts(state):
        raise CompactionBusyError("当前会话有生成或待审批任务，请先完成后再压缩")
    values = state.values or {}
    raw = list(values.get("messages") or [])
    hydrated = not raw and bool(history)
    if hydrated:
        # 只在局部恢复：摘要/归档失败前不提交水合 checkpoint。
        raw = build_context_messages(history, "")[:-1]
        user_ids = iter(history_turn_id(row, i) for i, row in enumerate(history) if row.get("role") == "user")
        for message in raw:
            if message.type == "human":
                message.id = next(user_ids)
    if not raw:
        if report is not None:
            report.update(reason="empty_history", message="没有可压缩的对话")
        return False
    node = terminal_node(graph)
    summ = build_summarization_middleware(
        agent.config, agent.model, backend, model_key=getattr(agent, "model_name", None)
    )
    previous = values.get("_summarization_event")
    effective = summ._apply_event_to_messages(raw, previous)
    cutoff = summ._determine_cutoff_index(effective)
    # 只有旧摘要可被切走时不重复摘要，但仍刷新有效上下文的估算。
    changed = cutoff > (1 if previous else 0)
    event = previous
    history_id = values.get("_summarization_session_id")
    if changed:
        older, _recent = summ._partition_messages(effective, cutoff)
        prepared, failed_media = await summ._aoffload_inline_media(backend, older)
        if failed_media:
            raise CompactionError("媒体归档失败，未修改上下文，请重试")
        history_id = summ._get_session_id(values)
        file_path = await summ._aoffload_to_backend(backend, prepared, history_id)
        if file_path is None:
            raise CompactionError("历史归档失败，未修改上下文，请重试")
        context = {"compaction_mode": "manual", "capture_content": summ.trace_enabled}
        context_token = compaction_context.set(context)
        try:
            summary = await summ._acreate_summary(prepared)
        finally:
            try:
                if summary_report := context.get("summary_report"):
                    summary_report["trace_path"] = await apersist_summary_report(backend, summary_report)
            finally:
                compaction_context.reset(context_token)
        if not summary or not summary.strip():
            raise CompactionError("摘要内容为空，未修改上下文，请重试")
        event = {
            "cutoff_index": summ._compute_state_cutoff(previous, cutoff),
            "summary_message": summ._build_new_messages_with_path(summary, file_path)[0],
            "file_path": file_path,
            "compaction_mode": "manual",
            "trigger_reason": "manual_request",
        }
        if summary_report:
            event["summary_report"] = public_summary_report(summary_report)
    elif report is None:
        return False
    records = list(values.get("context_compactions") or [])
    patch = {}
    if changed:
        patch.update(_summarization_event=event, _summarization_session_id=history_id)
    if hydrated:
        patch["messages"] = raw
    if changed or report is not None:
        # Include compiled tool schemas and runtime prompt state; provider serialization remains unknown.
        request_tools = _compiled_tools(graph, getattr(agent, "mcp_tools", ()))
        request = await _estimate_request(agent, backend, values, request_tools)
        system_prompt = request.system_message.text if request.system_message else ""
        reduced = summ._apply_event_to_messages(raw, event)
        before_tokens = estimate_context_tokens(effective, system_prompt=system_prompt, tools=request.tools)
        after_tokens = estimate_context_tokens(reduced, system_prompt=system_prompt, tools=request.tools)
        source_model = agent.model
        anchor = values.get("context_usage_anchor")
        if not anchor or anchor.get("model_identity") != model_identity(source_model):
            anchor = _history_usage_anchor(agent, request, raw, previous, summ)
            if anchor:
                # A repeated compact must reuse the pre-compression sample.
                # Its original provider input cannot be reconstructed using the new event.
                patch["context_usage_anchor"] = anchor
        raw_after_tokens = after_tokens
        before_tokens = calibrated_context_tokens(before_tokens, anchor, source_model)
        after_tokens = calibrated_context_tokens(after_tokens, anchor, source_model)
        if changed:
            event.update(before_tokens=before_tokens, after_tokens=after_tokens)
    if report is not None:
        report.update(
            compaction_mode="manual", trigger_reason="manual_request",
            id=uuid4().hex, created_at=datetime.now(UTC).isoformat(),
            model=getattr(agent, "model_name", None),
            before_tokens=before_tokens,
            context_tokens=after_tokens,
            context_length=resolve_context_length(agent.config, getattr(agent, "model_name", None)),
            estimated=True, status="compacted" if changed else "skipped",
            raw_context_tokens=raw_after_tokens,
            estimation_method="provider_calibrated" if anchor else "approximate",
            calibration_source=anchor.get("source") if anchor else None,
            message="已压缩" if changed else "当前无需压缩",
            reason="compacted" if changed else ("already_compacted" if previous else "recent_only"),
        )
        if changed and summary_report:
            report["summary_report"] = public_summary_report(summary_report)
        records.append(dict(report))
        patch["context_compactions"] = records
    updated = await graph.aupdate_state(
        state.config,
        patch,
        as_node=node,
    )
    saved = await graph.aget_state(updated)
    if (saved.values.get("_summarization_event") != event
            or saved.values.get("_summarization_session_id") != history_id
            or saved.values.get("messages") != raw or saved.next
            or pending_hitl_interrupts(saved)
            or ("context_usage_anchor" in patch
                and saved.values.get("context_usage_anchor") != patch["context_usage_anchor"])
            or (report is not None and saved.values.get("context_compactions") != records)):
        raise CompactionError("摘要保存校验失败，请重试")
    return changed
