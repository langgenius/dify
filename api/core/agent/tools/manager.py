"""Agent built-in tools manager."""

from collections.abc import Sequence
from typing import TYPE_CHECKING

from core.file import File
from core.tools.__base.tool import Tool

from .file_dispatcher import FileDispatcherTool

if TYPE_CHECKING:
    pass


class AgentBuiltinToolsManager:
    """Manager for agent built-in tools."""

    @staticmethod
    def create_file_dispatcher(
        files: Sequence[File],
        tool_file_map: dict[str, dict[str, File]] | None = None,
    ) -> Tool | None:
        """Create file dispatcher tool if files are available.

        Args:
            files: Available files
            tool_file_map: Shared map for tool files

        Returns:
            FileDispatcherTool if files exist, None otherwise
        """
        if not files:
            return None

        try:
            return FileDispatcherTool(files, tool_file_map)
        except Exception as e:
            # Log error but don't fail the agent
            import logging

            logger = logging.getLogger(__name__)
            logger.warning("Failed to create file dispatcher: %s", e)
            return None
