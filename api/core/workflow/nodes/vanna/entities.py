from typing import Any, Literal, Optional

from pydantic import BaseModel, Field, field_validator

from core.prompt.entities.advanced_prompt_entities import MemoryConfig
from core.workflow.nodes.base import BaseNodeData
from core.workflow.nodes.llm import ModelConfig, VisionConfig
from core.model_runtime.entities import ImagePromptMessageContent, LLMMode

class VannaConfig(BaseModel):
    """
    Vanna Config.
    """

    provider: str
    name: str
    mode: LLMMode


class VannaNodeData(BaseNodeData):

    model: ModelConfig
    query: list[str]
    instruction: Optional[str] = None
    vision: VisionConfig = Field(default_factory=VisionConfig)

