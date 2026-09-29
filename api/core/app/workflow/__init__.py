"""Workflow app adapters; importing file helpers does not load every node runtime."""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from core.workflow.node_factory import DifyNodeFactory

__all__ = ["DifyNodeFactory"]


def __getattr__(name: str) -> type[DifyNodeFactory]:
    if name == "DifyNodeFactory":
        from core.workflow.node_factory import DifyNodeFactory

        globals()[name] = DifyNodeFactory
        return DifyNodeFactory
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
