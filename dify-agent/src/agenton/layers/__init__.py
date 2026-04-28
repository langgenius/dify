"""Layer base classes and typed layer families.

``agenton.layers.base`` owns the framework-neutral ``Layer`` abstraction.
``agenton.layers.types`` binds the prompt/tool generic slots to specific layer
families while keeping concrete reusable layers in ``agenton_collections``.
"""

from agenton.layers.base import Layer, LayerControl, LayerDeps, NoLayerDeps
from agenton.layers.types import (
    PlainLayer,
    PlainPrompt,
    PlainTool,
    PydanticAILayer,
    PydanticAIPrompt,
    PydanticAITool,
)

__all__ = [
    "Layer",
    "LayerDeps",
    "LayerControl",
    "NoLayerDeps",
    "PlainLayer",
    "PlainPrompt",
    "PlainTool",
    "PydanticAILayer",
    "PydanticAIPrompt",
    "PydanticAITool",
]
