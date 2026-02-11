"""Compatibility bridge for legacy ``core.file.tool_file_parser`` imports."""

from collections.abc import Callable
from typing import Any

from core.workflow.file import tool_file_parser as workflow_tool_file_parser

_tool_file_manager_factory: Callable[[], Any] | None = None


def set_tool_file_manager_factory(factory: Callable[[], Any]) -> None:
    global _tool_file_manager_factory
    _tool_file_manager_factory = factory
    workflow_tool_file_parser.set_tool_file_manager_factory(factory)


__all__ = [
    "_tool_file_manager_factory",
    "set_tool_file_manager_factory",
]
