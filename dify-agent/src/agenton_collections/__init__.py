"""Convenience exports for reusable layer implementations.

Concrete collection layers live in family subpackages such as
``agenton_collections.layers.plain`` and
``agenton_collections.layers.pydantic_ai``. The package root keeps short
client-safe imports for common plain layers while requiring explicit submodule
imports for pydantic-ai bridge implementations.
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
    "PydanticAILayer",
    "PydanticAIPrompt",
    "PydanticAIPromptType",
    "PydanticAITool",
    "PydanticAIToolType",
    "ToolsLayer",
    "with_object",
]
