"""Safe Agenton compositor construction for API-submitted configs.

Only explicitly registered layer types are constructible here. The MVP registry
contains ``PromptLayer`` so callers can provide system/user prompt fragments while
the runtime preserves hooks for richer profiles later.
"""

from typing import cast

from pydantic_ai.messages import UserContent

from agenton.compositor import Compositor, CompositorConfig, LayerRegistry
from agenton.layers.types import AllPromptTypes, AllToolTypes, AllUserPromptTypes, PydanticAIPrompt, PydanticAITool
from agenton_collections.layers.plain.basic import PromptLayer
from agenton_collections.transformers.pydantic_ai import PYDANTIC_AI_TRANSFORMERS


def create_default_layer_registry() -> LayerRegistry:
    """Return the server registry of safe config-constructible layers."""
    registry = LayerRegistry()
    registry.register_layer(PromptLayer)
    return registry


def build_pydantic_ai_compositor(
    config: CompositorConfig,
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
            registry=create_default_layer_registry(),
            **PYDANTIC_AI_TRANSFORMERS,  # pyright: ignore[reportArgumentType]
        ),
    )


__all__ = ["build_pydantic_ai_compositor", "create_default_layer_registry"]
