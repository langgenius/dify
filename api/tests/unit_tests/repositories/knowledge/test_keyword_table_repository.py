import json

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from models.dataset import Dataset, DatasetKeywordTable, DocumentSegment
from repositories.knowledge.keyword_table_repository import (
    keyword_file_key,
    load_keyword_table,
    persist_keyword_table,
    save_keyword_table,
)


class KeywordStorage:
    def __init__(self, files: dict[str, bytes]) -> None:
        self.files = files

    def load_once(self, key: str) -> bytes:
        if key not in self.files:
            raise FileNotFoundError(key)
        return self.files[key]

    def exists(self, key: str) -> bool:
        return key in self.files

    def save(self, key: str, data: bytes) -> None:
        self.files[key] = data

    def delete(self, key: str) -> None:
        self.files.pop(key, None)


def test_load_keyword_table_decodes_sets_from_database() -> None:
    payload = load_keyword_table(
        storage=KeywordStorage({}),
        tenant_id="tenant-1",
        dataset_id="dataset-1",
        storage_type="database",
        data='{"__data__":{"table":{"current":["node-1"]}}}',
    )

    assert payload == {"__data__": {"table": {"current": {"node-1"}}}}


def test_load_file_keyword_table_uses_the_dataset_fixed_key() -> None:
    key = keyword_file_key("tenant-1", "dataset-1")
    storage = KeywordStorage({key: b'{"__data__":{"table":{"legacy":["node-1"]}}}'})

    payload = load_keyword_table(
        storage=storage,
        tenant_id="tenant-1",
        dataset_id="dataset-1",
        storage_type="file",
        data="an-obsolete-pointer",
    )

    assert payload == {"__data__": {"table": {"legacy": {"node-1"}}}}


def test_load_missing_file_keyword_table_returns_none() -> None:
    assert (
        load_keyword_table(
            storage=KeywordStorage({}),
            tenant_id="tenant-1",
            dataset_id="dataset-1",
            storage_type="file",
            data=None,
        )
        is None
    )


def test_save_file_keyword_table_replaces_the_fixed_key() -> None:
    key = keyword_file_key("tenant-1", "dataset-1")
    storage = KeywordStorage({key: b"old"})

    serialized = save_keyword_table(
        storage=storage,
        tenant_id="tenant-1",
        dataset_id="dataset-1",
        storage_type="file",
        table={"new": {"node-2", "node-1"}},
    )

    assert storage.files == {key: serialized.encode()}
    payload = json.loads(serialized)
    assert payload["__type__"] == "keyword_table"
    assert payload["__data__"]["index_id"] == "dataset-1"
    assert set(payload["__data__"]["table"]["new"]) == {"node-1", "node-2"}


def test_save_database_keyword_table_does_not_touch_object_storage() -> None:
    storage = KeywordStorage({"unrelated": b"keep"})

    serialized = save_keyword_table(
        storage=storage,
        tenant_id="tenant-1",
        dataset_id="dataset-1",
        storage_type="database",
        table={"term": {"node-1"}},
    )

    assert json.loads(serialized)["__data__"]["table"] == {"term": ["node-1"]}
    assert storage.files == {"unrelated": b"keep"}


@pytest.mark.parametrize("existing_table", [False, True])
def test_keyword_writes_roll_back_with_the_callers_transaction(sqlite_session: Session, existing_table: bool) -> None:
    sqlite_session.add(Dataset(id="dataset-1", tenant_id="tenant-1", name="Test", created_by="author"))
    segment = DocumentSegment(
        tenant_id="tenant-1",
        dataset_id="dataset-1",
        document_id="document-1",
        position=1,
        content="original",
        word_count=8,
        tokens=1,
        created_by="author",
        index_node_id="node-1",
        keywords=["original"],
    )
    sqlite_session.add(segment)
    if existing_table:
        sqlite_session.add(DatasetKeywordTable(dataset_id="dataset-1", keyword_table="original"))
    sqlite_session.commit()

    persist_keyword_table(
        sqlite_session,
        tenant_id="tenant-1",
        dataset_id="dataset-1",
        storage_type="database",
        data="replacement",
        keywords={"node-1": ["replacement"]},
    )
    assert segment.keywords == ["replacement"]
    sqlite_session.rollback()

    assert segment.keywords == ["original"]
    row = sqlite_session.scalar(select(DatasetKeywordTable))
    assert (row is not None) is existing_table
    if row is not None:
        assert row.keyword_table == "original"


@pytest.mark.parametrize(("tenant_id", "dataset_id"), [("tenant-2", "dataset-1"), ("tenant-1", "missing")])
def test_keyword_writes_require_a_tenant_owned_dataset(
    sqlite_session: Session, tenant_id: str, dataset_id: str
) -> None:
    sqlite_session.add(Dataset(id="dataset-1", tenant_id="tenant-1", name="Test", created_by="author"))
    sqlite_session.commit()

    with pytest.raises(LookupError, match="Dataset no longer exists"):
        persist_keyword_table(
            sqlite_session,
            tenant_id=tenant_id,
            dataset_id=dataset_id,
            storage_type="database",
            data="replacement",
            keywords={},
        )

    assert sqlite_session.scalar(select(DatasetKeywordTable)) is None


def test_file_keyword_persistence_records_storage_type_without_a_pointer(sqlite_session: Session) -> None:
    sqlite_session.add(Dataset(id="dataset-1", tenant_id="tenant-1", name="Test", created_by="author"))
    sqlite_session.commit()

    persist_keyword_table(
        sqlite_session,
        tenant_id="tenant-1",
        dataset_id="dataset-1",
        storage_type="file",
        data="serialized-data-lives-in-object-storage",
        keywords={},
    )

    row = sqlite_session.scalar(select(DatasetKeywordTable))
    assert row is not None
    assert row.data_source_type == "file"
    assert row.keyword_table == ""
