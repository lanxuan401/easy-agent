"""Invocation-local compression metadata; contents are persisted only by opt-in traces."""
from __future__ import annotations

import json
import logging
from contextvars import ContextVar

logger = logging.getLogger(__name__)
compaction_context: ContextVar[dict | None] = ContextVar("compaction_context", default=None)


def public_summary_report(report: dict) -> dict:
    """Strip conversation text before attaching telemetry to checkpoints or logs."""
    safe = {key: value for key, value in report.items() if key != "stages"}
    safe["stages"] = [
        {key: value for key, value in stage.items() if key not in {"input", "output"}}
        for stage in report.get("stages", [])
    ]
    coverage = safe.get("coverage")
    if coverage:
        safe["coverage"] = {
            **coverage,
            "items": [
                {key: value for key, value in item.items() if key in {
                    "id", "category", "critical", "source_chunk_id", "status",
                    "first_loss_chunk_id", "first_loss_phase", "first_loss_status",
                    "first_uncertain_chunk_id", "first_uncertain_phase", "first_uncertain_status",
                }}
                for item in coverage.get("items", [])
            ],
        }
    return safe


def _trace(report):
    if not any("input" in stage for stage in report.get("stages", [])):
        return None
    return (
        f"/.agent/context_snapshots/{report['run_id']}.summary.json",
        json.dumps(report, ensure_ascii=False, indent=2) + "\n",
    )


def persist_summary_report(backend, report: dict) -> str | None:
    """Best-effort debug artifact in the session backend; never log content."""
    trace = _trace(report)
    if trace is None:
        return None
    path, content = trace
    try:
        result = backend.write(path, content)
        if result is None or result.error:
            raise OSError("summary trace write failed")
        return path
    except Exception:
        logger.warning("compaction_trace_write_failed run_id=%s", report.get("run_id"))
        return None


async def apersist_summary_report(backend, report: dict) -> str | None:
    trace = _trace(report)
    if trace is None:
        return None
    path, content = trace
    try:
        result = await backend.awrite(path, content)
        if result is None or result.error:
            raise OSError("summary trace write failed")
        return path
    except Exception:
        logger.warning("compaction_trace_write_failed run_id=%s", report.get("run_id"))
        return None
