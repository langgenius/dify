"""Keyword table serialization, object storage, and tenant-scoped SQL persistence."""

import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Protocol

import orjson
from sqlalchemy import select
from sqlalchemy.orm import Session

from models.dataset import Dataset, DatasetKeywordTable, DocumentSegment
from repositories.knowledge.dataset_read_repository import get_dataset_keyword_table


@dataclass(frozen=True)
class KeywordTableState:
    storage_type: str
    data: str | None


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


def load_keyword_table(
    *, storage: _KeywordStorage, tenant_id: str, dataset_id: str, storage_type: str, data: str | None
) -> dict[str, Any] | None:
    if storage_type == "database":
        return json.loads(data, object_hook=_decode_sets) if data else None
    file_key = keyword_file_key(tenant_id, dataset_id)
    try:
        payload = storage.load_once(file_key)
        return json.loads(payload.decode("utf-8"), object_hook=_decode_sets) if payload else None
    except FileNotFoundError:
        return None


def load_dataset_keyword_table(
    dataset: Dataset, *, storage: _KeywordStorage, session: Session
) -> dict[str, Any] | None:
    """Resolve a dataset's stored keyword payload using the caller's session."""
    row = get_dataset_keyword_table(dataset, session=session)
    if row is None:
        return None
    return load_keyword_table(
        storage=storage,
        tenant_id=dataset.tenant_id,
        dataset_id=dataset.id,
        storage_type=row.data_source_type,
        data=row.keyword_table,
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


def tenant_dataset_exists(session: Session, *, tenant_id: str, dataset_id: str, lock: bool = False) -> bool:
    stmt = select(Dataset.id).where(
        Dataset.id == dataset_id,
        Dataset.tenant_id == tenant_id,
    )
    if lock:
        stmt = stmt.with_for_update()
    return session.scalar(stmt) is not None


def read_keyword_table_state(
    session: Session,
    *,
    tenant_id: str,
    dataset_id: str,
    fallback_storage_type: str,
) -> KeywordTableState:
    row = session.scalar(select(DatasetKeywordTable).where(DatasetKeywordTable.dataset_id == dataset_id).limit(1))
    if row is None:
        return KeywordTableState(storage_type=fallback_storage_type, data=None)
    return KeywordTableState(storage_type=row.data_source_type, data=row.keyword_table)


def get_keyword_table_storage_type(session: Session, dataset_id: str) -> str | None:
    return session.scalar(
        select(DatasetKeywordTable.data_source_type).where(DatasetKeywordTable.dataset_id == dataset_id).limit(1)
    )


def delete_keyword_table(session: Session, dataset_id: str) -> str | None:
    """Delete and return the storage type while serializing concurrent writers."""

    row = session.scalar(
        select(DatasetKeywordTable).where(DatasetKeywordTable.dataset_id == dataset_id).with_for_update()
    )
    if row is None:
        return None
    storage_type = row.data_source_type
    session.delete(row)
    return storage_type


def persist_keyword_table_for_existing_dataset(
    session: Session,
    *,
    tenant_id: str,
    dataset_id: str,
    storage_type: str,
    data: str,
    keywords: Mapping[str, Sequence[str]],
) -> None:
    """Serialize a cleanup write against deletion of its tenant-owned dataset."""

    if not tenant_dataset_exists(session, tenant_id=tenant_id, dataset_id=dataset_id, lock=True):
        raise RuntimeError("dataset was deleted during keyword cleanup")
    persist_keyword_table(
        session,
        tenant_id=tenant_id,
        dataset_id=dataset_id,
        storage_type=storage_type,
        data=data,
        keywords=keywords,
    )
