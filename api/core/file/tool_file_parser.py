from typing import TYPE_CHECKING, Callable

if TYPE_CHECKING:
    from core.tools.tool_file_manager import ToolFileManager

_tool_file_manager_factory: Callable[[], "ToolFileManager"] | None = None


class ToolFileParser:
    @staticmethod
    def get_tool_file_manager() -> "ToolFileManager":
        return _tool_file_manager_factory()


def set_tool_file_manager_factory(factory: Callable[[], "ToolFileManager"]) -> None:
    global _tool_file_manager_factory
    _tool_file_manager_factory = factory
