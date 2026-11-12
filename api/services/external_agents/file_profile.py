"""Frozen v1 byte-input profile; no File is silently stringified or URL-forwarded."""

import base64
import json
import math
from collections.abc import Sequence
from dataclasses import dataclass

from .io_contracts import (
    ExternalIOError,
    FileBlob,
    FileReference,
    FileScope,
    InputFileReaderPort,
    JsonObject,
    JsonValue,
)

_ALIASES = {"image/jpg": "image/jpeg", "application/x-pdf": "application/pdf", "text/x-markdown": "text/markdown"}
FILE_MODES = frozenset({"application/pdf", "text/plain", "text/markdown", "image/png", "image/jpeg"})


@dataclass(frozen=True, slots=True, kw_only=True)
class FileLimits:
    """Effective limits: composition must intersect these with stricter deployment limits."""

    max_files: int = 5
    max_document_bytes: int = 15 * 1024 * 1024
    max_image_bytes: int = 10 * 1024 * 1024
    max_total_bytes: int = 30 * 1024 * 1024


DEFAULT_FILE_LIMITS = FileLimits()


def normalize_media_type(value: str) -> str:
    """Normalize documented MIME aliases and parameters without guessing file types."""
    media_type = value.split(";", 1)[0].strip().lower()
    return _ALIASES.get(media_type, media_type)


def file_byte_limit(media_type: str, limits: FileLimits) -> int:
    """Return the supported effective limit; reject unsupported file MIME types."""
    normalized = normalize_media_type(media_type)
    if normalized not in FILE_MODES:
        raise ExternalIOError("unsupported_file_type", "The file format is outside the supported BYOA profile.")
    return min(
        limits.max_image_bytes if normalized.startswith("image/") else limits.max_document_bytes, limits.max_total_bytes
    )


def validate_blob(blob: FileBlob, limits: FileLimits) -> None:
    """Require safe metadata and bounded bytes; never truncate or rewrite the file."""
    if (
        not blob.filename
        or len(blob.filename) > 255
        or any(c in blob.filename for c in ("/", "\\", "\x00", "\r", "\n"))
    ):
        raise ExternalIOError("invalid_filename", "A bounded filename without path components is required.")
    if len(blob.data) > file_byte_limit(blob.media_type, limits):
        raise ExternalIOError("file_too_large", "The file exceeds the effective BYOA size limit.")


def _mode_supported(media_type: str, declared_modes: Sequence[str]) -> bool:
    modes = {normalize_media_type(mode) for mode in declared_modes}
    return media_type in modes or f"{media_type.split('/')[0]}/*" in modes or "*/*" in modes


def build_input_parts(
    task_text: str,
    references: Sequence[FileReference],
    *,
    scope: FileScope,
    reader: InputFileReaderPort,
    agent_input_modes: Sequence[str],
    limits: FileLimits = DEFAULT_FILE_LIMITS,
) -> tuple[JsonObject, ...]:
    """Read authorized explicit files and produce ordered base64 Parts before dispatch.

    All bounds and defaultInputModes gates are checked before the caller can
    send a business request. No signed Dify URL, login token or storage path is
    returned. Array[File] callers pass its ordered expanded references here.
    """
    if len(references) > limits.max_files:
        raise ExternalIOError("too_many_files", "The request exceeds the effective file count limit.")
    if not _mode_supported("text/plain", agent_input_modes):
        raise ExternalIOError("agent_text_mode_unsupported", "The Agent defaults do not accept task text.")
    # MIME is known only after the admitted reader resolves the stored record.
    # A stricter document deployment cap must not also shrink the independently
    # advertised image cap. The reader and validate_blob still enforce the
    # resolved file's own MIME limit, and total bytes remain a separate gate.
    read_bound = min(max(limits.max_document_bytes, limits.max_image_bytes), limits.max_total_bytes)
    blobs = tuple(reader.read_authorized(scope, ref, max_bytes=read_bound) for ref in references)
    total = 0
    parts: list[JsonObject] = [{"text": task_text, "mediaType": "text/plain"}]
    for blob in blobs:
        validate_blob(blob, limits)
        media_type = normalize_media_type(blob.media_type)
        if not _mode_supported(media_type, agent_input_modes):
            raise ExternalIOError(
                "agent_file_mode_unsupported", "The Agent defaults do not accept this file MIME type."
            )
        total += len(blob.data)
        if total > limits.max_total_bytes:
            raise ExternalIOError("file_total_too_large", "The total input file bytes exceed the effective limit.")
        parts.append(
            {"raw": base64.b64encode(blob.data).decode("ascii"), "filename": blob.filename, "mediaType": media_type}
        )
    return tuple(parts)


def render_task_value(value: JsonValue) -> str:
    """Render ordinary values explicitly; caller must preserve typed File references.

    JsonValue is the admitted non-file variable domain. File objects or mappings
    marked as Dify Files, including nested ones, are rejected instead of leaked
    into a text prompt. Non-finite numbers are never valid JSON input.
    """

    def validate(item: object) -> None:
        if isinstance(item, dict):
            if item.get("dify_model_identity") == "__dify__file__":
                raise ExternalIOError(
                    "nested_file_input", "File values must be passed through explicit typed file references."
                )
            for child in item.values():
                validate(child)
        elif isinstance(item, list):
            for child in item:
                validate(child)
        elif isinstance(item, float) and not math.isfinite(item):
            raise ExternalIOError("invalid_input_number", "Input numbers must be finite.")
        elif not isinstance(item, str | bool | int | float | type(None)):
            raise ExternalIOError("unsupported_input_value", "The task contains an unsupported typed value.")

    validate(value)
    return (
        value
        if isinstance(value, str)
        else json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":"))
    )
