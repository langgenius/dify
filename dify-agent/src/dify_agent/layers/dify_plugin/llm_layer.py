"""Dify plugin LLM model layer.

This layer owns model capability resolution for Dify plugin-backed LLMs. It
depends on ``DifyPluginLayer`` for daemon identity through Agenton's direct
dependency binding and returns a Pydantic AI model adapter configured from the
public LLM layer DTO. Runtime code supplies the FastAPI lifespan-owned shared
HTTP client to ``get_model``; the layer does not own or discover live resources.
The daemon provider carries plugin transport identity, while the DTO's
``model_provider`` is passed to the adapter as request-level model identity.
"""

from dataclasses import dataclass

import httpx
from typing_extensions import Self, override

from agenton.layers import LayerDeps, PlainLayer
from dify_agent.adapters.llm import DifyLLMAdapterModel
from dify_agent.layers.dify_plugin.configs import DIFY_PLUGIN_LLM_LAYER_TYPE_ID, DifyPluginLLMLayerConfig
from dify_agent.layers.dify_plugin.plugin_layer import DifyPluginLayer


class DifyPluginLLMDeps(LayerDeps):
    """Dependencies required by ``DifyPluginLLMLayer``."""

    plugin: DifyPluginLayer  # pyright: ignore[reportUninitializedInstanceVariable]


@dataclass(slots=True)
class DifyPluginLLMLayer(PlainLayer[DifyPluginLLMDeps, DifyPluginLLMLayerConfig]):
    """Layer that creates the Dify plugin-daemon Pydantic AI model."""

    type_id = DIFY_PLUGIN_LLM_LAYER_TYPE_ID

    config: DifyPluginLLMLayerConfig

    @classmethod
    @override
    def from_config(cls, config: DifyPluginLLMLayerConfig) -> Self:
        """Create the LLM layer from validated public config."""
        return cls(config=config)

    def get_model(self, *, http_client: httpx.AsyncClient) -> DifyLLMAdapterModel:
        """Return the configured model using the directly bound plugin dependency."""
        provider = self.deps.plugin.create_daemon_provider(http_client=http_client)
        return DifyLLMAdapterModel(
            model=self.config.model,
            daemon_provider=provider,
            model_provider=self.config.model_provider,
            credentials=dict(self.config.credentials),
            model_settings=self.config.model_settings,
        )


__all__ = ["DifyPluginLLMDeps", "DifyPluginLLMLayer"]
