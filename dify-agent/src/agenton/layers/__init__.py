"""Layer base classes and typed layer families.

``agenton.layers.base`` owns the framework-neutral ``Layer`` abstraction.
``agenton.layers.types`` binds the prompt/tool generic slots to specific layer
families while keeping concrete reusable layers in ``agenton_collections``.
"""

from agenton.layers.base import (
    EmptyLayerConfig,
    EmptyRuntimeState,
    ExitIntent,
    Layer,
    LayerConfig,
    LayerConfigValue,
    LayerDeps,
    LifecycleState,
    NoLayerDeps,
)
from agenton.layers.types import (
    AllPromptTypes,
    AllToolTypes,
    AllUserPromptTypes,
    PlainLayer,
    PlainPrompt,
    PlainPromptType,
    PlainTool,
    PlainToolType,
    PlainUserPrompt,
    PlainUserPromptType,
    PydanticAILayer,
    PydanticAIPrompt,
    PydanticAIPromptType,
    PydanticAITool,
    PydanticAIToolType,
    PydanticAIUserPrompt,
    PydanticAIUserPromptType,
)

__all__ = [
    "AllPromptTypes",
    "AllToolTypes",
    "AllUserPromptTypes",
    "Layer",
    "LayerConfig",
    "LayerConfigValue",
    "LayerDeps",
    "LifecycleState",
    "ExitIntent",
    "EmptyLayerConfig",
    "EmptyRuntimeState",
    "NoLayerDeps",
    "PlainLayer",
    "PlainPrompt",
    "PlainPromptType",
    "PlainUserPrompt",
    "PlainUserPromptType",
    "PlainTool",
    "PlainToolType",
    "PydanticAILayer",
    "PydanticAIPrompt",
    "PydanticAIPromptType",
    "PydanticAIUserPrompt",
    "PydanticAIUserPromptType",
    "PydanticAITool",
    "PydanticAIToolType",
]
