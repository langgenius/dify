"""Dify plugin LLM model layer.

This layer owns model capability resolution for Dify plugin-backed LLMs. It
depends on ``DifyExecutionContextLayer`` for shared request context through
Agenton's direct dependency binding and returns a Pydantic AI model adapter
configured from the public LLM layer DTO. Runtime code supplies the FastAPI
lifespan-owned shared HTTP client to ``get_model``; the layer does not own or
discover live resources. The API provider carries plugin transport identity,
while the DTO's ``model_provider`` is passed to the adapter as request-level
model identity.
"""

from dataclasses import dataclass, field
from typing import ClassVar

import httpx
from typing_extensions import Self, override

from agenton.layers import LayerDeps, PlainLayer
from dify_agent.adapters.llm import DifyApiLLMProvider, DifyLLMAdapterModel
from dify_agent.layers.dify_plugin.configs import DIFY_PLUGIN_LLM_LAYER_TYPE_ID, DifyPluginLLMLayerConfig
from dify_agent.layers.execution_context.layer import DifyExecutionContextLayer


class DifyPluginLLMDeps(LayerDeps):
    """Dependencies required by ``DifyPluginLLMLayer``."""

    execution_context: DifyExecutionContextLayer  # pyright: ignore[reportUninitializedInstanceVariable]


@dataclass(slots=True)
class DifyPluginLLMLayer(PlainLayer[DifyPluginLLMDeps, DifyPluginLLMLayerConfig]):
    """Layer that creates the Dify API-backed Pydantic AI model."""

    type_id: ClassVar[str | None] = DIFY_PLUGIN_LLM_LAYER_TYPE_ID

    config: DifyPluginLLMLayerConfig
    inner_api_url: str = "http://localhost:5001"
    inner_api_key: str = field(default="", repr=False)

    @classmethod
    @override
    def from_config(cls, config: DifyPluginLLMLayerConfig) -> Self:
        """Create the LLM layer from validated public config."""
        return cls(config=config)

    @classmethod
    def from_config_with_settings(
        cls,
        config: DifyPluginLLMLayerConfig,
        *,
        inner_api_url: str,
        inner_api_key: str,
    ) -> Self:
        return cls(config=config, inner_api_url=inner_api_url.rstrip("/"), inner_api_key=inner_api_key)

    def get_model(self, *, http_client: httpx.AsyncClient, agent_run_id: str) -> DifyLLMAdapterModel:
        """Return the configured model through the API-owned metered gateway."""
        if http_client.is_closed:
            raise RuntimeError("DifyPluginLLMLayer.get_model() requires an open Dify API HTTP client.")
        provider = DifyApiLLMProvider(
            plugin_id=self.config.plugin_id,
            inner_api_url=self.inner_api_url,
            inner_api_key=self.inner_api_key,
            execution_context=self.deps.execution_context.config,
            agent_run_id=agent_run_id,
            http_client=http_client,
        )
        return DifyLLMAdapterModel(
            model=self.config.model,
            dify_provider=provider,
            model_provider=self.config.model_provider,
            model_settings=self.config.model_settings,
        )


__all__ = ["DifyPluginLLMDeps", "DifyPluginLLMLayer"]
