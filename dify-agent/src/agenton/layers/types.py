"""Typed layer family definitions.

``Layer`` itself is framework-neutral. This module defines typed layer families
that bind its prompt/tool generic slots to concrete contracts, such as ordinary
string prompts with plain callable tools or pydantic-ai prompt/tool shapes.
Concrete reusable layers live under ``agenton_collections``.
"""

from collections.abc import Callable
from typing import Any

from pydantic_ai import Tool
from pydantic_ai.tools import SystemPromptFunc, ToolFuncEither

from agenton.layers.base import Layer, LayerDeps

type PlainPrompt = str
type PlainTool = Callable[..., Any]


class PlainLayer[DepsT: LayerDeps](Layer[DepsT, PlainPrompt, PlainTool]):
    """Layer base for ordinary string prompts and plain-callable tools."""


type PydanticAIPrompt[AgentDepsT] = str | SystemPromptFunc[AgentDepsT]
type PydanticAITool[AgentDepsT] = Tool[AgentDepsT] | ToolFuncEither[AgentDepsT, ...]


class PydanticAILayer[DepsT: LayerDeps, AgentDepsT](
    Layer[DepsT, PydanticAIPrompt[AgentDepsT], PydanticAITool[AgentDepsT]]
):
    """Layer base for pydantic-ai prompt and tool adapters."""


__all__ = [
    "PlainLayer",
    "PlainPrompt",
    "PlainTool",
    "PydanticAILayer",
    "PydanticAIPrompt",
    "PydanticAITool",
]
