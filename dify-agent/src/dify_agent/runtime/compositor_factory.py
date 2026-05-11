"""Safe Agenton compositor construction for API-submitted configs.

Only explicitly registered layer types are constructible here. The default
registry contains prompt layers plus Dify plugin LLM layers. Public DTOs provide
tenant/plugin/model data, while server-only plugin daemon settings are injected
through the registry factory for ``DifyPluginLayer``.
"""

from typing import cast

import httpx
from pydantic_ai.messages import UserContent

from agenton.compositor import Compositor, CompositorConfig, LayerRegistry
from agenton.layers.types import AllPromptTypes, AllToolTypes, AllUserPromptTypes, PydanticAIPrompt, PydanticAITool
from agenton_collections.layers.plain.basic import PromptLayer
from agenton_collections.transformers.pydantic_ai import PYDANTIC_AI_TRANSFORMERS
from dify_agent.layers.dify_plugin.configs import DifyPluginLayerConfig
from dify_agent.layers.dify_plugin.llm_layer import DifyPluginLLMLayer
from dify_agent.layers.dify_plugin.plugin_layer import DifyPluginLayer


def create_default_layer_registry(
    *,
    plugin_daemon_url: str = "http://localhost:5002",
    plugin_daemon_api_key: str = "",
    plugin_daemon_timeout: float | httpx.Timeout | None = 600.0,
) -> LayerRegistry:
    """Return the server registry of safe config-constructible layers."""
    registry = LayerRegistry()
    registry.register_layer(PromptLayer)
    registry.register_layer(
        DifyPluginLayer,
        factory=lambda config: DifyPluginLayer.from_config_with_settings(
            DifyPluginLayerConfig.model_validate(config),
            daemon_url=plugin_daemon_url,
            daemon_api_key=plugin_daemon_api_key,
            timeout=plugin_daemon_timeout,
        ),
    )
    registry.register_layer(DifyPluginLLMLayer)
    return registry


def build_pydantic_ai_compositor(
    config: CompositorConfig,
    *,
    registry: LayerRegistry | None = None,
) -> Compositor[
    PydanticAIPrompt[object],
    PydanticAITool[object],
    AllPromptTypes,
    AllToolTypes,
    UserContent,
    AllUserPromptTypes,
]:
    """Build a Pydantic AI-ready compositor from a validated config."""
    return cast(
        Compositor[
            PydanticAIPrompt[object],
            PydanticAITool[object],
            AllPromptTypes,
            AllToolTypes,
            UserContent,
            AllUserPromptTypes,
        ],
        Compositor.from_config(
            config,
            registry=registry or create_default_layer_registry(),
            **PYDANTIC_AI_TRANSFORMERS,  # pyright: ignore[reportArgumentType]
        ),
    )


__all__ = ["build_pydantic_ai_compositor", "create_default_layer_registry"]
