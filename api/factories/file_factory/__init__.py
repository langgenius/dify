"""Workflow file factory package.

This package normalizes workflow-layer file payloads into graph-layer ``File``
values. It keeps tenancy and ownership checks in the application layer and
preserves the historical ``factories.file_factory`` import surface for callers.
"""

from core.helper import ssrf_proxy
from dify_graph.file import File, FileTransferMethod, FileType, FileUploadConfig
from extensions.ext_database import db

from .builders import build_from_mapping, build_from_mappings
from .message_files import build_from_message_file, build_from_message_files
from .remote import _extract_filename, _get_remote_file_info
from .storage_keys import StorageKeyLoader

__all__ = [
    "File",
    "FileTransferMethod",
    "FileType",
    "FileUploadConfig",
    "StorageKeyLoader",
    "_extract_filename",
    "_get_remote_file_info",
    "build_from_mapping",
    "build_from_mappings",
    "build_from_message_file",
    "build_from_message_files",
    "db",
    "ssrf_proxy",
]
