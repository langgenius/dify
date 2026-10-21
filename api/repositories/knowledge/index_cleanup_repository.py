"""Database snapshots needed by detached knowledge-index cleanup."""

from collections.abc import Sequence
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from models.dataset import ChildChunk, Dataset, DocumentSegment, DocumentSegmentSummary


@dataclass(frozen=True)
class IndexCleanupSnapshot:
    body_node_ids: tuple[str, ...] = ()
    child_node_ids: tuple[str, ...] = ()
    summary_node_ids: tuple[str, ...] = ()


def snapshot_index_cleanup(
    session: Session,
    *,
    tenant_id: str,
    dataset_id: str,
    segment_ids: Sequence[str] = (),
) -> IndexCleanupSnapshot:
    """Read cleanup inputs while the dataset and segment owners still exist."""

    unique_segment_ids = tuple(dict.fromkeys(segment_ids))
    body_node_ids: tuple[str, ...] = ()
    child_node_ids: tuple[str, ...] = ()
    summary_node_ids: tuple[str, ...] = ()
    if unique_segment_ids:
        body_node_ids = tuple(
            node_id
            for node_id in session.scalars(
                select(DocumentSegment.index_node_id).where(
                    DocumentSegment.tenant_id == tenant_id,
                    DocumentSegment.dataset_id == dataset_id,
                    DocumentSegment.id.in_(unique_segment_ids),
                    DocumentSegment.index_node_id.is_not(None),
                )
            ).all()
            if node_id
        )
        child_node_ids = tuple(
            node_id
            for node_id in session.scalars(
                select(ChildChunk.index_node_id).where(
                    ChildChunk.tenant_id == tenant_id,
                    ChildChunk.dataset_id == dataset_id,
                    ChildChunk.segment_id.in_(unique_segment_ids),
                    ChildChunk.index_node_id.is_not(None),
                )
            ).all()
            if node_id
        )
        summary_node_ids = tuple(
            node_id
            for node_id in session.scalars(
                select(DocumentSegmentSummary.summary_index_node_id).where(
                    DocumentSegmentSummary.dataset_id == dataset_id,
                    DocumentSegmentSummary.chunk_id.in_(unique_segment_ids),
                    DocumentSegmentSummary.summary_index_node_id.is_not(None),
                )
            ).all()
            if node_id
        )

    return IndexCleanupSnapshot(
        body_node_ids=body_node_ids,
        child_node_ids=child_node_ids,
        summary_node_ids=summary_node_ids,
    )


def get_current_dataset(session: Session, *, tenant_id: str, dataset_id: str) -> Dataset | None:
    return session.scalar(
        select(Dataset).where(
            Dataset.id == dataset_id,
            Dataset.tenant_id == tenant_id,
        )
    )
