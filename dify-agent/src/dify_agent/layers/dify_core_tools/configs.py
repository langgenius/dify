"""Client-safe DTOs for the Dify core-tools Agenton layer.

This layer exposes API-routed tool invocations for the Dify-owned provider
families that should execute inside the API service boundary: `plugin`,
`builtin`, `api`, `workflow`, and `mcp`. Prepared parameter declarations and
LLM-facing JSON schema are still sent by the API side so the agent runtime does
not need to inspect provider internals or storage state.
"""

from __future__ import annotations

from typing import ClassVar, Final, Literal

from pydantic import ConfigDict, Field, JsonValue

from agenton.layers import LayerConfig
from dify_agent.layers.dify_plugin.configs import DifyPluginToolParameter

type DifyCoreToolProviderType = Literal["plugin", "builtin", "api", "workflow", "mcp"]

DIFY_CORE_TOOLS_LAYER_TYPE_ID: Final[str] = "dify.core.tools"


class DifyCoreToolConfig(LayerConfig):
    """Prepared API-routed tool declaration exposed to the model."""

    provider_type: DifyCoreToolProviderType
    provider_id: str
    tool_name: str
    credential_id: str | None = None
    name: str | None = None
    description: str | None = None
    runtime_parameters: dict[str, JsonValue] = Field(default_factory=dict)
    parameters: list[DifyPluginToolParameter] = Field(default_factory=list)
    parameters_json_schema: dict[str, JsonValue] = Field(
        default_factory=lambda: {"type": "object", "properties": {}, "required": []}
    )

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid", arbitrary_types_allowed=True)


class DifyCoreToolsLayerConfig(LayerConfig):
    """Public config for the Dify core-tools layer."""

    tools: list[DifyCoreToolConfig] = Field(default_factory=list)

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid", arbitrary_types_allowed=True)
