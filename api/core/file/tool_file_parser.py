from typing import TYPE_CHECKING, Any, cast

if TYPE_CHECKING:
    from core.tools.tool_file_manager import ToolFileManager

tool_file_manager: dict[str, Any] = {"manager": None}


class ToolFileParser:
    @staticmethod
    def get_tool_file_manager() -> "ToolFileManager":
        return cast("ToolFileManager", tool_file_manager["manager"])
