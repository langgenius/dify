from collections.abc import Callable
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from core.tools.tool_file_manager import ToolFileManager

_tool_file_manager_factory: Callable[[], "ToolFileManager"] | None = None


class ToolFileParser:
    @staticmethod
    def get_tool_file_manager() -> "ToolFileManager":
        assert _tool_file_manager_factory is not None
        return _tool_file_manager_factory()


def set_tool_file_manager_factory(factory: Callable[[], "ToolFileManager"]) -> None:
    global _tool_file_manager_factory
    _tool_file_manager_factory = factory
