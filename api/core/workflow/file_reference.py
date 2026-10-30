"""Opaque file reference helpers for workflow/runtime-facing file identities.

The canonical Dify file reference format is ``dify-file-ref:<base64url-json>``
where the JSON payload always contains ``record_id`` and may optionally carry
``storage_key`` for older compatibility paths. New agent-v2 file output and
download contracts require this opaque canonical format instead of raw record
ids.

This module intentionally supports both canonical and historical identities:

- :func:`is_canonical_file_reference` is the strict validator for new
  canonical-only contracts.
- :func:`parse_file_reference` and :func:`resolve_file_record_id` accept
  historical raw ids, while rejecting canonical-prefixed values without a
  valid record identity. Historical invalid ``storage_key`` metadata is ignored
  because it must not hide an otherwise valid ``record_id``.

Callers enforcing canonical-only behavior must not use the permissive helpers as
validators.
"""

from __future__ import annotations

import base64
import json
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

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

    Historical raw ids remain readable. Once a value uses the canonical prefix,
    its base64, JSON object, and ``record_id`` must be valid. The optional
    ``storage_key`` is compatibility metadata: non-string historical values are
    ignored rather than invalidating the record identity.
    """
    if not reference:
        return None

    if not reference.startswith(_FILE_REFERENCE_PREFIX):
        return FileReference(record_id=reference)

    encoded_payload = reference.removeprefix(_FILE_REFERENCE_PREFIX)
    try:
        decoded_payload = base64.b64decode(encoded_payload.encode(), altchars=b"-_", validate=True)
        payload = json.loads(decoded_payload)
    except ValueError:
        return None

    if not isinstance(payload, Mapping):
        return None

    record_id = payload.get("record_id")
    if not isinstance(record_id, str) or not record_id:
        return None

    encoded_storage_key = payload.get("storage_key")
    storage_key = encoded_storage_key if isinstance(encoded_storage_key, str) else None

    return FileReference(record_id=record_id, storage_key=storage_key)


def is_canonical_file_reference(reference: str | None) -> bool:
    """Return whether one value matches the strict canonical file format.

    Use this when new contracts require ``dify-file-ref:...`` and raw record ids
    must be rejected.
    """
    if not reference or not reference.startswith(_FILE_REFERENCE_PREFIX):
        return False
    return parse_file_reference(reference) is not None


def resolve_file_record_id(reference: str | None) -> str | None:
    """Resolve a canonical reference or historical raw id to its record id.

    Canonical-prefixed malformed values resolve to ``None``. Canonical-only call
    sites should still validate with :func:`is_canonical_file_reference` first.
    """
    parsed_reference = parse_file_reference(reference)
    if parsed_reference is None:
        return None
    return parsed_reference.record_id


def resolve_local_file_record_id(file_mapping: Mapping[str, Any]) -> str | None:
    """Resolve the persisted UploadFile id from every supported local-file schema."""
    real_file_id = file_mapping.get("real_file_id")
    if isinstance(real_file_id, str) and real_file_id:
        return real_file_id

    reference = file_mapping.get("reference") or file_mapping.get("related_id")
    return resolve_file_record_id(reference if isinstance(reference, str) else None)
