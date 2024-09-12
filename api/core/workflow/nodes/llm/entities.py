from typing import Any, Literal, Optional, Union

from pydantic import BaseModel

from core.prompt.entities.advanced_prompt_entities import ChatModelMessage, CompletionModelPromptTemplate, MemoryConfig
from core.workflow.entities.base_node_data_entities import BaseNodeData
from core.workflow.entities.variable_entities import VariableSelector


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

        detail: Literal["low", "high"]

    enabled: bool
    configs: Optional[Configs] = None


class PromptConfig(BaseModel):
    """
    Prompt Config.
    """

    jinja2_variables: Optional[list[VariableSelector]] = None


class LLMNodeChatModelMessage(ChatModelMessage):
    """
    LLM Node Chat Model Message.
    """

    jinja2_text: Optional[str] = None


class LLMNodeCompletionModelPromptTemplate(CompletionModelPromptTemplate):
    """
    LLM Node Chat Model Prompt Template.
    """

    jinja2_text: Optional[str] = None


class LLMNodeData(BaseNodeData):
    """
    LLM Node Data.
    """

    model: ModelConfig
    prompt_template: Union[list[LLMNodeChatModelMessage], LLMNodeCompletionModelPromptTemplate]
    prompt_config: Optional[PromptConfig] = None
    memory: Optional[MemoryConfig] = None
    context: ContextConfig
    vision: VisionConfig
