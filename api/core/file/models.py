"""Compatibility bridge for legacy ``core.file.models`` imports."""

from core.workflow.file.models import File, FileUploadConfig, ImageConfig, sign_tool_file

__all__ = [
    "File",
    "FileUploadConfig",
    "ImageConfig",
    "sign_tool_file",
]
