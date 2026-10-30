"""Persist summary indexing outcomes using one owned session per attempt."""

from collections.abc import Callable, Sequence

from sqlalchemy import select
from sqlalchemy.orm import Session

from libs.datetime_utils import naive_utc_now
from models.dataset import Dataset, Document, DocumentSegment, DocumentSegmentSummary
from models.enums import SegmentStatus, SummaryStatus
from services.knowledge.summaries.application import SummaryVectorInput, SummaryVectorResult


def get_documents_summary_index_status(
    session: Session,
    *,
    document_ids: Sequence[str],
    tenant_id: str,
    dataset_id: str,
) -> dict[str, str | None]:
    """Return the active summary-index state for tenant-owned documents."""

    unique_ids = tuple(dict.fromkeys(document_ids))
    if not unique_ids:
        return {}

    pending_document_ids = set(
        session.scalars(
            select(DocumentSegment.document_id)
            .join(
                DocumentSegmentSummary,
                (DocumentSegmentSummary.chunk_id == DocumentSegment.id)
                & (DocumentSegmentSummary.document_id == DocumentSegment.document_id)
                & (DocumentSegmentSummary.dataset_id == DocumentSegment.dataset_id),
            )
            .where(
                DocumentSegment.document_id.in_(unique_ids),
                DocumentSegment.tenant_id == tenant_id,
                DocumentSegment.dataset_id == dataset_id,
                DocumentSegment.status != SegmentStatus.RE_SEGMENT,
                DocumentSegmentSummary.enabled.is_(True),
                DocumentSegmentSummary.status.in_((SummaryStatus.NOT_STARTED, SummaryStatus.GENERATING)),
            )
            .distinct()
        ).all()
    )
    return {document_id: "SUMMARIZING" if document_id in pending_document_ids else None for document_id in unique_ids}


class SQLAlchemySummaryRepository:
    def __init__(self, *, new_session: Callable[[], Session]) -> None:
        self._new_session = new_session

    @staticmethod
    def _record(session: Session, command: SummaryVectorInput, *, lock: bool = True) -> DocumentSegmentSummary | None:
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
            return None
        statement = select(DocumentSegmentSummary).where(
            DocumentSegmentSummary.id == command.summary_id,
            DocumentSegmentSummary.dataset_id == ref.document.dataset.dataset_id,
            DocumentSegmentSummary.document_id == ref.document.document_id,
            DocumentSegmentSummary.chunk_id == ref.segment_id,
        )
        if lock:
            statement = statement.with_for_update()
        return session.scalar(statement.limit(1))

    @staticmethod
    def _owns_command(row: DocumentSegmentSummary, command: SummaryVectorInput) -> bool:
        return (
            row.summary_content == command.content
            and row.summary_index_node_id == command.previous_node_id
            and row.updated_at == command.expected_updated_at
            and str(row.status) == command.expected_status
            and row.enabled == command.expected_enabled
        )

    @staticmethod
    def _references_result(
        row: DocumentSegmentSummary, command: SummaryVectorInput, result: SummaryVectorResult
    ) -> bool:
        return (
            row.summary_content == command.content
            and row.summary_index_node_id == result.node_id
            and row.summary_index_node_hash == result.content_hash
            and row.tokens == result.tokens
        )

    @classmethod
    def _already_completed(
        cls, row: DocumentSegmentSummary, command: SummaryVectorInput, result: SummaryVectorResult
    ) -> bool:
        return cls._references_result(row, command, result) and row.status == SummaryStatus.COMPLETED

    def completed(self, command: SummaryVectorInput, result: SummaryVectorResult) -> bool:
        with self._new_session() as session, session.begin():
            row = self._record(session, command)
            if row is None:
                return False
            # A lost commit acknowledgement may retry this exact result. Treat
            # the already-published materialization as success so its node is
            # never mistaken for an unpublished stale write and deleted.
            if self._already_completed(row, command, result):
                return True
            if not self._owns_command(row, command):
                return False
            row.summary_content = command.content
            row.summary_index_node_id = result.node_id
            row.summary_index_node_hash = result.content_hash
            row.tokens = result.tokens
            row.status = SummaryStatus.COMPLETED
            row.error = None
            row.updated_at = naive_utc_now()
            return True

    def failed(self, command: SummaryVectorInput, error: str) -> bool:
        with self._new_session() as session, session.begin():
            row = self._record(session, command)
            if row is None:
                return False
            if not self._owns_command(row, command):
                return False
            row.status = SummaryStatus.ERROR
            row.error = error
            row.updated_at = naive_utc_now()
            return True

    def is_published(self, command: SummaryVectorInput, result: SummaryVectorResult) -> bool:
        with self._new_session() as session:
            row = self._record(session, command, lock=False)
            # Confirmation is about physical node ownership, not presentation
            # state. A concurrent disable/error may retain this exact node; it
            # must not become eligible for deletion merely because status or
            # enabled changed after publication.
            return row is not None and self._references_result(row, command, result)
