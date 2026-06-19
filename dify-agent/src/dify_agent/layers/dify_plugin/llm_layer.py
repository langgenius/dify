"""Dify plugin LLM model layer.

This layer owns model capability resolution for Dify plugin-backed LLMs. It
depends on ``DifyExecutionContextLayer`` for shared daemon settings through
Agenton's direct dependency binding and returns a Pydantic AI model adapter
configured from the public LLM layer DTO. Runtime code supplies the FastAPI
lifespan-owned shared HTTP client to ``get_model``; the layer does not own or
discover live resources. The daemon provider carries plugin transport identity,
while the DTO's ``model_provider`` is passed to the adapter as request-level
model identity.
"""

from dataclasses import dataclass
from typing import ClassVar

import httpx
from typing_extensions import Self, override

from agenton.layers import LayerDeps, PlainLayer
from dify_agent.adapters.llm import DifyLLMAdapterModel
from dify_agent.layers.dify_plugin.configs import DIFY_PLUGIN_LLM_LAYER_TYPE_ID, DifyPluginLLMLayerConfig
from dify_agent.layers.execution_context.layer import DifyExecutionContextLayer


class DifyPluginLLMDeps(LayerDeps):
    """Dependencies required by ``DifyPluginLLMLayer``."""

    execution_context: DifyExecutionContextLayer  # pyright: ignore[reportUninitializedInstanceVariable]


@dataclass(slots=True)
class DifyPluginLLMLayer(PlainLayer[DifyPluginLLMDeps, DifyPluginLLMLayerConfig]):
    """Layer that creates the Dify plugin-daemon Pydantic AI model."""

    type_id: ClassVar[str | None] = DIFY_PLUGIN_LLM_LAYER_TYPE_ID

    config: DifyPluginLLMLayerConfig

    @classmethod
    @override
    def from_config(cls, config: DifyPluginLLMLayerConfig) -> Self:
        """Create the LLM layer from validated public config."""
        return cls(config=config)

    def get_model(self, *, http_client: httpx.AsyncClient) -> DifyLLMAdapterModel:
        """Return the configured model using the directly bound execution context."""
        provider = self.deps.execution_context.create_daemon_provider(
            plugin_id=self.config.plugin_id,
            http_client=http_client,
        )
        return DifyLLMAdapterModel(
            model=self.config.model,
            daemon_provider=provider,
            model_provider=self.config.model_provider,
            credentials=dict(self.config.credentials),
            model_settings=self.config.model_settings,
        )


__all__ = ["DifyPluginLLMDeps", "DifyPluginLLMLayer"]
