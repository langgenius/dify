"""Dify plugin LLM model layer.

This layer owns model capability resolution for Dify plugin-backed LLMs. It
depends on ``DifyPluginLayer`` for active daemon access and returns a Pydantic AI
model adapter configured from the public LLM layer DTO.
"""

from dataclasses import dataclass

from typing_extensions import Self, override

from agenton.layers import LayerDeps, PlainLayer
from dify_agent.adapters.llm import DifyLLMAdapterModel
from dify_agent.layers.dify_plugin.configs import DifyPluginLLMLayerConfig
from dify_agent.layers.dify_plugin.plugin_layer import DifyPluginLayer


class DifyPluginLLMDeps(LayerDeps):
    """Dependencies required by ``DifyPluginLLMLayer``."""

    plugin: DifyPluginLayer  # pyright: ignore[reportUninitializedInstanceVariable]


@dataclass(slots=True)
class DifyPluginLLMLayer(PlainLayer[DifyPluginLLMDeps, DifyPluginLLMLayerConfig]):
    """Layer that creates the Dify plugin-daemon Pydantic AI model."""

    type_id = "dify.plugin.llm"

    config: DifyPluginLLMLayerConfig

    @classmethod
    @override
    def from_config(cls, config: DifyPluginLLMLayerConfig) -> Self:
        """Create the LLM layer from validated public config."""
        return cls(config=config)

    def get_model(self) -> DifyLLMAdapterModel:
        """Return the configured model using the active plugin daemon provider."""
        provider = self.deps.plugin.get_provider(plugin_provider=self.config.provider)
        return DifyLLMAdapterModel(
            model=self.config.model,
            daemon_provider=provider,
            credentials=dict(self.config.credentials),
            model_settings=self.config.model_settings,
        )


__all__ = ["DifyPluginLLMDeps", "DifyPluginLLMLayer"]
