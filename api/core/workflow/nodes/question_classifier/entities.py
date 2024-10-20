from typing import Optional

from pydantic import BaseModel, Field

from core.prompt.entities.advanced_prompt_entities import MemoryConfig
from core.workflow.nodes.base import BaseNodeData
from core.workflow.nodes.llm import ModelConfig, VisionConfig


class ClassConfig(BaseModel):
    id: str
    name: str


class QuestionClassifierNodeData(BaseNodeData):
    query_variable_selector: list[str]
    model: ModelConfig
    classes: list[ClassConfig]
    instruction: Optional[str] = None
    memory: Optional[MemoryConfig] = None
    vision: VisionConfig = Field(default_factory=VisionConfig)
