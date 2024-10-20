from collections.abc import Sequence
from typing import Any, Optional

from pydantic import BaseModel, Field

from core.model_runtime.entities import ImagePromptMessageContent
from core.prompt.entities.advanced_prompt_entities import ChatModelMessage, CompletionModelPromptTemplate, MemoryConfig
from core.workflow.entities.variable_entities import VariableSelector
from core.workflow.nodes.base import BaseNodeData


class ModelConfig(BaseModel):
    provider: str
    name: str
    mode: str
    completion_params: dict[str, Any] = {}


class ContextConfig(BaseModel):
    enabled: bool
    variable_selector: Optional[list[str]] = None


class VisionConfigOptions(BaseModel):
    variable_selector: Sequence[str] = Field(default_factory=lambda: ["sys", "files"])
    detail: ImagePromptMessageContent.DETAIL = ImagePromptMessageContent.DETAIL.HIGH


class VisionConfig(BaseModel):
    enabled: bool = False
    configs: VisionConfigOptions = Field(default_factory=VisionConfigOptions)


class PromptConfig(BaseModel):
    jinja2_variables: Optional[list[VariableSelector]] = None


class LLMNodeChatModelMessage(ChatModelMessage):
    jinja2_text: Optional[str] = None


class LLMNodeCompletionModelPromptTemplate(CompletionModelPromptTemplate):
    jinja2_text: Optional[str] = None


class LLMNodeData(BaseNodeData):
    model: ModelConfig
    prompt_template: Sequence[LLMNodeChatModelMessage] | LLMNodeCompletionModelPromptTemplate
    prompt_config: Optional[PromptConfig] = None
    memory: Optional[MemoryConfig] = None
    context: ContextConfig
    vision: VisionConfig = Field(default_factory=VisionConfig)
