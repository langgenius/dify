from collections.abc import Callable
from typing import Any

_tool_file_manager_factory: Callable[[], Any] | None = None


def set_tool_file_manager_factory(factory: Callable[[], Any]):
    global _tool_file_manager_factory
    _tool_file_manager_factory = factory
