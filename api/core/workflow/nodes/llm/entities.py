from collections.abc import Sequence
from typing import Any, Optional

from pydantic import BaseModel, Field, field_validator

from core.model_runtime.entities import ImagePromptMessageContent, LLMMode
from core.prompt.entities.advanced_prompt_entities import ChatModelMessage, CompletionModelPromptTemplate, MemoryConfig
from core.workflow.entities.variable_entities import VariableSelector
from core.workflow.nodes.base import BaseNodeData


class ModelConfig(BaseModel):
    provider: str
    name: str
    mode: LLMMode
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

    @field_validator("configs", mode="before")
    @classmethod
    def convert_none_configs(cls, v: Any):
        if v is None:
            return VisionConfigOptions()
        return v


class PromptConfig(BaseModel):
    jinja2_variables: Sequence[VariableSelector] = Field(default_factory=list)

    @field_validator("jinja2_variables", mode="before")
    @classmethod
    def convert_none_jinja2_variables(cls, v: Any):
        if v is None:
            return []
        return v


class LLMNodeChatModelMessage(ChatModelMessage):
    text: str = ""
    jinja2_text: Optional[str] = None


class LLMNodeCompletionModelPromptTemplate(CompletionModelPromptTemplate):
    jinja2_text: Optional[str] = None


class LLMNodeData(BaseNodeData):
    model: ModelConfig
    prompt_template: Sequence[LLMNodeChatModelMessage] | LLMNodeCompletionModelPromptTemplate
    prompt_config: PromptConfig = Field(default_factory=PromptConfig)
    memory: Optional[MemoryConfig] = None
    context: ContextConfig
    vision: VisionConfig = Field(default_factory=VisionConfig)

    @field_validator("prompt_config", mode="before")
    @classmethod
    def convert_none_prompt_config(cls, v: Any):
        if v is None:
            return PromptConfig()
        return v
