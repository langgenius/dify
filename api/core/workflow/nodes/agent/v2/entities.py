"""Entity definitions for Agent V2 Node."""

from collections.abc import Sequence
from typing import Any

from pydantic import BaseModel, Field

from core.prompt.entities.advanced_prompt_entities import MemoryConfig
from core.tools.entities.tool_entities import ToolProviderType
from core.workflow.nodes.base import BaseNodeData
from core.workflow.nodes.llm.entities import (
    ContextConfig,
    LLMNodeChatModelMessage,
    LLMNodeCompletionModelPromptTemplate,
    ModelConfig,
    PromptConfig,
    VisionConfig,
)


class ToolMetadata(BaseModel):
    """
    Tool metadata for v2 agent node.

    Defines the essential fields needed for agent tool configuration,
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


class AgentV2NodeData(BaseNodeData):
    """
    Agent V2 Node Data - maintains same structure as LLM Node with additional tools configuration.

    This node data structure is designed to be compatible with LLM Node while adding
    agent-specific functionality through the tools parameter.
    """

    # LLM configuration (same as LLMNodeData)
    model: ModelConfig
    prompt_template: Sequence[LLMNodeChatModelMessage] | LLMNodeCompletionModelPromptTemplate
    prompt_config: PromptConfig = Field(default_factory=PromptConfig)
    memory: MemoryConfig | None = None
    context: ContextConfig
    vision: VisionConfig = Field(default_factory=VisionConfig)

    # Agent-specific configuration
    tools: Sequence[ToolMetadata] = Field(default_factory=list)
