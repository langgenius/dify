"""Pydantic AI bridge prompt and tool layer.

This module keeps pydantic-ai's callable shapes intact through
``PydanticAILayer``. The bridge layer depends on ``ObjectLayer`` so callers have
one explicit graph node that provides the object used as
``RunContext[ObjectT].deps`` in pydantic-ai prompt and tool callables.
"""

from collections.abc import Sequence
from dataclasses import dataclass

from typing_extensions import override

from agenton.layers.base import LayerDeps
from agenton.layers.types import PydanticAILayer, PydanticAIPrompt, PydanticAITool
from agenton_collections.layers.plain.basic import ObjectLayer

type PydanticAIPrompts[ObjectT] = PydanticAIPrompt[ObjectT] | Sequence[PydanticAIPrompt[ObjectT]]


class PydanticAIBridgeLayerDeps[ObjectT](LayerDeps):
    """Dependencies required by ``PydanticAIBridgeLayer``."""

    object_layer: ObjectLayer[ObjectT]  # pyright: ignore[reportUninitializedInstanceVariable]


@dataclass
class PydanticAIBridgeLayer[ObjectT](
    PydanticAILayer[PydanticAIBridgeLayerDeps[ObjectT], ObjectT]
):
    """Bridge layer for pydantic-ai prompts and tools using one object deps."""

    prefix: PydanticAIPrompts[ObjectT] = ()
    suffix: PydanticAIPrompts[ObjectT] = ()
    tool_entries: Sequence[PydanticAITool[ObjectT]] = ()

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
    def tools(self) -> list[PydanticAITool[ObjectT]]:
        return list(self.tool_entries)


def _normalize_prompts[ObjectT](
    prompts: PydanticAIPrompts[ObjectT],
) -> list[PydanticAIPrompt[ObjectT]]:
    if isinstance(prompts, str) or callable(prompts):
        return [prompts]
    return list(prompts)


__all__ = [
    "PydanticAIBridgeLayer",
    "PydanticAIBridgeLayerDeps",
    "PydanticAIPrompts",
]
