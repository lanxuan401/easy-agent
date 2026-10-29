"""Single, isolated SDK call for editing a draft; never creates an agent or session."""

import asyncio
import json
import logging
from pathlib import Path
from time import monotonic

from openai import (
    APIConnectionError, APIResponseValidationError, APIStatusError, APITimeoutError, AsyncOpenAI,
)
from pydantic import BaseModel, ConfigDict, StrictStr, ValidationError

from easy_agent.agent.model import build_request_headers
from easy_agent.bootstrap.config import Config

logger = logging.getLogger(__name__)
INSTRUCTION_PATH = Path(__file__).resolve().parents[1] / "config/prompts/prompt_enhancement.md"
UNAVAILABLE = "提示词增强暂不可用，请联系管理员检查模型配置"
FAILED = "提示词增强失败，请重试"


class EnhancementError(Exception):
    def __init__(self, status_code: int, detail: str):
        self.status_code = status_code
        self.detail = detail
        super().__init__(detail)


class EnhancementResult(BaseModel):
    model_config = ConfigDict(extra="forbid")
    enhanced_prompt: StrictStr


def parse_result(completion, max_chars: int) -> str:
    try:
        choice = completion.choices[0]
        message = choice.message
        if (choice.finish_reason != "stop" or getattr(message, "refusal", None)
                or getattr(message, "tool_calls", None)):
            raise ValueError("incomplete or refused")
        content = message.content
        if not isinstance(content, str) or not content.strip():
            raise ValueError("empty content")
        result = EnhancementResult.model_validate(json.loads(content)).enhanced_prompt.strip()
        if not result or len(result) > max_chars:
            raise ValueError("invalid size")
        return result
    except (AttributeError, IndexError, TypeError, ValueError, ValidationError):
        raise EnhancementError(502, FAILED) from None


async def enhance_prompt(prompt: str, config: Config) -> str:
    settings = config.prompt_enhancement
    provider = config.models.get(settings.model)
    if (not provider or provider.protocol.lower() != "openai"
            or not all(value.strip() for value in (provider.api_key, provider.api_base, provider.model))):
        raise EnhancementError(503, UNAVAILABLE)
    started = monotonic()
    outcome = "internal_error"
    try:
        instruction = INSTRUCTION_PATH.read_text(encoding="utf-8")
        async with asyncio.timeout(settings.timeout_seconds):
            async with AsyncOpenAI(
                api_key=provider.api_key,
                base_url=provider.api_base,
                default_headers=build_request_headers(provider),
                max_retries=0,
                timeout=settings.timeout_seconds,
            ) as client:
                completion = await client.chat.completions.create(
                    model=provider.model,
                    messages=[
                        {"role": "system", "content": instruction},
                        {"role": "user", "content": json.dumps({"original_prompt": prompt}, ensure_ascii=False)},
                    ],
                    stream=False,
                    response_format={"type": "json_object"},
                    max_tokens=settings.max_output_tokens,
                    extra_body={"thinking": {"type": "disabled"}},
                )
        result = parse_result(completion, settings.max_output_chars)
        outcome = "success"
        return result
    except (TimeoutError, APITimeoutError):
        outcome = "timeout"
        raise EnhancementError(504, "提示词增强超时，请重试") from None
    except APIStatusError as exc:
        outcome = f"upstream_{exc.status_code}"
        if exc.status_code == 429:
            raise EnhancementError(429, "请求过于频繁，请稍后重试") from None
        if exc.status_code in (400, 401, 403, 404, 405, 415, 422):
            raise EnhancementError(503, UNAVAILABLE) from None
        raise EnhancementError(502, FAILED) from None
    except APIResponseValidationError:
        outcome = "invalid_response"
        raise EnhancementError(502, FAILED) from None
    except APIConnectionError:
        outcome = "connection_error"
        raise EnhancementError(502, FAILED) from None
    except EnhancementError:
        outcome = "invalid_result"
        raise
    except (OSError, ValueError):
        outcome = "configuration_error"
        raise EnhancementError(503, UNAVAILABLE) from None
    except asyncio.CancelledError:
        outcome = "cancelled"
        raise
    finally:
        # Never log drafts, generated content, headers, or upstream exceptions.
        logger.info("prompt_enhancement model=%s outcome=%s elapsed=%.3f",
                    settings.model, outcome, monotonic() - started)
