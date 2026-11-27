"""Keyword table serialization, object storage, and tenant-scoped SQL persistence."""

import json
from collections.abc import Mapping, Sequence
from typing import Any, Protocol

import orjson
from sqlalchemy import select
from sqlalchemy.orm import Session

from models.dataset import Dataset, DatasetKeywordTable, DocumentSegment
from repositories.knowledge.dataset_read_repository import get_dataset_keyword_table


class _KeywordStorage(Protocol):
    def load_once(self, key: str, /) -> bytes: ...

    def exists(self, key: str, /) -> bool: ...

    def save(self, key: str, data: bytes, /) -> None: ...

    def delete(self, key: str, /) -> None: ...


def keyword_file_key(tenant_id: str, dataset_id: str) -> str:
    return f"keyword_files/{tenant_id}/{dataset_id}.txt"


def _decode_sets(values: dict[str, Any]) -> dict[str, Any]:
    return {key: set(value) if isinstance(value, list) else value for key, value in values.items()}


def _encode_sets(value: object) -> list[object]:
    if isinstance(value, set):
        return list(value)
    raise TypeError(f"Object of type {type(value).__name__} is not JSON serializable")


def _decode_table(payload: str | bytes, *, decode_sets: bool) -> dict[str, Any]:
    """Decode valid stored JSON into a table; preserve posting lists when requested.

    Invalid JSON raises a decoder error and leaves the stored payload unchanged.
    """
    return json.loads(payload, object_hook=_decode_sets) if decode_sets else orjson.loads(payload)


def load_keyword_table(
    *,
    storage: _KeywordStorage,
    tenant_id: str,
    dataset_id: str,
    storage_type: str,
    data: str | None,
    decode_sets: bool = True,
) -> dict[str, Any] | None:
    """Load a stored table, converting posting lists to sets for mutation by default.

    The caller supplies the dataset's storage location. A missing table returns
    None; malformed data and storage errors propagate without changing the index.
    """
    if storage_type == "database":
        return _decode_table(data, decode_sets=decode_sets) if data else None
    file_key = keyword_file_key(tenant_id, dataset_id)
    try:
        payload = storage.load_once(file_key)
        return _decode_table(payload, decode_sets=decode_sets) if payload else None
    except FileNotFoundError:
        return None


def load_dataset_keyword_table(
    dataset: Dataset, *, storage: _KeywordStorage, session: Session
) -> dict[str, Any] | None:
    """Read a dataset's posting lists without converting the entire table to sets.

    The caller owns the session and supplies the tenant-scoped dataset. A missing
    table returns None; the stored index remains unchanged on success or error.
    """
    row = get_dataset_keyword_table(dataset, session=session)
    if row is None:
        return None
    return load_keyword_table(
        storage=storage,
        tenant_id=dataset.tenant_id,
        dataset_id=dataset.id,
        storage_type=row.data_source_type,
        data=row.keyword_table,
        decode_sets=False,
    )


def save_keyword_table(
    *, storage: _KeywordStorage, tenant_id: str, dataset_id: str, storage_type: str, table: dict[str, set[str]]
) -> str:
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


def persist_keyword_table(
    session: Session,
    *,
    tenant_id: str,
    dataset_id: str,
    storage_type: str,
    data: str,
    keywords: Mapping[str, Sequence[str]],
) -> None:
    """Write a tenant-owned table and segment keywords in the caller's transaction."""
    result = session.execute(
        select(Dataset.id, DatasetKeywordTable)
        .outerjoin(DatasetKeywordTable, DatasetKeywordTable.dataset_id == Dataset.id)
        .where(Dataset.id == dataset_id, Dataset.tenant_id == tenant_id)
    ).one_or_none()
    if result is None:
        raise LookupError("Dataset no longer exists")
    _, row = result
    if row is None:
        row = DatasetKeywordTable(
            dataset_id=dataset_id,
            data_source_type=storage_type,
            keyword_table=data if storage_type == "database" else "",
        )
        session.add(row)
    elif storage_type == "database":
        row.keyword_table = data
    if keywords:
        segments = session.scalars(
            select(DocumentSegment).where(
                DocumentSegment.tenant_id == tenant_id,
                DocumentSegment.dataset_id == dataset_id,
                DocumentSegment.index_node_id.in_(keywords),
            )
        )
        for segment in segments:
            assert segment.index_node_id is not None
            segment.keywords = list(keywords[segment.index_node_id])
    session.flush()
