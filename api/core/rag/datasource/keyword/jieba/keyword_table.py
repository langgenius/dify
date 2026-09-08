"""The persisted Jieba table format and its optional object-storage payload."""

import json
from typing import Any

import orjson

from extensions.ext_storage import storage


def keyword_file_key(tenant_id: str, dataset_id: str) -> str:
    return f"keyword_files/{tenant_id}/{dataset_id}.txt"


def _decode_sets(values: dict[str, Any]) -> dict[str, Any]:
    return {key: set(value) if isinstance(value, list) else value for key, value in values.items()}


def _encode_sets(value: object) -> list[object]:
    if isinstance(value, set):
        return list(value)
    raise TypeError(f"Object of type {type(value).__name__} is not JSON serializable")


def load_keyword_table(
    *, tenant_id: str, dataset_id: str, storage_type: str, data: str | None
) -> dict[str, Any] | None:
    if storage_type == "database":
        return json.loads(data, object_hook=_decode_sets) if data else None
    file_key = keyword_file_key(tenant_id, dataset_id)
    try:
        payload = storage.load_once(file_key)
        return json.loads(payload.decode("utf-8"), object_hook=_decode_sets) if payload else None
    except FileNotFoundError:
        return None


def save_keyword_table(*, tenant_id: str, dataset_id: str, storage_type: str, table: dict[str, set[str]]) -> str:
    data = orjson.dumps(
        {"__type__": "keyword_table", "__data__": {"index_id": dataset_id, "summary": None, "table": table}},
        default=_encode_sets,
    )
    if storage_type != "database":
        file_key = keyword_file_key(tenant_id, dataset_id)
        if storage.exists(file_key):
            storage.delete(file_key)
        storage.save(file_key, data)
    return data.decode("utf-8")
