"""Layer base classes and typed layer families.

``agenton.layers.base`` owns the framework-neutral ``Layer`` abstraction.
``agenton.layers.types`` binds the prompt/tool generic slots to specific layer
families while keeping concrete reusable layers in ``agenton_collections``.
"""

from agenton.layers.base import ExitIntent, Layer, LayerControl, LayerDeps, LifecycleState, NoLayerDeps
from agenton.layers.types import (
    AllPromptTypes,
    AllToolTypes,
    PlainLayer,
    PlainPrompt,
    PlainPromptType,
    PlainTool,
    PlainToolType,
    PydanticAILayer,
    PydanticAIPrompt,
    PydanticAIPromptType,
    PydanticAITool,
    PydanticAIToolType,
)

__all__ = [
    "AllPromptTypes",
    "AllToolTypes",
    "Layer",
    "LayerDeps",
    "LayerControl",
    "LifecycleState",
    "ExitIntent",
    "NoLayerDeps",
    "PlainLayer",
    "PlainPrompt",
    "PlainPromptType",
    "PlainTool",
    "PlainToolType",
    "PydanticAILayer",
    "PydanticAIPrompt",
    "PydanticAIPromptType",
    "PydanticAITool",
    "PydanticAIToolType",
]
