"""Shared SQL persistence for keyword indexing callers with an existing session."""

from collections.abc import Mapping, Sequence

from sqlalchemy import select
from sqlalchemy.orm import Session

from models.dataset import Dataset, DatasetKeywordTable, DocumentSegment


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
