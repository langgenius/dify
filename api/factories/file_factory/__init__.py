"""Workflow file factory package.

This package normalizes workflow-layer file payloads into graph-layer ``File``
values. It keeps tenancy and ownership checks in the application layer and
exports the workflow-facing file builders for callers.
"""

from .builders import build_from_mapping, build_from_mappings
from .message_files import build_from_message_file, build_from_message_files
from .storage_keys import StorageKeyLoader

__all__ = [
    "StorageKeyLoader",
    "build_from_mapping",
    "build_from_mappings",
    "build_from_message_file",
    "build_from_message_files",
]
