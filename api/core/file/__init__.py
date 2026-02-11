"""Compatibility bridge for legacy ``core.file`` imports.

Phase 1 keeps this package as a forwarding layer while canonical file models and
helpers live under ``core.workflow.file``.
"""

from core.workflow.file import (
    FILE_MODEL_IDENTITY,
    ArrayFileAttribute,
    File,
    FileAttribute,
    FileBelongsTo,
    FileTransferMethod,
    FileType,
    FileUploadConfig,
    ImageConfig,
)

__all__ = [
    "FILE_MODEL_IDENTITY",
    "ArrayFileAttribute",
    "File",
    "FileAttribute",
    "FileBelongsTo",
    "FileTransferMethod",
    "FileType",
    "FileUploadConfig",
    "ImageConfig",
]
