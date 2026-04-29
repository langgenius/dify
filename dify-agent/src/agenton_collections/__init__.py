"""Convenience exports for reusable layer implementations.

Concrete collection layers live in family subpackages such as
``agenton_collections.plain`` and ``agenton_collections.pydantic_ai``. The
package root keeps the short import path for common layers while avoiding
implementation code in ``__init__``.
"""

from agenton.layers.types import (
    PlainLayer,
    PlainPrompt,
    PlainTool,
    PydanticAILayer,
    PydanticAIPrompt,
    PydanticAITool,
)
from agenton_collections.layers.pydantic_ai import (
    PydanticAIBridgeLayer,
    PydanticAIBridgeLayerDeps,
    PydanticAIPrompts,
)
from agenton_collections.layers.plain import (
    DynamicToolsLayer,
    DynamicToolsLayerDeps,
    ObjectLayer,
    PromptLayer,
    ToolsLayer,
    with_object,
)

__all__ = [
    "DynamicToolsLayer",
    "DynamicToolsLayerDeps",
    "ObjectLayer",
    "PlainLayer",
    "PlainPrompt",
    "PlainTool",
    "PromptLayer",
    "PydanticAIBridgeLayer",
    "PydanticAIBridgeLayerDeps",
    "PydanticAILayer",
    "PydanticAIPrompt",
    "PydanticAIPrompts",
    "PydanticAITool",
    "ToolsLayer",
    "with_object",
]
