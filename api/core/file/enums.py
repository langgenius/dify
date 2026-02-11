"""Compatibility bridge for legacy ``core.file.enums`` imports."""

from core.workflow.file.enums import ArrayFileAttribute, FileAttribute, FileBelongsTo, FileTransferMethod, FileType

__all__ = [
    "FileType",
    "FileTransferMethod",
    "FileBelongsTo",
    "FileAttribute",
    "ArrayFileAttribute",
]
