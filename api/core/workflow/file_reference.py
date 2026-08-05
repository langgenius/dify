"""Opaque file reference helpers for workflow/runtime-facing file identities.

The canonical Dify file reference format is ``dify-file-ref:<base64url-json>``
where the JSON payload always contains ``record_id`` and may optionally carry
``storage_key`` for older compatibility paths. New agent-v2 file output and
download contracts require this opaque canonical format instead of raw record
ids.

This module intentionally exposes both strict and permissive helpers:

- :func:`is_canonical_file_reference` is the strict validator for new
  canonical-only contracts.
- :func:`parse_file_reference` and :func:`resolve_file_record_id` remain lenient
  so historical rows and legacy payloads that stored raw ids or malformed
  values can still be read.

Callers enforcing canonical-only behavior must not use the permissive helpers as
validators.
"""

from __future__ import annotations

import base64
import json
from dataclasses import dataclass

_FILE_REFERENCE_PREFIX = "dify-file-ref:"


@dataclass(frozen=True)
class FileReference:
    record_id: str
    storage_key: str | None = None


def build_file_reference(*, record_id: str, storage_key: str | None = None) -> str:
    """Build one canonical opaque ``dify-file-ref:...`` string.

    New external/runtime contracts should emit this value instead of exposing
    the underlying DB record id directly.
    """
    payload = {"record_id": record_id}
    if storage_key is not None:
        payload["storage_key"] = storage_key
    encoded_payload = base64.urlsafe_b64encode(json.dumps(payload, separators=(",", ":")).encode()).decode()
    return f"{_FILE_REFERENCE_PREFIX}{encoded_payload}"


def parse_file_reference(reference: str | None) -> FileReference | None:
    """Best-effort parse for canonical and historical file references.

    This helper is intentionally lenient: when the input is a raw id or a
    malformed canonical string, it falls back to treating the whole input as the
    ``record_id`` so older persisted payloads remain readable.
    """
    if not reference:
        return None

    if not reference.startswith(_FILE_REFERENCE_PREFIX):
        return FileReference(record_id=reference)

    encoded_payload = reference.removeprefix(_FILE_REFERENCE_PREFIX)
    try:
        payload = json.loads(base64.urlsafe_b64decode(encoded_payload.encode()))
    except (ValueError, json.JSONDecodeError):
        return FileReference(record_id=reference)

    record_id = payload.get("record_id")
    if not isinstance(record_id, str) or not record_id:
        return FileReference(record_id=reference)

    storage_key = payload.get("storage_key")
    if storage_key is not None and not isinstance(storage_key, str):
        storage_key = None

    return FileReference(record_id=record_id, storage_key=storage_key)


def is_canonical_file_reference(reference: str | None) -> bool:
    """Return whether one value matches the strict canonical file format.

    Use this when new contracts require ``dify-file-ref:...`` and raw record ids
    must be rejected.
    """
    parsed_reference = parse_file_reference(reference)
    if parsed_reference is None or reference is None:
        return False
    return reference.startswith(_FILE_REFERENCE_PREFIX) and parsed_reference.record_id != reference


def resolve_file_record_id(reference: str | None) -> str | None:
    """Resolve one file reference back to a record id permissively.

    This is a compatibility helper, not a canonical-format validator.
    Canonical-only call sites should validate with
    :func:`is_canonical_file_reference` first.
    """
    parsed_reference = parse_file_reference(reference)
    if parsed_reference is None:
        return None
    return parsed_reference.record_id
