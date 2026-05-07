"""Validation helpers for workflow file inputs."""

from __future__ import annotations

from collections.abc import Iterable

from graphon.file import FileTransferMethod, FileType, FileUploadConfig


def _normalize_extension(extension: str) -> str:
    if not extension:
        return ""
    s = extension.strip().lower()
    return s if s.startswith(".") else "." + s


def _extension_matches(extension: str, whitelist: Iterable[str]) -> bool:
    return _normalize_extension(extension) in {_normalize_extension(e) for e in whitelist}


def is_file_valid_with_config(
    *,
    input_file_type: str,
    file_extension: str,
    file_transfer_method: FileTransferMethod,
    config: FileUploadConfig,
) -> bool:
    """Return whether the file is allowed by the upload config.

    ``allowed_file_types`` lists the buckets a file may fall into; ``CUSTOM`` is
    a fallback bucket gated by ``allowed_file_extensions`` (case- and
    dot-insensitive). Tool-generated files bypass user-facing config.
    """
    if file_transfer_method == FileTransferMethod.TOOL_FILE:
        return True

    allowed_types = config.allowed_file_types or []
    custom_allowed = FileType.CUSTOM in allowed_types
    type_allowed = not allowed_types or input_file_type in allowed_types

    if not type_allowed and not custom_allowed:
        return False

    in_custom_bucket = input_file_type == FileType.CUSTOM or not type_allowed
    if (
        in_custom_bucket
        and config.allowed_file_extensions
        and not _extension_matches(file_extension, config.allowed_file_extensions)
    ):
        return False

    if input_file_type == FileType.IMAGE:
        if (
            config.image_config
            and config.image_config.transfer_methods
            and file_transfer_method not in config.image_config.transfer_methods
        ):
            return False
    elif config.allowed_file_upload_methods and file_transfer_method not in config.allowed_file_upload_methods:
        return False

    return True
