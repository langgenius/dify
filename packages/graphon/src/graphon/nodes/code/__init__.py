from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .code_node import CodeNode

__all__ = ["CodeNode"]


def __getattr__(name: str) -> type[CodeNode]:
    if name == "CodeNode":
        from .code_node import CodeNode  # ruff: ignore[import-outside-top-level]

        return CodeNode
    msg = f"module {__name__!r} has no attribute {name!r}"
    raise AttributeError(msg)
