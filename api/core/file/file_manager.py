"""Compatibility bridge for legacy ``core.file.file_manager`` imports."""

from core.workflow.file.file_manager import FileManager, download, file_manager, get_attr, to_prompt_message_content

__all__ = [
    "FileManager",
    "download",
    "file_manager",
    "get_attr",
    "to_prompt_message_content",
]
