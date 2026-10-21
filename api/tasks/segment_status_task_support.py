"""Durable recovery helpers for segment enable/disable workers."""

import logging
from collections import defaultdict
from collections.abc import Sequence
from typing import Any
from uuid import UUID, uuid4

from celery import Task
from sqlalchemy import select, update

from core.db.session_factory import session_factory
from libs.datetime_utils import naive_utc_now
from models.dataset import Dataset, Document, DocumentSegment
from models.enums import IndexingStatus, SegmentStatus
from repositories.knowledge.task_outbox_repository import enqueue_knowledge_task
from services.knowledge.task_outbox.contracts import (
    KnowledgeTaskExecutionLeaseLostError,
    KnowledgeTaskKind,
    KnowledgeTaskRequeuedError,
)
from services.knowledge.task_outbox.gateway import wake_knowledge_task_dispatcher_after_commit

logger = logging.getLogger(__name__)


def validate_segment_generation(value: str) -> str:
    """Return the canonical UUID used to fence one segment status attempt."""

    return str(UUID(value))


def mark_segment_intent_completed(
    *,
    segment_ids: Sequence[str],
    dataset_id: str,
    document_id: str,
    tenant_id: str,
    expected_enabled: bool,
    generation: str,
) -> None:
    expected_generation = validate_segment_generation(generation)
    allowed_statuses = (SegmentStatus.INDEXING, SegmentStatus.COMPLETED, SegmentStatus.ERROR)
    with session_factory.create_session() as session, session.begin():
        session.execute(
            update(DocumentSegment)
            .where(
                DocumentSegment.id.in_(segment_ids),
                DocumentSegment.tenant_id == tenant_id,
                DocumentSegment.dataset_id == dataset_id,
                DocumentSegment.document_id == document_id,
                DocumentSegment.enabled.is_(expected_enabled),
                DocumentSegment.indexing_generation == expected_generation,
                DocumentSegment.status.in_(allowed_statuses),
            )
            .values(
                status=SegmentStatus.COMPLETED,
                error=None,
                completed_at=naive_utc_now(),
            )
        )


def mark_segment_intent_failed(
    *,
    segment_ids: Sequence[str],
    dataset_id: str,
    document_id: str,
    expected_enabled: bool,
    generation: str,
    error: Exception,
) -> None:
    expected_generation = validate_segment_generation(generation)
    allowed_statuses = (SegmentStatus.INDEXING, SegmentStatus.COMPLETED, SegmentStatus.ERROR)
    with session_factory.create_session() as session, session.begin():
        tenant_id = session.scalar(select(Dataset.tenant_id).where(Dataset.id == dataset_id))
        if tenant_id is None:
            return
        session.execute(
            update(DocumentSegment)
            .where(
                DocumentSegment.id.in_(segment_ids),
                DocumentSegment.tenant_id == tenant_id,
                DocumentSegment.dataset_id == dataset_id,
                DocumentSegment.document_id == document_id,
                DocumentSegment.enabled.is_(expected_enabled),
                DocumentSegment.indexing_generation == expected_generation,
                DocumentSegment.status.in_(allowed_statuses),
            )
            .values(status=SegmentStatus.ERROR, error=str(error), completed_at=None)
        )


def enqueue_current_segment_repairs(
    *,
    segment_ids: Sequence[str],
    dataset_id: str,
    document_id: str,
) -> None:
    """Persist repairs for the latest desired generations after a stale/lost worker."""

    if not segment_ids:
        return
    with session_factory.create_session() as session, session.begin():
        dataset = session.scalar(select(Dataset).where(Dataset.id == dataset_id))
        if dataset is None:
            return
        document_exists = session.scalar(
            select(Document.id).where(
                Document.id == document_id,
                Document.tenant_id == dataset.tenant_id,
                Document.dataset_id == dataset.id,
            )
        )
        if document_exists is None:
            return
        segments = session.scalars(
            select(DocumentSegment).where(
                DocumentSegment.id.in_(segment_ids),
                DocumentSegment.tenant_id == dataset.tenant_id,
                DocumentSegment.dataset_id == dataset_id,
                DocumentSegment.document_id == document_id,
                DocumentSegment.indexing_generation.is_not(None),
                DocumentSegment.status.in_((SegmentStatus.INDEXING, SegmentStatus.COMPLETED, SegmentStatus.ERROR)),
            )
        ).all()
        grouped: dict[tuple[str, bool, str], list[str]] = defaultdict(list)
        for segment in segments:
            assert segment.indexing_generation is not None
            grouped[(segment.tenant_id, segment.enabled, segment.indexing_generation)].append(segment.id)
        for (tenant_id, enabled, current_generation), current_ids in grouped.items():
            enqueue_knowledge_task(
                session,
                kind=(KnowledgeTaskKind.SEGMENT_INDEX_ENABLE if enabled else KnowledgeTaskKind.SEGMENT_INDEX_DISABLE),
                tenant_id=tenant_id,
                dataset_id=dataset_id,
                document_id=document_id,
                payload={
                    "segment_ids": current_ids,
                    "dataset_id": dataset_id,
                    "document_id": document_id,
                    "expected_enabled": enabled,
                    "generation": current_generation,
                },
            )
        if grouped:
            wake_knowledge_task_dispatcher_after_commit(session)


def convert_legacy_segment_task_to_intent(
    *,
    segment_ids: Sequence[str],
    dataset_id: str,
    document_id: str,
    expected_enabled: bool,
) -> None:
    """Convert a pre-generation Celery delivery into a durable current-format intent."""

    if not segment_ids:
        return
    with session_factory.create_session() as session, session.begin():
        dataset = session.scalar(select(Dataset).where(Dataset.id == dataset_id).with_for_update())
        if dataset is None:
            return
        document = session.scalar(
            select(Document)
            .where(
                Document.id == document_id,
                Document.tenant_id == dataset.tenant_id,
                Document.dataset_id == dataset.id,
            )
            .with_for_update()
        )
        if (
            document is None
            or not document.enabled
            or document.archived
            or document.indexing_status != IndexingStatus.COMPLETED
        ):
            return
        segments = session.scalars(
            select(DocumentSegment)
            .where(
                DocumentSegment.id.in_(segment_ids),
                DocumentSegment.tenant_id == dataset.tenant_id,
                DocumentSegment.dataset_id == dataset.id,
                DocumentSegment.document_id == document.id,
                DocumentSegment.enabled.is_(expected_enabled),
                DocumentSegment.indexing_generation.is_(None),
            )
            .with_for_update()
        ).all()
        if not segments:
            return
        generation = str(uuid4())
        now = naive_utc_now()
        converted_ids: list[str] = []
        for segment in segments:
            segment.indexing_generation = generation
            segment.indexing_at = now
            segment.status = SegmentStatus.INDEXING
            segment.error = None
            segment.completed_at = None
            converted_ids.append(segment.id)
        enqueue_knowledge_task(
            session,
            kind=(
                KnowledgeTaskKind.SEGMENT_INDEX_ENABLE if expected_enabled else KnowledgeTaskKind.SEGMENT_INDEX_DISABLE
            ),
            tenant_id=dataset.tenant_id,
            dataset_id=dataset.id,
            document_id=document.id,
            payload={
                "segment_ids": converted_ids,
                "dataset_id": dataset.id,
                "document_id": document.id,
                "expected_enabled": expected_enabled,
                "generation": generation,
            },
        )
        wake_knowledge_task_dispatcher_after_commit(session)


def segment_status_task_on_failure(
    self: Task,
    exc: Exception,
    task_id: str,
    args: tuple[Any, ...],
    kwargs: dict[str, Any],
    einfo: Any,
) -> None:
    """Mark only the matching generation terminal after Celery exhausts retries."""

    if isinstance(exc, (KnowledgeTaskRequeuedError, KnowledgeTaskExecutionLeaseLostError)):
        return
    try:
        if len(args) == 3:
            Task.on_failure(self, exc, task_id, args, kwargs, einfo)
            return
        segment_ids, dataset_id, document_id, _intent_id, expected_enabled, generation = args
        mark_segment_intent_failed(
            segment_ids=segment_ids,
            dataset_id=dataset_id,
            document_id=document_id,
            expected_enabled=expected_enabled,
            generation=generation,
            error=exc,
        )
    except Exception:
        logger.exception("Failed to persist terminal segment indexing status")
    Task.on_failure(self, exc, task_id, args, kwargs, einfo)
