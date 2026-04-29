"""Typed layer family definitions.

``Layer`` itself is framework-neutral. This module defines typed layer families
that bind its prompt/tool generic slots to concrete contracts, such as ordinary
string prompts with plain callable tools or pydantic-ai prompt/tool shapes.
Tagged aggregate aliases cover code paths that can accept any supported
prompt/tool family without changing the plain and pydantic-ai layer contracts.
Pydantic-ai names are imported for static analysis only, so ``agenton`` can be
imported without loading that optional integration at runtime.
Concrete reusable layers live under ``agenton_collections``.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, Literal

from typing_extensions import final, override

if TYPE_CHECKING:
    from pydantic_ai import Tool
    from pydantic_ai.tools import SystemPromptFunc

from agenton.layers.base import Layer, LayerDeps

type PlainPrompt = str
type PlainTool = Callable[..., Any]


type PydanticAIPrompt[AgentDepsT] = SystemPromptFunc[AgentDepsT]
type PydanticAITool[AgentDepsT] = Tool[AgentDepsT]


@dataclass(frozen=True, slots=True)
class PlainPromptType:
    """Tagged plain prompt item for aggregate prompt transformations."""

    value: PlainPrompt
    kind: Literal["plain"] = field(default="plain", init=False)


@dataclass(frozen=True, slots=True)
class PlainToolType:
    """Tagged plain tool item for aggregate tool transformations."""

    value: PlainTool
    kind: Literal["plain"] = field(default="plain", init=False)


@dataclass(frozen=True, slots=True)
class PydanticAIPromptType[AgentDepsT]:
    """Tagged pydantic-ai prompt item for aggregate prompt transformations."""

    value: PydanticAIPrompt[AgentDepsT]
    kind: Literal["pydantic_ai"] = field(default="pydantic_ai", init=False)


@dataclass(frozen=True, slots=True)
class PydanticAIToolType[AgentDepsT]:
    """Tagged pydantic-ai tool item for aggregate tool transformations."""

    value: PydanticAITool[AgentDepsT]
    kind: Literal["pydantic_ai"] = field(default="pydantic_ai", init=False)


type AllPromptTypes = PlainPromptType | PydanticAIPromptType[Any]
type AllToolTypes = PlainToolType | PydanticAIToolType[Any]


class PlainLayer[DepsT: LayerDeps](Layer[DepsT, PlainPrompt, PlainTool]):
    """Layer base for ordinary string prompts and plain-callable tools."""

    @final
    @override
    def wrap_prompt(self, prompt: PlainPrompt) -> PlainPromptType:
        return PlainPromptType(prompt)

    @final
    @override
    def wrap_tool(self, tool: PlainTool) -> PlainToolType:
        return PlainToolType(tool)


class PydanticAILayer[DepsT: LayerDeps, AgentDepsT](
    Layer[DepsT, PydanticAIPrompt[AgentDepsT], PydanticAITool[AgentDepsT]]
):
    """Layer base for pydantic-ai prompt and tool adapters."""

    @final
    @override
    def wrap_prompt(
        self,
        prompt: PydanticAIPrompt[AgentDepsT],
    ) -> PydanticAIPromptType[AgentDepsT]:
        return PydanticAIPromptType(prompt)

    @final
    @override
    def wrap_tool(self, tool: PydanticAITool[AgentDepsT]) -> PydanticAIToolType[AgentDepsT]:
        return PydanticAIToolType(tool)


__all__ = [
    "AllPromptTypes",
    "AllToolTypes",
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
