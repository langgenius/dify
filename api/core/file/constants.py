"""Compatibility bridge for legacy ``core.file.constants`` imports."""

from core.workflow.file.constants import FILE_MODEL_IDENTITY, maybe_file_object

__all__ = [
    "FILE_MODEL_IDENTITY",
    "maybe_file_object",
]
