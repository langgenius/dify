from typing import Any

from pydantic import BaseModel

from core.workflow.entities.base_node_data_entities import BaseNodeData


class ModelConfig(BaseModel):
    """
     Model Config.
    """
    provider: str
    name: str
    mode: str
    completion_params: dict[str, Any] = {}


class ClassConfig(BaseModel):
    """
    Class Config.
    """
    id: str
    name: str


class WindowConfig(BaseModel):
    """
    Window Config.
    """
    enabled: bool
    size: int


class MemoryConfig(BaseModel):
    """
    Memory Config.
    """
    window: WindowConfig


class QuestionClassifierNodeData(BaseNodeData):
    """
    Knowledge retrieval Node Data.
    """
    query_variable_selector: list[str]
    title: str
    desc: str
    type: str = 'question-classifier'
    model: ModelConfig
    classes: list[ClassConfig]
    instruction: str
    memory: MemoryConfig
