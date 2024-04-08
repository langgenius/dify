from typing import Any, Optional

from pydantic import BaseModel

from core.prompt.entities.advanced_prompt_entities import MemoryConfig
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


class QuestionClassifierNodeData(BaseNodeData):
    """
    Knowledge retrieval Node Data.
    """
    query_variable_selector: list[str]
    type: str = 'question-classifier'
    model: ModelConfig
    classes: list[ClassConfig]
    instruction: Optional[str] = None
    memory: Optional[MemoryConfig] = None
