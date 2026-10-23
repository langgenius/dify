"""Persist summary indexing outcomes using one owned session per attempt."""

from collections.abc import Callable

from sqlalchemy import select
from sqlalchemy.orm import Session

from libs.datetime_utils import naive_utc_now
from models.dataset import Dataset, Document, DocumentSegment, DocumentSegmentSummary
from models.enums import SummaryStatus
from services.knowledge.summaries.application import SummaryVectorInput, SummaryVectorResult


class SQLAlchemySummaryRepository:
    def __init__(self, *, new_session: Callable[[], Session]) -> None:
        self._new_session = new_session

    @staticmethod
    def _record(session: Session, command: SummaryVectorInput) -> DocumentSegmentSummary | None:
        ref = command.ref
        segment = session.scalar(
            select(DocumentSegment)
            .join(Document, Document.id == DocumentSegment.document_id)
            .join(Dataset, Dataset.id == Document.dataset_id)
            .where(
                Dataset.id == ref.document.dataset.dataset_id,
                Dataset.tenant_id == ref.document.dataset.tenant_id,
                Document.id == ref.document.document_id,
                Document.tenant_id == ref.document.dataset.tenant_id,
                DocumentSegment.id == ref.segment_id,
                DocumentSegment.dataset_id == ref.document.dataset.dataset_id,
                DocumentSegment.tenant_id == ref.document.dataset.tenant_id,
            )
        )
        if segment is None:
            raise LookupError("Summary segment no longer exists in this dataset")
        return session.scalar(
            select(DocumentSegmentSummary)
            .where(
                DocumentSegmentSummary.dataset_id == ref.document.dataset.dataset_id,
                DocumentSegmentSummary.document_id == ref.document.document_id,
                DocumentSegmentSummary.chunk_id == ref.segment_id,
            )
            .limit(1)
        )

    def completed(self, command: SummaryVectorInput, result: SummaryVectorResult) -> None:
        with self._new_session() as session, session.begin():
            row = self._record(session, command)
            if row is None:
                row = DocumentSegmentSummary(
                    dataset_id=command.ref.document.dataset.dataset_id,
                    document_id=command.ref.document.document_id,
                    chunk_id=command.ref.segment_id,
                    summary_content=command.content,
                    enabled=True,
                )
                row.id = command.summary_id
                session.add(row)
            row.summary_content = command.content
            row.summary_index_node_id = result.node_id
            row.summary_index_node_hash = result.content_hash
            row.tokens = result.tokens
            row.status = SummaryStatus.COMPLETED
            row.error = None
            row.updated_at = naive_utc_now()

    def failed(self, command: SummaryVectorInput, error: str) -> None:
        with self._new_session() as session, session.begin():
            row = self._record(session, command)
            if row is not None:
                row.status = SummaryStatus.ERROR
                row.error = error
                row.updated_at = naive_utc_now()
