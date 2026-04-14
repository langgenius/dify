"""Agent V2 Node data model.

Merges LLM Node capabilities (prompt, memory, vision, context, structured output)
with Agent capabilities (tool calling loop, strategy selection).
When no tools are configured, behaves identically to an LLM Node.
"""

from collections.abc import Mapping, Sequence
from typing import Any, Literal

from graphon.entities.base_node_data import BaseNodeData
from graphon.model_runtime.entities import ImagePromptMessageContent
from graphon.nodes.llm.entities import (
    LLMNodeChatModelMessage,
    LLMNodeCompletionModelPromptTemplate,
    ModelConfig,
    PromptConfig,
)
from pydantic import BaseModel, Field, field_validator

from core.prompt.entities.advanced_prompt_entities import MemoryConfig
from core.tools.entities.tool_entities import ToolProviderType

AGENT_V2_NODE_TYPE = "agent-v2"


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


class ToolMetadata(BaseModel):
    """Tool configuration for Agent V2 node."""

    enabled: bool = True
    type: ToolProviderType = Field(..., description="Tool provider type: builtin, api, mcp, workflow")
    provider_name: str = Field(..., description="Tool provider name/identifier")
    tool_name: str = Field(..., description="Tool name")
    plugin_unique_identifier: str | None = Field(None)
    credential_id: str | None = Field(None)
    parameters: dict[str, Any] = Field(default_factory=dict)
    settings: dict[str, Any] = Field(default_factory=dict)
    extra: dict[str, Any] = Field(default_factory=dict)


class AgentV2NodeData(BaseNodeData):
    """Agent V2 Node — LLM + Agent capabilities in a single workflow node."""

    type: str = AGENT_V2_NODE_TYPE

    # --- LLM capabilities (superset of LLMNodeData) ---
    model: ModelConfig
    prompt_template: Sequence[LLMNodeChatModelMessage] | LLMNodeCompletionModelPromptTemplate
    prompt_config: PromptConfig = Field(default_factory=PromptConfig)
    memory: MemoryConfig | None = None
    context: ContextConfig = Field(default_factory=lambda: ContextConfig(enabled=False))
    vision: VisionConfig = Field(default_factory=VisionConfig)
    structured_output: Mapping[str, Any] | None = None
    structured_output_switch_on: bool = Field(False, alias="structured_output_enabled")
    reasoning_format: Literal["separated", "tagged"] = "tagged"

    # --- Agent capabilities ---
    tools: Sequence[ToolMetadata] = Field(default_factory=list)
    max_iterations: int = Field(default=10, ge=1, le=99)
    agent_strategy: Literal["auto", "function-calling", "chain-of-thought"] = "auto"

    @property
    def tool_call_enabled(self) -> bool:
        return bool(self.tools) and any(t.enabled for t in self.tools)
