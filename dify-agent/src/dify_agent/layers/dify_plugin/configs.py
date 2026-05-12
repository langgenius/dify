"""Client-safe DTOs for Dify plugin-backed Agenton layers.

This module intentionally contains only public config schemas and scalar type
aliases plus stable layer type identifiers. Runtime objects such as HTTP
clients, server settings, and adapter implementations live in sibling
implementation modules so clients can build run requests without importing
server-only dependencies.
"""

from typing import ClassVar, Final, TypeAlias

from pydantic import ConfigDict, Field
from pydantic_ai.settings import ModelSettings

from agenton.layers import LayerConfig


DifyPluginCredentialValue: TypeAlias = str | int | float | bool | None
DIFY_PLUGIN_LAYER_TYPE_ID: Final[str] = "dify.plugin"
DIFY_PLUGIN_LLM_LAYER_TYPE_ID: Final[str] = "dify.plugin.llm"


class DifyPluginLayerConfig(LayerConfig):
    """Public config for the plugin daemon tenant/plugin context layer."""

    tenant_id: str
    plugin_id: str
    user_id: str | None = None

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid", arbitrary_types_allowed=True)


class DifyPluginLLMLayerConfig(LayerConfig):
    """Public config for selecting a business provider/model from a plugin."""

    model_provider: str
    model: str
    credentials: dict[str, DifyPluginCredentialValue] = Field(default_factory=dict)
    model_settings: ModelSettings | None = None

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid", arbitrary_types_allowed=True)


__all__ = [
    "DIFY_PLUGIN_LAYER_TYPE_ID",
    "DIFY_PLUGIN_LLM_LAYER_TYPE_ID",
    "DifyPluginCredentialValue",
    "DifyPluginLLMLayerConfig",
    "DifyPluginLayerConfig",
]
