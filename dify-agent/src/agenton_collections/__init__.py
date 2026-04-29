"""Convenience exports for reusable layer implementations.

Concrete collection layers live in family subpackages such as
``agenton_collections.plain`` and ``agenton_collections.pydantic_ai``. The
package root keeps the short import path for common layers while avoiding
implementation code in ``__init__``.
"""

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
from agenton_collections.layers.pydantic_ai import (
    PydanticAIBridgeLayer,
    PydanticAIBridgeLayerDeps,
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
    "AllPromptTypes",
    "AllToolTypes",
    "DynamicToolsLayer",
    "DynamicToolsLayerDeps",
    "ObjectLayer",
    "PlainLayer",
    "PlainPrompt",
    "PlainPromptType",
    "PlainTool",
    "PlainToolType",
    "PromptLayer",
    "PydanticAIBridgeLayer",
    "PydanticAIBridgeLayerDeps",
    "PydanticAILayer",
    "PydanticAIPrompt",
    "PydanticAIPromptType",
    "PydanticAITool",
    "PydanticAIToolType",
    "ToolsLayer",
    "with_object",
]
