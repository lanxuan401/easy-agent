"""JWT protected draft enhancement endpoint, independent of chat sessions."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, StrictStr, field_validator

from easy_agent.bootstrap.config import Config
from easy_agent.middleware import get_current_username
from easy_agent.services.prompt_enhancement import EnhancementError, EnhancementResult, enhance_prompt

router = APIRouter(prefix="/agent/prompts", tags=["Prompts"])


class EnhanceRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    prompt: StrictStr

    @field_validator("prompt")
    @classmethod
    def nonblank(cls, value):
        if not value.strip():
            raise ValueError("请输入有效提示词")
        return value


def get_enhancement_config() -> Config:
    try:
        return Config.load()
    except Exception:
        raise HTTPException(503, "提示词增强暂不可用，请联系管理员检查模型配置") from None


@router.post("/enhance", response_model=EnhancementResult, summary="增强输入框提示词")
async def enhance(
    body: EnhanceRequest,
    username: Annotated[str, Depends(get_current_username)],
    config: Annotated[Config, Depends(get_enhancement_config)],
):
    if len(body.prompt) > config.prompt_enhancement.max_input_chars:
        raise HTTPException(422, detail=[{
            "type": "string_too_long", "loc": ["body", "prompt"],
            "msg": "提示词过长，请缩短输入内容",
        }])
    try:
        return EnhancementResult(enhanced_prompt=await enhance_prompt(body.prompt, config))
    except EnhancementError as exc:
        raise HTTPException(exc.status_code, exc.detail) from None
    except Exception:
        raise HTTPException(500, "提示词增强失败，请稍后重试") from None
