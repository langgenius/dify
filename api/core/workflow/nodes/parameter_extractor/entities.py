from typing import Any, Literal, Optional

from openai import BaseModel

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

class ParameterConfig(BaseModel):
    """
    Parameter Config.
    """
    name: str
    type: Literal['string', 'number', 'bool', 'select']
    options: Optional[list[str]]
    description: str
    required: bool

class ParameterExtractorNodeData(BaseNodeData):
    """
    Parameter Extractor Node Data.
    """
    query: list[str]
    parameters: list[ParameterConfig]
    instruction: Optional[str]
    memory: Optional[MemoryConfig]