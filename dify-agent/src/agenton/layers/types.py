"""Typed layer family definitions.

``Layer`` itself is framework-neutral. This module defines typed layer families
that bind its system prompt, user prompt, and tool generic slots to concrete
contracts, such as ordinary strings with plain callable tools or pydantic-ai
prompt/tool shapes. The families keep the trailing schema generic slots open so
concrete layers can have ``config_type`` and ``runtime_state_type`` inferred from
type arguments instead of repeated class attributes. Config schemas use
``LayerConfig`` so they can also be embedded as
typed DTOs in serializable compositor config. Agenton core is state-only:
typed layer families do not expose runtime handle schemas or resource ownership.
Tagged aggregate aliases cover code paths that can accept any supported
prompt/tool family without changing the plain and pydantic-ai layer contracts.
Pydantic-ai names are imported for static analysis only, so ``agenton`` can be
imported without loading that optional integration at runtime.
Concrete reusable layers live under ``agenton_collections``.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, Generic, Literal

from typing_extensions import TypeVar, final, override

if TYPE_CHECKING:
    from pydantic_ai import Tool
    from pydantic_ai.messages import UserContent
    from pydantic_ai.tools import SystemPromptFunc

from pydantic import BaseModel

from agenton.layers.base import EmptyLayerConfig, EmptyRuntimeState, Layer, LayerConfig, LayerDeps

type PlainPrompt = str
type PlainUserPrompt = str
type PlainTool = Callable[..., Any]


type PydanticAIPrompt[AgentDepsT] = SystemPromptFunc[AgentDepsT]
type PydanticAIUserPrompt = UserContent
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
class PlainUserPromptType:
    """Tagged plain user prompt item for aggregate user prompt transformations."""

    value: PlainUserPrompt
    kind: Literal["plain"] = field(default="plain", init=False)


@dataclass(frozen=True, slots=True)
class PydanticAIPromptType[AgentDepsT]:
    """Tagged pydantic-ai prompt item for aggregate prompt transformations."""

    value: PydanticAIPrompt[AgentDepsT]
    kind: Literal["pydantic_ai"] = field(default="pydantic_ai", init=False)


@dataclass(frozen=True, slots=True)
class PydanticAIUserPromptType:
    """Tagged pydantic-ai user prompt item for aggregate user prompts."""

    value: PydanticAIUserPrompt
    kind: Literal["pydantic_ai"] = field(default="pydantic_ai", init=False)


@dataclass(frozen=True, slots=True)
class PydanticAIToolType[AgentDepsT]:
    """Tagged pydantic-ai tool item for aggregate tool transformations."""

    value: PydanticAITool[AgentDepsT]
    kind: Literal["pydantic_ai"] = field(default="pydantic_ai", init=False)


type AllPromptTypes = PlainPromptType | PydanticAIPromptType[Any]
type AllUserPromptTypes = PlainUserPromptType | PydanticAIUserPromptType
type AllToolTypes = PlainToolType | PydanticAIToolType[Any]


_DepsT = TypeVar("_DepsT", bound=LayerDeps)
_ConfigT = TypeVar("_ConfigT", bound=LayerConfig, default=EmptyLayerConfig)
_RuntimeStateT = TypeVar("_RuntimeStateT", bound=BaseModel, default=EmptyRuntimeState)
_AgentDepsT = TypeVar("_AgentDepsT")


class PlainLayer(
    Generic[_DepsT, _ConfigT, _RuntimeStateT],
    Layer[
        _DepsT,
        PlainPrompt,
        PlainUserPrompt,
        PlainTool,
        _ConfigT,
        _RuntimeStateT,
    ],
):
    """Layer base for ordinary string prompts and plain-callable tools."""

    @final
    @override
    def wrap_prompt(self, prompt: PlainPrompt) -> PlainPromptType:
        return PlainPromptType(prompt)

    @final
    @override
    def wrap_user_prompt(self, prompt: PlainUserPrompt) -> PlainUserPromptType:
        return PlainUserPromptType(prompt)

    @final
    @override
    def wrap_tool(self, tool: PlainTool) -> PlainToolType:
        return PlainToolType(tool)


class PydanticAILayer(
    Generic[_DepsT, _AgentDepsT, _ConfigT, _RuntimeStateT],
    Layer[
        _DepsT,
        PydanticAIPrompt[_AgentDepsT],
        PydanticAIUserPrompt,
        PydanticAITool[_AgentDepsT],
        _ConfigT,
        _RuntimeStateT,
    ],
):
    """Layer base for pydantic-ai prompt and tool adapters."""

    @final
    @override
    def wrap_prompt(
        self,
        prompt: PydanticAIPrompt[_AgentDepsT],
    ) -> PydanticAIPromptType[_AgentDepsT]:
        return PydanticAIPromptType(prompt)

    @final
    @override
    def wrap_user_prompt(self, prompt: PydanticAIUserPrompt) -> PydanticAIUserPromptType:
        return PydanticAIUserPromptType(prompt)

    @final
    @override
    def wrap_tool(self, tool: PydanticAITool[_AgentDepsT]) -> PydanticAIToolType[_AgentDepsT]:
        return PydanticAIToolType(tool)


__all__ = [
    "AllPromptTypes",
    "AllUserPromptTypes",
    "AllToolTypes",
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
