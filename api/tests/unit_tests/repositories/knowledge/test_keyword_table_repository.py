import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from models.dataset import Dataset, DatasetKeywordTable, DocumentSegment
from repositories.knowledge.keyword_table_repository import persist_keyword_table


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
    if existing_table:
        assert row is not None
        assert row.keyword_table == "original"
    else:
        assert row is None


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
