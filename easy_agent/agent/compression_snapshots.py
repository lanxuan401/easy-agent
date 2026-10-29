"""摘要边界的请求快照；沿用会话 backend 隔离，不在共享中间件上保存请求状态。

DeepAgents 0.7.28 的摘要发生在 wrap_model_call 内；在生成摘要前保存 before，
在摘要后的请求交给下游 handler 前保存 after。框架私有钩子的兼容性由真实建图测试覆盖。
官方行为：https://docs.langchain.com/oss/python/deepagents/context-engineering#summarization
"""

from __future__ import annotations

import json
import logging
from contextvars import ContextVar
from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import uuid4

from deepagents.middleware.summarization import SummarizationMiddleware
from deepagents.middleware.unsupported_content import UnsupportedContentMiddleware
from langchain_core.exceptions import ContextOverflowError

from easy_agent.agent.compaction_observability import (
    compaction_context, public_summary_report, persist_summary_report, apersist_summary_report,
)
from easy_agent.agent.compaction_state import CompactionState
from easy_agent.agent.context_estimation import estimate_context_tokens, model_identity
from langchain.agents.middleware.types import ExtendedModelResponse, ModelRequest
from langchain_core.utils.function_calling import convert_to_openai_tool
from langgraph.types import Command

logger = logging.getLogger(__name__)


@dataclass
class _SnapshotRun:
    request: ModelRequest
    messages: list
    prefix: str
    started: bool = False
    before_tokens: int | None = None
    attempts: int = 0
    after_tokens: int | None = None
    trigger_reason: str | None = None


_current_run: ContextVar[_SnapshotRun | None] = ContextVar("compression_snapshot_run", default=None)


class SnapshotSummarizationMiddleware(SummarizationMiddleware):
    """配置窗口预检及摘要观测；框架继续管理摘要事件与历史归档。"""

    state_schema = CompactionState

    def __init__(self, *args, snapshot_enabled: bool = True, trace_enabled: bool = False,
                 context_length: int | None = None, request_projectors=(), **kwargs):
        super().__init__(*args, **kwargs)
        self.snapshot_enabled = snapshot_enabled
        self.trace_enabled = trace_enabled
        self.context_length = context_length
        self.request_projectors = tuple(request_projectors)

    @property
    def name(self) -> str:
        return "SummarizationMiddleware"

    def _input_budget(self, request):
        """Use the configured window even when the provider exposes no profile."""
        budget = super()._input_budget(request)
        if self.context_length is None:
            return budget
        output = max((value for key in ("max_tokens", "max_completion_tokens", "max_output_tokens")
                      if isinstance(value := request.model_settings.get(key, getattr(request.model, key, None)), int)
                      and not isinstance(value, bool)), default=0)
        configured = max(0, int(self.context_length * 0.95) - output)
        return min(budget, configured) if budget is not None else configured

    def _project_request(self, request):
        # Only render into a local copy for counting. The actual downstream
        # middleware still owns prompt injection and dynamic tool disclosure.
        for middleware in self.request_projectors:
            request = middleware.modify_request(request)
        return request

    def _count_tokens(self, messages, system_message, tools):
        run = _current_run.get()
        if run is not None and self.request_projectors:
            projected = self._project_request(run.request.override(
                messages=messages, system_message=system_message, tools=tools))
            system_message, tools = projected.system_message, projected.tools
        return super()._count_tokens(messages, system_message, tools)

    def _truncate_args(self, messages, total_tokens):
        # Summarization and its fact inventory must see the original tool arguments.
        # Independent argument truncation remains available below the summary budget.
        run = _current_run.get()
        if (self._should_summarize(messages, total_tokens)
                or (run is not None and self._over_budget(run.request, total_tokens))):
            return messages, False
        return super()._truncate_args(messages, total_tokens)

    def _partition_messages(self, conversation_messages, cutoff_index):
        older, recent = super()._partition_messages(conversation_messages, cutoff_index)
        run = _current_run.get()
        if run is None or len(conversation_messages) != len(run.messages):
            return older, recent
        # Provider overflow can follow the independent argument-truncation path.
        # Restore only its selected historical prefix, before media offloading.
        # IDs and types must match positionally; absent IDs require object identity.
        def same_message(candidate, original):
            if candidate is original:
                return True
            return (bool(getattr(original, "id", None))
                    and candidate.id == original.id and candidate.type == original.type)
        if all(same_message(candidate, original)
               for candidate, original in zip(conversation_messages, run.messages, strict=True)):
            return list(run.messages[:cutoff_index]), recent
        return older, recent

    def _start_run(self, run):
        run.before_tokens = self._count_tokens(run.messages, run.request.system_message, run.request.tools)
        if self._over_budget(run.request, run.before_tokens):
            run.trigger_reason = "preflight_input_budget"
        elif self._should_summarize(run.messages, run.before_tokens):
            run.trigger_reason = "configured_threshold"

    def _finish_run(self, result, run, context):
        report = context.get("summary_report")
        command = getattr(result, "command", None)
        update = getattr(command, "update", None)
        if isinstance(update, dict) and (event := update.get("_summarization_event")):
            event.update(compaction_mode="automatic", trigger_reason=run.trigger_reason,
                         before_tokens=run.before_tokens, after_tokens=run.after_tokens)
            if report is not None:
                event["summary_report"] = public_summary_report(report)
        if run.started:
            logger.info("compaction_preflight trigger_reason=%s before_tokens=%s after_tokens=%s input_budget=%s",
                        run.trigger_reason, run.before_tokens, run.after_tokens, self._input_budget(run.request))
        return result

    def _snapshot_run(self, request):
        root = self._history_path_prefix.rsplit("/", 1)[0]
        stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%S_%fZ")
        return _SnapshotRun(
            request=request,
            messages=self._get_effective_messages(request),
            prefix=f"{root}/context_snapshots/{stamp}_{uuid4().hex}",
        )

    def _snapshot_content(self, run, request, messages, stage):
        request = self._project_request(request)
        tokens = super()._count_tokens(messages, request.system_message, request.tools)
        if stage == "before":
            run.before_tokens = tokens
        before = run.before_tokens
        return json.dumps(
            {
                "snapshot_id": run.prefix.rsplit("/", 1)[-1],
                "stage": stage,
                "scope": "summarization boundary with configured downstream prompt projection",
                "trigger_reason": run.trigger_reason,
                "input_budget": self._input_budget(request),
                "compaction_mode": "automatic",
                "token_count_method": "middleware estimate, not provider billing usage",
                "estimated_input_tokens": tokens,
                "before_estimated_input_tokens": before,
                "reduction_fraction": (1 - tokens / before) if before else None,
                "message_count": len(messages),
                "summary_input_token_limit": self._lc_helper.trim_tokens_to_summarize,
                "system_message": request.system_message.model_dump(mode="json")
                if request.system_message is not None else None,
                "tools": [convert_to_openai_tool(tool) for tool in (request.tools or [])],
                "messages": [message.model_dump(mode="json") for message in messages],
            },
            ensure_ascii=False,
            indent=2,
        ) + "\n"

    def _write_snapshot(self, run, request, messages, stage):
        path = f"{run.prefix}.{stage}.json"
        try:
            content = self._snapshot_content(run, request, messages, stage)
            result = self._backend.write(path, content)
            if result is None or result.error:
                raise OSError(result.error if result else "backend returned None")
            logger.info("上下文压缩快照 | %s", path)
        except Exception:
            logger.warning("上下文压缩快照写入失败 | %s", path, exc_info=True)

    async def _awrite_snapshot(self, run, request, messages, stage):
        path = f"{run.prefix}.{stage}.json"
        try:
            content = self._snapshot_content(run, request, messages, stage)
            result = await self._backend.awrite(path, content)
            if result is None or result.error:
                raise OSError(result.error if result else "backend returned None")
            logger.info("上下文压缩快照 | %s", path)
        except Exception:
            logger.warning("上下文压缩快照写入失败 | %s", path, exc_info=True)

    def _create_summary(self, messages_to_summarize):
        if (run := _current_run.get()) is not None:
            run.started = True
            run.trigger_reason = run.trigger_reason or "provider_context_overflow"
            if self.snapshot_enabled:
                self._write_snapshot(run, run.request, run.messages, "before")
        return super()._create_summary(messages_to_summarize)

    async def _acreate_summary(self, messages_to_summarize):
        if (run := _current_run.get()) is not None:
            run.started = True
            run.trigger_reason = run.trigger_reason or "provider_context_overflow"
            if self.snapshot_enabled:
                await self._awrite_snapshot(run, run.request, run.messages, "before")
        return await super()._acreate_summary(messages_to_summarize)

    def wrap_model_call(self, request, handler):
        run = self._snapshot_run(request)
        token = _current_run.set(run)
        context = {"compaction_mode": "automatic", "capture_content": self.trace_enabled}
        context_token = compaction_context.set(context)

        def observed(reduced):
            run.after_tokens = self._count_tokens(reduced.messages, reduced.system_message, reduced.tools)
            if run.started:
                run.attempts += 1
                if self.snapshot_enabled:
                    stage = "after" if run.attempts == 1 else f"after_retry_{run.attempts - 1}"
                    self._write_snapshot(run, reduced, reduced.messages, stage)
            return handler(reduced)

        try:
            self._start_run(run)
            result = super().wrap_model_call(request, observed)
            report = context.get("summary_report")
            if report is not None:
                report["trace_path"] = persist_summary_report(self._backend, report)
            return self._finish_run(result, run, context)
        except ContextOverflowError:
            logger.warning("compaction_preflight_rejected trigger_reason=%s before_tokens=%s after_tokens=%s input_budget=%s",
                           run.trigger_reason, run.before_tokens, run.after_tokens, self._input_budget(request))
            raise
        finally:
            try:
                if (report := context.get("summary_report")) is not None and "trace_path" not in report:
                    report["trace_path"] = persist_summary_report(self._backend, report)
            finally:
                compaction_context.reset(context_token)
                _current_run.reset(token)

    async def awrap_model_call(self, request, handler):
        run = self._snapshot_run(request)
        token = _current_run.set(run)
        context = {"compaction_mode": "automatic", "capture_content": self.trace_enabled}
        context_token = compaction_context.set(context)

        async def observed(reduced):
            run.after_tokens = self._count_tokens(reduced.messages, reduced.system_message, reduced.tools)
            if run.started:
                run.attempts += 1
                if self.snapshot_enabled:
                    stage = "after" if run.attempts == 1 else f"after_retry_{run.attempts - 1}"
                    await self._awrite_snapshot(run, reduced, reduced.messages, stage)
            return await handler(reduced)

        try:
            self._start_run(run)
            result = await super().awrap_model_call(request, observed)
            report = context.get("summary_report")
            if report is not None:
                report["trace_path"] = await apersist_summary_report(self._backend, report)
            return self._finish_run(result, run, context)
        except ContextOverflowError:
            logger.warning("compaction_preflight_rejected trigger_reason=%s before_tokens=%s after_tokens=%s input_budget=%s",
                           run.trigger_reason, run.before_tokens, run.after_tokens, self._input_budget(request))
            raise
        finally:
            try:
                if (report := context.get("summary_report")) is not None and "trace_path" not in report:
                    report["trace_path"] = await apersist_summary_report(self._backend, report)
            finally:
                compaction_context.reset(context_token)
                _current_run.reset(token)


class PreflightBudgetGuard(UnsupportedContentMiddleware):
    """Last framework slot: refuse oversized fully rendered inputs before the model."""

    def __init__(self, summarization):
        self.summarization = summarization

    @property
    def name(self):
        return "UnsupportedContentMiddleware"

    def _guard(self, request):
        request = self._filter_request(request)
        summ = self.summarization
        tokens = SummarizationMiddleware._count_tokens(summ, request.messages, request.system_message, request.tools)
        budget = summ._input_budget(request)
        run = _current_run.get()
        if run is not None:
            run.after_tokens = tokens
        if budget is not None and tokens > budget:
            if run is not None and not run.started:
                run.before_tokens = tokens
                run.trigger_reason = "preflight_input_budget"
            logger.warning("compaction_preflight_rejected estimated_input_tokens=%s input_budget=%s", tokens, budget)
            raise ContextOverflowError("Complete model input exceeds the preflight input budget; reduce input, tools, or configured output tokens.")
        return request

    def wrap_model_call(self, request, handler):
        request = self._guard(request)
        return self._observe_usage(request, handler(request))

    async def awrap_model_call(self, request, handler):
        request = self._guard(request)
        return self._observe_usage(request, await handler(request))

    def _observe_usage(self, request, response):
        """Persist one sample per thread; shared middleware retains no user state.

        This sample serves the display estimate only. Budget checks and billing
        continue using their existing counters and original provider metadata.
        """
        for message in reversed(response.result):
            actual = (getattr(message, "usage_metadata", None) or {}).get("input_tokens", 0)
            if isinstance(actual, int) and not isinstance(actual, bool) and actual > 0:
                anchor = {
                    "model_identity": model_identity(request.model),
                    "input_tokens": actual,
                    "approximate_tokens": estimate_context_tokens(
                        request.messages,
                        system_prompt=request.system_message.text if request.system_message else "",
                        tools=request.tools,
                    ),
                    "source": "model_request",
                }
                return ExtendedModelResponse(
                    model_response=response, command=Command(update={"context_usage_anchor": anchor}),
                )
        return response
