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
    payload = {"record_id": record_id}
    if storage_key is not None:
        payload["storage_key"] = storage_key
    encoded_payload = base64.urlsafe_b64encode(json.dumps(payload, separators=(",", ":")).encode()).decode()
    return f"{_FILE_REFERENCE_PREFIX}{encoded_payload}"


def parse_file_reference(reference: str | None) -> FileReference | None:
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


def resolve_file_record_id(reference: str | None) -> str | None:
    parsed_reference = parse_file_reference(reference)
    if parsed_reference is None:
        return None
    return parsed_reference.record_id
