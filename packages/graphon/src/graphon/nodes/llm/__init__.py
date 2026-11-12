from __future__ import annotations

from typing import TYPE_CHECKING

from .entities import (
    LLMNodeChatModelMessage,
    LLMNodeCompletionModelPromptTemplate,
    LLMNodeData,
    ModelConfig,
    VisionConfig,
)

if TYPE_CHECKING:
    from .node import LLMNode

__all__ = [
    "LLMNode",
    "LLMNodeChatModelMessage",
    "LLMNodeCompletionModelPromptTemplate",
    "LLMNodeData",
    "ModelConfig",
    "VisionConfig",
]


def __getattr__(name: str) -> type[LLMNode]:
    if name == "LLMNode":
        from .node import LLMNode  # ruff: ignore[import-outside-top-level]

        return LLMNode
    msg = f"module {__name__!r} has no attribute {name!r}"
    raise AttributeError(msg)
