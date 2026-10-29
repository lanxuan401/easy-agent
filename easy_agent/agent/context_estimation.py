"""Display estimates calibrated against a session's actual model input usage."""
from __future__ import annotations

import hashlib
import json
import math

from langchain_core.messages import SystemMessage
from langchain_core.messages.utils import count_tokens_approximately
from langchain_core.utils.function_calling import convert_to_openai_tool


def estimate_context_tokens(messages, *, system_prompt: str = "", tools=()) -> int:
    """Use the same raw counter for manual estimates and observed requests."""
    additions = [SystemMessage(system_prompt)] if system_prompt else []
    serialized_tools = []
    for tool in tools:
        try:
            serialized_tools.append(convert_to_openai_tool(tool))
        except (TypeError, ValueError):
            serialized_tools.append(str(tool))
    if serialized_tools:
        additions.append(SystemMessage(json.dumps(serialized_tools, ensure_ascii=False, default=str)))
    return count_tokens_approximately([*messages, *additions])


def model_identity(model) -> str:
    """Bind calibration to model and endpoint, without persisting credentials."""
    parts = [type(model).__module__, type(model).__qualname__]
    parts.extend(str(getattr(model, key, None) or "") for key in
                 ("model_name", "model", "openai_api_base", "anthropic_api_url"))
    return hashlib.sha256(json.dumps(parts).encode()).hexdigest()


def calibrated_context_tokens(raw_tokens: int, anchor: dict | None, model) -> int:
    if not anchor or anchor.get("model_identity") != model_identity(model):
        return raw_tokens
    actual, approximate = anchor.get("input_tokens"), anchor.get("approximate_tokens")
    if (not isinstance(actual, int) or isinstance(actual, bool) or actual <= 0
            or not isinstance(approximate, int) or isinstance(approximate, bool) or approximate <= 0):
        return raw_tokens
    return math.ceil(raw_tokens * actual / approximate)
