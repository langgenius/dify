"""Persist summary indexing outcomes using one owned session per attempt."""

from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass

from sqlalchemy import and_, select, update
from sqlalchemy.orm import Session

from libs.datetime_utils import naive_utc_now
from models.dataset import Dataset, Document, DocumentSegment, DocumentSegmentSummary
from models.enums import SummaryStatus
from models.knowledge_task import KnowledgeTaskOutbox
from repositories.knowledge.summary_checkpoints import (
    SUMMARY_COMPLETED_CHECKPOINT_KEY,
    SUMMARY_GENERATED_CHECKPOINT_KEY,
    CurrentSummaryMaterialization,
    SummaryCheckpointIdentity,
    parse_summary_checkpoints,
    serialize_summary_checkpoints,
    summary_content_fingerprint,
)
from repositories.knowledge.task_outbox_repository import guard_task_execution
from services.knowledge.summaries.application import (
    SummaryVectorInput,
    SummaryVectorResult,
    SummaryWriteFenceLostError,
)


@dataclass(frozen=True)
class SummaryTaskCheckpoint:
    generated: Mapping[str, SummaryCheckpointIdentity]
    completed: Mapping[str, SummaryCheckpointIdentity]
    current: CurrentSummaryMaterialization | None

    def _matches(
        self,
        checkpoints: Mapping[str, SummaryCheckpointIdentity],
        *,
        command: SummaryVectorInput,
        require_completed: bool,
    ) -> bool:
        identity = checkpoints.get(command.ref.segment_id)
        return bool(
            identity is not None
            and _checkpoint_owns_command(identity, command)
            and identity.matches_materialization(self.current, require_completed=require_completed)
        )

    def was_generated(self, command: SummaryVectorInput) -> bool:
        return self._matches(self.generated, command=command, require_completed=False)

    def was_completed(self, command: SummaryVectorInput) -> bool:
        return self._matches(self.completed, command=command, require_completed=True)


@dataclass(frozen=True)
class SummaryRegenerationTarget:
    segment: DocumentSegment
    summary: DocumentSegmentSummary
    document_generation: str | None


def load_vectorization_owners(
    session: Session,
    *,
    tenant_id: str,
    dataset_id: str,
    document_id: str,
    segment_id: str,
) -> tuple[Dataset, DocumentSegment, Document]:
    row = session.execute(
        select(Dataset, DocumentSegment, Document)
        .select_from(Dataset)
        .join(
            Document,
            and_(
                Document.dataset_id == Dataset.id,
                Document.tenant_id == Dataset.tenant_id,
                Document.id == document_id,
            ),
        )
        .join(
            DocumentSegment,
            and_(
                DocumentSegment.dataset_id == Dataset.id,
                DocumentSegment.tenant_id == Dataset.tenant_id,
                DocumentSegment.document_id == Document.id,
                DocumentSegment.id == segment_id,
            ),
        )
        .where(
            Dataset.id == dataset_id,
            Dataset.tenant_id == tenant_id,
        )
    ).one_or_none()
    if row is None:
        raise LookupError("Summary segment no longer exists in this dataset")
    return row._tuple()


def _lock_summary_target(session: Session, command: SummaryVectorInput) -> DocumentSegment:
    """Validate the exact resource generations and execution claim in one write transaction."""

    ref = command.ref
    fence = command.fence
    dataset = session.scalar(
        select(Dataset)
        .where(
            Dataset.id == ref.document.dataset.dataset_id,
            Dataset.tenant_id == ref.document.dataset.tenant_id,
        )
        .with_for_update()
    )
    if dataset is None:
        raise SummaryWriteFenceLostError("Summary dataset no longer exists")
    document_conditions = [
        Document.id == ref.document.document_id,
        Document.dataset_id == dataset.id,
        Document.tenant_id == dataset.tenant_id,
        Document.enabled.is_(True),
        Document.archived.is_(False),
    ]
    if fence is not None and fence.enforce_document_generation:
        document_conditions.append(Document.indexing_generation == fence.expected_document_generation)
    document = session.scalar(select(Document).where(*document_conditions).with_for_update())
    if document is None:
        raise SummaryWriteFenceLostError("Summary document generation is no longer current")
    segment_conditions = [
        DocumentSegment.id == ref.segment_id,
        DocumentSegment.dataset_id == dataset.id,
        DocumentSegment.tenant_id == dataset.tenant_id,
        DocumentSegment.document_id == document.id,
        DocumentSegment.status == (fence.expected_segment_status if fence is not None else "completed"),
        DocumentSegment.enabled.is_(True),
    ]
    if fence is not None and fence.enforce_segment_generation:
        segment_conditions.append(DocumentSegment.indexing_generation == fence.expected_segment_generation)
    segment = session.scalar(select(DocumentSegment).where(*segment_conditions).with_for_update())
    if segment is None:
        raise SummaryWriteFenceLostError("Summary segment generation is no longer current")
    if fence is None:
        return segment
    if fence.task_intent_id is not None and (
        fence.expected_indexing_technique is None or not fence.enforce_summary_index_setting
    ):
        raise ValueError("Durable summary writes require an exact model configuration")
    if fence.expected_indexing_technique is not None and str(dataset.indexing_technique) != (
        fence.expected_indexing_technique
    ):
        raise SummaryWriteFenceLostError("Summary dataset indexing technique changed")
    if fence.expected_indexing_technique is not None and (
        dataset.embedding_model_provider != fence.expected_embedding_model_provider
        or dataset.embedding_model != fence.expected_embedding_model
    ):
        raise SummaryWriteFenceLostError("Summary dataset embedding configuration changed")
    if fence.enforce_summary_index_setting and dataset.summary_index_setting != fence.expected_summary_index_setting:
        raise SummaryWriteFenceLostError("Summary generation configuration changed")
    if (fence.task_intent_id is None) != (fence.task_execution_id is None):
        raise ValueError("Summary task intent and execution ids must be supplied together")
    if fence.task_intent_id is not None and fence.task_execution_id is not None:
        guard_task_execution(
            session,
            intent_id=fence.task_intent_id,
            execution_id=fence.task_execution_id,
            now=naive_utc_now(),
        )
    return segment


def _checkpoint_owns_command(identity: SummaryCheckpointIdentity, command: SummaryVectorInput) -> bool:
    fence = command.fence
    if fence is None or fence.expected_indexing_technique is None or not fence.enforce_summary_index_setting:
        raise ValueError("Summary checkpoints require an exact model configuration")
    return (
        identity.document_id == command.ref.document.document_id
        and identity.document_generation == fence.expected_document_generation
        and identity.segment_generation == fence.expected_segment_generation
        and identity.matches_configuration(
            expected_indexing_technique=fence.expected_indexing_technique,
            expected_embedding_model_provider=fence.expected_embedding_model_provider,
            expected_embedding_model=fence.expected_embedding_model,
            expected_summary_index_setting=fence.expected_summary_index_setting,
        )
    )


def _checkpoint_identity(
    command: SummaryVectorInput,
    *,
    result: SummaryVectorResult | None = None,
) -> SummaryCheckpointIdentity:
    fence = command.fence
    if fence is None or fence.expected_indexing_technique is None or not fence.enforce_summary_index_setting:
        raise ValueError("Summary checkpoints require an exact model configuration")
    return SummaryCheckpointIdentity(
        document_id=command.ref.document.document_id,
        document_generation=fence.expected_document_generation,
        segment_generation=fence.expected_segment_generation,
        indexing_technique=fence.expected_indexing_technique,
        embedding_model_provider=fence.expected_embedding_model_provider,
        embedding_model=fence.expected_embedding_model,
        summary_index_setting=(
            dict(fence.expected_summary_index_setting) if fence.expected_summary_index_setting is not None else None
        ),
        summary_id=command.summary_id,
        summary_content_fingerprint=summary_content_fingerprint(command.content),
        vector_node_id=result.node_id if result is not None else None,
        vector_content_hash=result.content_hash if result is not None else None,
    )


def _current_materialization(
    command: SummaryVectorInput,
    row: DocumentSegmentSummary | None,
) -> CurrentSummaryMaterialization | None:
    fence = command.fence
    if row is None or fence is None:
        return None
    return CurrentSummaryMaterialization(
        document_id=command.ref.document.document_id,
        document_generation=fence.expected_document_generation,
        segment_generation=fence.expected_segment_generation,
        summary_id=row.id,
        summary_content_fingerprint=summary_content_fingerprint(row.summary_content or ""),
        vector_node_id=row.summary_index_node_id,
        vector_content_hash=row.summary_index_node_hash,
        summary_status=str(row.status),
        summary_enabled=row.enabled,
    )


def _checkpoint_segment(
    session: Session,
    command: SummaryVectorInput,
    *,
    generated: bool,
    completed: bool,
    result: SummaryVectorResult | None = None,
) -> None:
    fence = command.fence
    if fence is None or fence.task_intent_id is None:
        return
    intent = session.scalar(
        select(KnowledgeTaskOutbox).where(KnowledgeTaskOutbox.id == fence.task_intent_id).with_for_update()
    )
    if intent is None:
        raise SummaryWriteFenceLostError("Summary task intent no longer exists")
    identity = _checkpoint_identity(command, result=result)
    payload = dict(intent.payload)
    if generated:
        generated_segments = parse_summary_checkpoints(payload.get(SUMMARY_GENERATED_CHECKPOINT_KEY))
        generated_segments[command.ref.segment_id] = identity
        payload[SUMMARY_GENERATED_CHECKPOINT_KEY] = serialize_summary_checkpoints(generated_segments)
    if completed:
        completed_segments = parse_summary_checkpoints(payload.get(SUMMARY_COMPLETED_CHECKPOINT_KEY))
        completed_segments[command.ref.segment_id] = identity
        payload[SUMMARY_COMPLETED_CHECKPOINT_KEY] = serialize_summary_checkpoints(completed_segments)
    intent.payload = payload


def ensure_summary_records(
    session: Session,
    *,
    dataset_id: str,
    segments: Sequence[DocumentSegment],
    status: SummaryStatus,
) -> None:
    segment_ids = [segment.id for segment in segments]
    if not segment_ids:
        return
    existing = session.scalars(
        select(DocumentSegmentSummary).where(
            DocumentSegmentSummary.chunk_id.in_(segment_ids),
            DocumentSegmentSummary.dataset_id == dataset_id,
        )
    ).all()
    by_segment = {summary.chunk_id: summary for summary in existing}
    for segment in segments:
        summary = by_segment.get(segment.id)
        if summary is None:
            summary = DocumentSegmentSummary(
                dataset_id=dataset_id,
                document_id=segment.document_id,
                chunk_id=segment.id,
                summary_content=None,
                status=status,
                enabled=True,
            )
            session.add(summary)
            continue
        summary.status = status
        summary.error = None
        summary.enabled = True
        summary.disabled_at = None
        summary.disabled_by = None
    session.flush()


def prepare_summary_generation(
    session: Session,
    *,
    dataset_id: str,
    segment: DocumentSegment,
    command: SummaryVectorInput | None = None,
) -> DocumentSegmentSummary:
    if command is not None:
        _lock_summary_target(session, command)
    summary = session.scalar(
        select(DocumentSegmentSummary)
        .where(
            DocumentSegmentSummary.chunk_id == segment.id,
            DocumentSegmentSummary.dataset_id == dataset_id,
        )
        .limit(1)
    )
    if summary is None:
        summary = DocumentSegmentSummary(
            dataset_id=dataset_id,
            document_id=segment.document_id,
            chunk_id=segment.id,
            summary_content="",
            status=SummaryStatus.GENERATING,
            enabled=True,
        )
        session.add(summary)
    else:
        summary.status = SummaryStatus.GENERATING
        summary.error = None
    session.flush()
    return summary


def refresh_summary(session: Session, summary: DocumentSegmentSummary) -> None:
    session.refresh(summary)


def mark_summary_error(session: Session, *, dataset_id: str, segment_id: str, error: str) -> bool:
    summary = session.scalar(
        select(DocumentSegmentSummary)
        .where(
            DocumentSegmentSummary.chunk_id == segment_id,
            DocumentSegmentSummary.dataset_id == dataset_id,
        )
        .limit(1)
    )
    if summary is None:
        return False
    summary.status = SummaryStatus.ERROR
    summary.error = error
    session.flush()
    return True


def list_segments_for_summary_generation(
    session: Session,
    *,
    tenant_id: str,
    dataset_id: str,
    document_id: str,
    segment_ids: Sequence[str] | None = None,
) -> list[DocumentSegment]:
    stmt = select(DocumentSegment).where(
        DocumentSegment.tenant_id == tenant_id,
        DocumentSegment.dataset_id == dataset_id,
        DocumentSegment.document_id == document_id,
        DocumentSegment.status == "completed",
        DocumentSegment.enabled.is_(True),
    )
    if segment_ids:
        stmt = stmt.where(DocumentSegment.id.in_(segment_ids))
    return list(session.scalars(stmt).all())


def load_summary_regeneration_targets(
    session: Session,
    *,
    dataset_id: str,
    regenerate_vectors_only: bool,
) -> tuple[Dataset, list[SummaryRegenerationTarget]] | None:
    dataset = session.scalar(select(Dataset).where(Dataset.id == dataset_id).limit(1))
    if dataset is None:
        return None
    statement = (
        select(DocumentSegment, DocumentSegmentSummary, Document.indexing_generation)
        .join(
            Document,
            and_(
                Document.id == DocumentSegment.document_id,
                Document.dataset_id == DocumentSegment.dataset_id,
                Document.tenant_id == DocumentSegment.tenant_id,
            ),
        )
        .join(
            DocumentSegmentSummary,
            and_(
                DocumentSegmentSummary.chunk_id == DocumentSegment.id,
                DocumentSegmentSummary.dataset_id == DocumentSegment.dataset_id,
                DocumentSegmentSummary.document_id == DocumentSegment.document_id,
            ),
        )
        .where(
            DocumentSegment.tenant_id == dataset.tenant_id,
            DocumentSegment.dataset_id == dataset.id,
            DocumentSegment.status == "completed",
            DocumentSegment.enabled.is_(True),
            Document.enabled.is_(True),
            Document.archived.is_(False),
            Document.doc_form != "qa_model",
        )
        .order_by(DocumentSegment.document_id.asc(), DocumentSegment.position.asc())
    )
    if regenerate_vectors_only:
        statement = statement.where(
            DocumentSegmentSummary.summary_content.is_not(None),
            DocumentSegmentSummary.status.in_((SummaryStatus.COMPLETED, SummaryStatus.ERROR)),
        )
    else:
        statement = statement.where(Document.indexing_status == "completed")
    return dataset, [
        SummaryRegenerationTarget(segment=row[0], summary=row[1], document_generation=row[2])
        for row in session.execute(statement).all()
    ]


def list_enabled_summaries(
    session: Session, *, dataset_id: str, segment_ids: Sequence[str] | None = None
) -> list[DocumentSegmentSummary]:
    stmt = select(DocumentSegmentSummary).where(
        DocumentSegmentSummary.dataset_id == dataset_id,
        DocumentSegmentSummary.enabled.is_(True),
    )
    if segment_ids:
        stmt = stmt.where(DocumentSegmentSummary.chunk_id.in_(segment_ids))
    return list(session.scalars(stmt).all())


def disable_summaries(
    session: Session,
    summaries: Sequence[DocumentSegmentSummary],
    *,
    disabled_by: str | None,
) -> None:
    summary_ids = [summary.id for summary in summaries]
    if not summary_ids:
        return
    session.execute(
        update(DocumentSegmentSummary)
        .where(DocumentSegmentSummary.id.in_(summary_ids))
        .values(enabled=False, disabled_at=naive_utc_now(), disabled_by=disabled_by)
    )


def list_disabled_summary_candidates(
    session: Session,
    *,
    tenant_id: str,
    dataset_id: str,
    segment_ids: Sequence[str] | None,
    expected_segment_generation: str | None,
) -> list[tuple[DocumentSegmentSummary, DocumentSegment]]:
    expected_statuses = ("indexing", "error") if expected_segment_generation is not None else ("completed",)
    stmt = (
        select(DocumentSegmentSummary, DocumentSegment)
        .join(
            DocumentSegment,
            and_(
                DocumentSegment.id == DocumentSegmentSummary.chunk_id,
                DocumentSegment.dataset_id == DocumentSegmentSummary.dataset_id,
            ),
        )
        .where(
            DocumentSegmentSummary.dataset_id == dataset_id,
            DocumentSegmentSummary.enabled.is_(False),
            DocumentSegment.tenant_id == tenant_id,
            DocumentSegment.dataset_id == dataset_id,
            DocumentSegment.enabled.is_(True),
            DocumentSegment.status.in_(expected_statuses),
        )
    )
    if segment_ids:
        stmt = stmt.where(DocumentSegmentSummary.chunk_id.in_(segment_ids))
    if expected_segment_generation is not None:
        stmt = stmt.where(DocumentSegment.indexing_generation == expected_segment_generation)
    return [(row[0], row[1]) for row in session.execute(stmt).all()]


def list_summaries(
    session: Session, *, dataset_id: str, segment_ids: Sequence[str] | None = None
) -> list[DocumentSegmentSummary]:
    stmt = select(DocumentSegmentSummary).where(DocumentSegmentSummary.dataset_id == dataset_id)
    if segment_ids:
        stmt = stmt.where(DocumentSegmentSummary.chunk_id.in_(segment_ids))
    return list(session.scalars(stmt).all())


def delete_summaries(session: Session, summaries: Sequence[DocumentSegmentSummary]) -> None:
    for summary in summaries:
        session.delete(summary)
    session.flush()


def get_documents_summary_index_status(
    session: Session,
    *,
    document_ids: Sequence[str],
    tenant_id: str,
    dataset_id: str,
) -> dict[str, str | None]:
    if not document_ids:
        return {}
    rows = session.execute(
        select(DocumentSegment.document_id, DocumentSegmentSummary.status)
        .outerjoin(
            DocumentSegmentSummary,
            and_(
                DocumentSegmentSummary.chunk_id == DocumentSegment.id,
                DocumentSegmentSummary.dataset_id == DocumentSegment.dataset_id,
                DocumentSegmentSummary.enabled.is_(True),
            ),
        )
        .where(
            DocumentSegment.document_id.in_(document_ids),
            DocumentSegment.dataset_id == dataset_id,
            DocumentSegment.tenant_id == tenant_id,
            DocumentSegment.status != "re_segment",
        )
    ).all()
    pending = {SummaryStatus.NOT_STARTED, SummaryStatus.GENERATING}
    result = dict.fromkeys(document_ids)
    for document_id, status in rows:
        if status in pending:
            result[str(document_id)] = "SUMMARIZING"
    return result


def list_document_summary_rows(
    session: Session,
    *,
    tenant_id: str,
    dataset_id: str,
    document_id: str,
) -> list[tuple[DocumentSegment, DocumentSegmentSummary | None]]:
    rows = session.execute(
        select(DocumentSegment, DocumentSegmentSummary)
        .outerjoin(
            DocumentSegmentSummary,
            and_(
                DocumentSegmentSummary.chunk_id == DocumentSegment.id,
                DocumentSegmentSummary.dataset_id == DocumentSegment.dataset_id,
                DocumentSegmentSummary.document_id == DocumentSegment.document_id,
                DocumentSegmentSummary.enabled.is_(True),
            ),
        )
        .where(
            DocumentSegment.tenant_id == tenant_id,
            DocumentSegment.dataset_id == dataset_id,
            DocumentSegment.document_id == document_id,
            DocumentSegment.status == "completed",
            DocumentSegment.enabled.is_(True),
        )
        .order_by(DocumentSegment.position)
    ).all()
    return [(row[0], row[1]) for row in rows]


class SQLAlchemySummaryRepository:
    def __init__(self, *, new_session: Callable[[], Session]) -> None:
        self._new_session = new_session

    @staticmethod
    def _record(
        session: Session,
        command: SummaryVectorInput,
        *,
        require_summary_id: bool = False,
        require_content: bool = False,
    ) -> DocumentSegmentSummary | None:
        ref = command.ref
        _lock_summary_target(session, command)
        row = session.scalar(
            select(DocumentSegmentSummary)
            .where(
                DocumentSegmentSummary.dataset_id == ref.document.dataset.dataset_id,
                DocumentSegmentSummary.document_id == ref.document.document_id,
                DocumentSegmentSummary.chunk_id == ref.segment_id,
            )
            .with_for_update()
            .limit(1)
        )
        if row is not None and require_summary_id and row.id != command.summary_id:
            raise SummaryWriteFenceLostError("Summary materialization was replaced")
        if row is not None and require_content and (row.summary_content or "") != command.content:
            raise SummaryWriteFenceLostError("Summary content was replaced")
        return row

    def checkpoint(self, command: SummaryVectorInput) -> SummaryTaskCheckpoint:
        fence = command.fence
        if fence is None or fence.task_intent_id is None:
            return SummaryTaskCheckpoint(generated={}, completed={}, current=None)
        with self._new_session() as session, session.begin():
            row = self._record(session, command)
            intent = session.scalar(
                select(KnowledgeTaskOutbox).where(KnowledgeTaskOutbox.id == fence.task_intent_id).with_for_update()
            )
            if intent is None:
                raise SummaryWriteFenceLostError("Summary task intent no longer exists")
            return SummaryTaskCheckpoint(
                generated=parse_summary_checkpoints(intent.payload.get(SUMMARY_GENERATED_CHECKPOINT_KEY)),
                completed=parse_summary_checkpoints(intent.payload.get(SUMMARY_COMPLETED_CHECKPOINT_KEY)),
                current=_current_materialization(command, row),
            )

    def assert_current(self, command: SummaryVectorInput) -> None:
        with self._new_session() as session, session.begin():
            row = self._record(session, command, require_summary_id=True, require_content=True)
            if row is None:
                raise SummaryWriteFenceLostError("Summary materialization no longer exists")

    def delete(self, command: SummaryVectorInput) -> str | None:
        """Delete the fenced current summary row and return its detached vector node id."""

        with self._new_session() as session, session.begin():
            row = self._record(session, command, require_summary_id=True, require_content=True)
            if row is None:
                return None
            node_id = row.summary_index_node_id
            session.delete(row)
            return node_id

    def generated(self, command: SummaryVectorInput) -> None:
        with self._new_session() as session, session.begin():
            row = self._record(session, command, require_summary_id=True)
            if row is None:
                raise SummaryWriteFenceLostError("Summary materialization no longer exists")
            row.summary_content = command.content
            row.status = SummaryStatus.GENERATING
            row.error = None
            row.updated_at = naive_utc_now()
            _checkpoint_segment(session, command, generated=True, completed=False)

    def completed(self, command: SummaryVectorInput, result: SummaryVectorResult) -> None:
        with self._new_session() as session, session.begin():
            row = self._record(session, command, require_summary_id=True, require_content=True)
            if row is None:
                raise SummaryWriteFenceLostError("Summary materialization no longer exists")
            row.summary_content = command.content
            row.summary_index_node_id = result.node_id
            row.summary_index_node_hash = result.content_hash
            row.tokens = result.tokens
            row.status = SummaryStatus.COMPLETED
            row.error = None
            row.enabled = True
            row.disabled_at = None
            row.disabled_by = None
            row.updated_at = naive_utc_now()
            _checkpoint_segment(session, command, generated=True, completed=True, result=result)

    def failed(self, command: SummaryVectorInput, error: str) -> None:
        with self._new_session() as session, session.begin():
            row = self._record(session, command, require_summary_id=True, require_content=True)
            if row is not None:
                row.status = SummaryStatus.ERROR
                row.error = error
                row.updated_at = naive_utc_now()

    def enable(self, command: SummaryVectorInput) -> None:
        with self._new_session() as session, session.begin():
            row = self._record(session, command, require_summary_id=True, require_content=True)
            if row is None:
                raise SummaryWriteFenceLostError("Summary materialization no longer exists")
            row.enabled = True
            row.disabled_at = None
            row.disabled_by = None
