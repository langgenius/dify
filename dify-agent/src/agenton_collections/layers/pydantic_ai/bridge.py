"""Pydantic AI bridge prompt and tool layer.

This module keeps pydantic-ai's callable shapes intact through
``PydanticAILayer``. The bridge layer depends on ``ObjectLayer`` so callers have
one explicit graph node that provides the object used as
``RunContext[ObjectT].deps`` in pydantic-ai prompt and tool callables.
Bridge construction accepts pydantic-ai's ergonomic input forms and normalizes
them at the layer boundary: string system prompts become zero-arg system prompt
functions, user prompts stay as pydantic-ai ``UserContent`` values, and bare
tool functions become ``Tool`` instances.
"""

from collections.abc import Sequence
from dataclasses import dataclass

from pydantic_ai import Tool
from pydantic_ai.messages import UserContent
from pydantic_ai.tools import ToolFuncEither
from typing_extensions import override

from agenton.layers.base import LayerDeps
from agenton.layers.types import PydanticAILayer, PydanticAIPrompt, PydanticAITool, PydanticAIUserPrompt
from agenton_collections.layers.plain.basic import ObjectLayer


class PydanticAIBridgeLayerDeps[ObjectT](LayerDeps):
    """Dependencies required by ``PydanticAIBridgeLayer``."""

    object_layer: ObjectLayer[ObjectT]  # pyright: ignore[reportUninitializedInstanceVariable]


@dataclass
class PydanticAIBridgeLayer[ObjectT](PydanticAILayer[PydanticAIBridgeLayerDeps[ObjectT], ObjectT]):
    """Bridge layer for pydantic-ai prompts and tools using one object deps."""

    prefix: str | PydanticAIPrompt[ObjectT] | Sequence[str | PydanticAIPrompt[ObjectT]] = ()
    user: UserContent | Sequence[UserContent] = ()
    suffix: str | PydanticAIPrompt[ObjectT] | Sequence[str | PydanticAIPrompt[ObjectT]] = ()
    tool_entries: Sequence[PydanticAITool[ObjectT] | ToolFuncEither[ObjectT, ...]] = ()

    @property
    def run_deps(self) -> ObjectT:
        """Object to pass as pydantic-ai run deps for this layer."""
        return self.deps.object_layer.value

    @property
    @override
    def prefix_prompts(self) -> list[PydanticAIPrompt[ObjectT]]:
        return _normalize_prompts(self.prefix)

    @property
    @override
    def suffix_prompts(self) -> list[PydanticAIPrompt[ObjectT]]:
        return _normalize_prompts(self.suffix)

    @property
    @override
    def user_prompts(self) -> list[PydanticAIUserPrompt]:
        return _normalize_user_prompts(self.user)

    @property
    @override
    def tools(self) -> list[PydanticAITool[ObjectT]]:
        return [_normalize_tool(tool_entry) for tool_entry in self.tool_entries]


def _normalize_prompts[ObjectT](
    prompts: str | PydanticAIPrompt[ObjectT] | Sequence[str | PydanticAIPrompt[ObjectT]],
) -> list[PydanticAIPrompt[ObjectT]]:
    if isinstance(prompts, str):
        return [_normalize_prompt(prompts)]
    if isinstance(prompts, Sequence):
        return [_normalize_prompt(prompt) for prompt in prompts]
    return [prompts]


def _normalize_prompt[ObjectT](
    prompt: str | PydanticAIPrompt[ObjectT],
) -> PydanticAIPrompt[ObjectT]:
    if isinstance(prompt, str):
        return (lambda value: lambda: value)(prompt)
    return prompt


def _normalize_user_prompts(
    prompts: UserContent | Sequence[UserContent],
) -> list[PydanticAIUserPrompt]:
    if isinstance(prompts, str):
        return [prompts]
    if isinstance(prompts, Sequence):
        return list(prompts)
    return [prompts]


def _normalize_tool[ObjectT](
    tool_entry: PydanticAITool[ObjectT] | ToolFuncEither[ObjectT, ...],
) -> PydanticAITool[ObjectT]:
    if isinstance(tool_entry, Tool):
        return tool_entry
    return Tool(tool_entry)


__all__ = [
    "PydanticAIBridgeLayer",
    "PydanticAIBridgeLayerDeps",
]
