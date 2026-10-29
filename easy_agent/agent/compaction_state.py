"""手动压缩展示记录与估算，不混入模型 messages 或计费 usage。"""
from typing import Annotated, NotRequired

from deepagents.middleware.summarization import SummarizationState
from langchain.agents.middleware.types import OmitFromOutput


class CompactionState(SummarizationState):
    context_compactions: Annotated[NotRequired[list[dict]], OmitFromOutput]
    context_usage_anchor: Annotated[NotRequired[dict], OmitFromOutput]
