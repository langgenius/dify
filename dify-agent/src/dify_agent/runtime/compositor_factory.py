"""Safe Agenton compositor construction for API-submitted configs.

Only explicitly allowed provider type ids are constructible here. The default
provider set contains prompt layers, the state-free Dify structured output
layer, plus Dify plugin LLM layers. Public DTOs provide tenant/plugin/model
data, while server-only plugin daemon settings are injected through the provider
factory for ``DifyPluginLayer``. The resulting ``Compositor`` remains Agenton
state-only: live resources such as the plugin daemon HTTP client are supplied
later by the runtime and never enter providers, layers, or session snapshots.
"""

from collections.abc import Mapping, Sequence
from typing import Any, cast

from pydantic_ai.messages import UserContent

from agenton.compositor import Compositor, CompositorConfig, LayerProvider, LayerProviderInput
from agenton.layers.types import AllPromptTypes, AllToolTypes, AllUserPromptTypes, PydanticAIPrompt, PydanticAITool
from agenton_collections.layers.plain.basic import PromptLayer
from agenton_collections.transformers.pydantic_ai import PYDANTIC_AI_TRANSFORMERS
from dify_agent.layers.dify_plugin.configs import DifyPluginLayerConfig
from dify_agent.layers.dify_plugin.llm_layer import DifyPluginLLMLayer
from dify_agent.layers.dify_plugin.plugin_layer import DifyPluginLayer
from dify_agent.layers.output.output_layer import DifyOutputLayer


type DifyAgentLayerProvider = LayerProvider[Any]


def create_default_layer_providers(
    *,
    plugin_daemon_url: str = "http://localhost:5002",
    plugin_daemon_api_key: str = "",
) -> tuple[DifyAgentLayerProvider, ...]:
    """Return the server provider set of safe config-constructible layers."""
    return (
        LayerProvider.from_layer_type(PromptLayer),
        LayerProvider.from_layer_type(DifyOutputLayer),
        LayerProvider.from_factory(
            layer_type=DifyPluginLayer,
            create=lambda config: DifyPluginLayer.from_config_with_settings(
                DifyPluginLayerConfig.model_validate(config),
                daemon_url=plugin_daemon_url,
                daemon_api_key=plugin_daemon_api_key,
            ),
        ),
        LayerProvider.from_layer_type(DifyPluginLLMLayer),
    )


def build_pydantic_ai_compositor(
    config: CompositorConfig,
    *,
    providers: Sequence[LayerProviderInput],
    node_providers: Mapping[str, LayerProviderInput] | None = None,
) -> Compositor[
    PydanticAIPrompt[object],
    PydanticAITool[object],
    AllPromptTypes,
    AllToolTypes,
    UserContent,
    AllUserPromptTypes,
]:
    """Build a Pydantic AI-ready compositor from a validated graph config.

    Prompt, user prompt, and tool conversion is delegated to Agenton's shared
    pydantic-ai transformer preset so Dify Agent does not duplicate conversion
    logic for plain and pydantic-ai layer families. Callers must pass the already
    selected provider set explicitly so provider defaulting stays at outer runtime
    boundaries rather than being duplicated here.
    """
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
            providers=providers,
            node_providers=node_providers,
            **PYDANTIC_AI_TRANSFORMERS,  # pyright: ignore[reportArgumentType]
        ),
    )


__all__ = ["DifyAgentLayerProvider", "build_pydantic_ai_compositor", "create_default_layer_providers"]
