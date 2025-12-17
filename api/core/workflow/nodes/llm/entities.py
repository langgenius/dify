from collections.abc import Mapping, Sequence
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

from core.file import File
from core.model_runtime.entities import ImagePromptMessageContent, LLMMode
from core.model_runtime.entities.llm_entities import LLMUsage
from core.prompt.entities.advanced_prompt_entities import ChatModelMessage, CompletionModelPromptTemplate, MemoryConfig
from core.tools.entities.tool_entities import ToolProviderType
from core.workflow.entities import ToolCallResult
from core.workflow.nodes.base import BaseNodeData
from core.workflow.nodes.base.entities import VariableSelector


class ModelConfig(BaseModel):
    provider: str
    name: str
    mode: LLMMode
    completion_params: dict[str, Any] = Field(default_factory=dict)


class LLMTraceSegment(BaseModel):
    """
    Streaming trace segment for LLM tool-enabled runs.

    Order is preserved for replay. Tool calls are single entries containing both
    arguments and results.
    """

    type: Literal["thought", "content", "tool_call"]

    # Common optional fields
    text: str | None = Field(None, description="Text chunk for thought/content")

    # Tool call fields (combined start + result)
    tool_call: ToolCallResult | None = Field(
        default=None,
        description="Combined tool call arguments and result for this segment",
    )


class LLMGenerationData(BaseModel):
    """Generation data from LLM invocation with tools.

    For multi-turn tool calls like: thought1 -> text1 -> tool_call1 -> thought2 -> text2 -> tool_call2
    - reasoning_contents: [thought1, thought2, ...] - one element per turn
    - tool_calls: [{id, name, arguments, result}, ...] - all tool calls with results
    """

    text: str = Field(..., description="Accumulated text content from all turns")
    reasoning_contents: list[str] = Field(default_factory=list, description="Reasoning content per turn")
    tool_calls: list[ToolCallResult] = Field(default_factory=list, description="Tool calls with results")
    sequence: list[dict[str, Any]] = Field(default_factory=list, description="Ordered segments for rendering")
    usage: LLMUsage = Field(..., description="LLM usage statistics")
    finish_reason: str | None = Field(None, description="Finish reason from LLM")
    files: list[File] = Field(default_factory=list, description="Generated files")
    trace: list[LLMTraceSegment] = Field(default_factory=list, description="Streaming trace in emitted order")


class ContextConfig(BaseModel):
    enabled: bool
    variable_selector: list[str] | None = None


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
    jinja2_text: str | None = None


class LLMNodeCompletionModelPromptTemplate(CompletionModelPromptTemplate):
    jinja2_text: str | None = None


class ToolMetadata(BaseModel):
    """
    Tool metadata for LLM node with tool support.

    Defines the essential fields needed for tool configuration,
    particularly the 'type' field to identify tool provider type.
    """

    # Core fields
    enabled: bool = True
    type: ToolProviderType = Field(..., description="Tool provider type: builtin, api, mcp, workflow")
    provider_name: str = Field(..., description="Tool provider name/identifier")
    tool_name: str = Field(..., description="Tool name")

    # Optional fields
    plugin_unique_identifier: str | None = Field(None, description="Plugin unique identifier for plugin tools")
    credential_id: str | None = Field(None, description="Credential ID for tools requiring authentication")

    # Configuration fields
    parameters: dict[str, Any] = Field(default_factory=dict, description="Tool parameters")
    settings: dict[str, Any] = Field(default_factory=dict, description="Tool settings configuration")
    extra: dict[str, Any] = Field(default_factory=dict, description="Extra tool configuration like custom description")


class LLMNodeData(BaseNodeData):
    model: ModelConfig
    prompt_template: Sequence[LLMNodeChatModelMessage] | LLMNodeCompletionModelPromptTemplate
    prompt_config: PromptConfig = Field(default_factory=PromptConfig)
    memory: MemoryConfig | None = None
    context: ContextConfig
    vision: VisionConfig = Field(default_factory=VisionConfig)
    structured_output: Mapping[str, Any] | None = None
    # We used 'structured_output_enabled' in the past, but it's not a good name.
    structured_output_switch_on: bool = Field(False, alias="structured_output_enabled")
    reasoning_format: Literal["separated", "tagged"] = Field(
        # Keep tagged as default for backward compatibility
        default="tagged",
        description=(
            """
            Strategy for handling model reasoning output.

            separated: Return clean text (without <think> tags) + reasoning_content field.
                      Recommended for new workflows. Enables safe downstream parsing and 
                      workflow variable access: {{#node_id.reasoning_content#}}

            tagged   : Return original text (with <think> tags) + reasoning_content field.
                      Maintains full backward compatibility while still providing reasoning_content
                      for workflow automation. Frontend thinking panels work as before.
            """
        ),
    )

    # Tool support
    tools: Sequence[ToolMetadata] = Field(default_factory=list)
    max_iterations: int | None = Field(default=None, description="Maximum number of iterations for the LLM node")

    @field_validator("prompt_config", mode="before")
    @classmethod
    def convert_none_prompt_config(cls, v: Any):
        if v is None:
            return PromptConfig()
        return v

    @property
    def structured_output_enabled(self) -> bool:
        return self.structured_output_switch_on and self.structured_output is not None
