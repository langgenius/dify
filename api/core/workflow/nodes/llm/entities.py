from typing import Any, Literal, Optional, Union

from pydantic import BaseModel

from core.prompt.entities.advanced_prompt_entities import ChatModelMessage, CompletionModelPromptTemplate, MemoryConfig
from core.workflow.entities.base_node_data_entities import BaseNodeData


class ModelConfig(BaseModel):
    """
    Model Config.
    """
    provider: str
    name: str
    mode: str
    completion_params: dict[str, Any] = {}


class ContextConfig(BaseModel):
    """
    Context Config.
    """
    enabled: bool
    variable_selector: Optional[list[str]] = None


class VisionConfig(BaseModel):
    """
    Vision Config.
    """
    class Configs(BaseModel):
        """
        Configs.
        """
        detail: Literal['low', 'high']

    enabled: bool
    configs: Optional[Configs] = None


class LLMNodeData(BaseNodeData):
    """
    LLM Node Data.
    """
    model: ModelConfig
    prompt_template: Union[list[ChatModelMessage], CompletionModelPromptTemplate]
    memory: Optional[MemoryConfig] = None
    context: ContextConfig
    vision: VisionConfig
