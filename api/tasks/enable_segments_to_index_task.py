import logging
import time

import click
from celery import shared_task
from sqlalchemy import select

from core.db.session_factory import session_factory
from core.rag.datasource.vdb.vector_factory import Vector
from core.rag.index_processor.constant.doc_type import DocType
from core.rag.index_processor.constant.index_type import IndexStructureType, IndexTechniqueType
from core.rag.index_processor.index_processor import IndexProcessorFactory
from core.rag.models.document import AttachmentDocument, ChildDocument, Document
from extensions.ext_redis import redis_client
from models.dataset import Dataset, DocumentSegment
from models.dataset import Document as DatasetDocument
from models.enums import IndexingStatus, SegmentStatus
from repositories.knowledge.segment_query_repository import get_segment_child_chunks
from repositories.knowledge.segment_read_adapter import get_segment_attachments
from repositories.knowledge.segment_repository import SQLAlchemySegmentAttachmentWriter
from services.knowledge.indexing.adapters.redis_lock import RedisKnowledgeIndexingLock
from services.knowledge.indexing.locks import (
    KnowledgeIndexingLease,
    KnowledgeIndexingLeaseLostError,
    dataset_index_lock_name,
)
from services.knowledge.task_outbox.contracts import KnowledgeTaskDeliveryHandledError, KnowledgeTaskPermanentError
from tasks.knowledge_task_outbox_task import knowledge_task_execution
from tasks.segment_status_task_support import (
    convert_legacy_segment_task_to_intent,
    enqueue_current_segment_repairs,
    mark_segment_intent_completed,
    segment_status_task_on_failure,
    validate_segment_generation,
)

logger = logging.getLogger(__name__)


def _indexing_lock() -> RedisKnowledgeIndexingLock:
    return RedisKnowledgeIndexingLock(redis=redis_client)


@shared_task(  # pyrefly: ignore[no-matching-overload] -- Celery stubs omit the supported on_failure option.
    queue="dataset",
    autoretry_for=(Exception,),
    retry_backoff=True,
    max_retries=5,
    acks_late=True,
    reject_on_worker_lost=True,
    dont_autoretry_for=(KnowledgeTaskDeliveryHandledError,),
    on_failure=segment_status_task_on_failure,
)
def enable_segments_to_index_task(
    segment_ids: list[str],
    dataset_id: str,
    document_id: str,
    intent_id: str | None = None,
    expected_enabled: bool | None = None,
    generation: str | None = None,
) -> None:
    if intent_id is None and expected_enabled is None and generation is None:
        convert_legacy_segment_task_to_intent(
            segment_ids=segment_ids,
            dataset_id=dataset_id,
            document_id=document_id,
            expected_enabled=True,
        )
        return
    if intent_id is None or expected_enabled is None or generation is None:
        raise ValueError("Segment enable intent metadata must be provided together")
    if not expected_enabled:
        raise ValueError("Enable segment task requires expected_enabled=true")
    with knowledge_task_execution(intent_id) as execution:
        if execution is None:
            return
        execution.assert_owned()
        if execution.recovered_execution:
            enqueue_current_segment_repairs(
                segment_ids=segment_ids,
                dataset_id=dataset_id,
                document_id=document_id,
            )
            logger.warning("Recovered segment enable execution scheduled current repair intent_id=%s", intent_id)
            return
        _run_enable_segments_to_index_task(
            segment_ids=segment_ids,
            dataset_id=dataset_id,
            document_id=document_id,
            intent_id=intent_id,
            expected_enabled=expected_enabled,
            generation=generation,
        )


def _run_enable_segments_to_index_task(
    *,
    segment_ids: list[str],
    dataset_id: str,
    document_id: str,
    intent_id: str,
    expected_enabled: bool,
    generation: str,
) -> None:
    start_at = time.perf_counter()
    try:
        with _indexing_lock().hold(
            dataset_index_lock_name(dataset_id),
            timeout=600,
            blocking_timeout=600,
        ) as lease:
            stale_ids = _enable_segments(
                segment_ids,
                dataset_id,
                document_id,
                start_at,
                generation=generation,
                lease=lease,
            )
            if stale_ids:
                enqueue_current_segment_repairs(
                    segment_ids=stale_ids,
                    dataset_id=dataset_id,
                    document_id=document_id,
                )
    except KnowledgeIndexingLeaseLostError:
        logger.warning("Enable segment intent %s lost its dataset indexing lease", intent_id)
        enqueue_current_segment_repairs(
            segment_ids=segment_ids,
            dataset_id=dataset_id,
            document_id=document_id,
        )
        raise


def _enable_segments(
    segment_ids: list[str],
    dataset_id: str,
    document_id: str,
    start_at: float,
    *,
    generation: str,
    lease: KnowledgeIndexingLease,
) -> list[str]:
    expected_generation = validate_segment_generation(generation)
    with session_factory.create_session() as session:
        dataset = session.scalar(select(Dataset).where(Dataset.id == dataset_id).limit(1))
        if not dataset:
            logger.info(click.style(f"Dataset {dataset_id} not found, pass.", fg="cyan"))
            return []

        dataset_document = session.scalar(
            select(DatasetDocument)
            .where(
                DatasetDocument.id == document_id,
                DatasetDocument.tenant_id == dataset.tenant_id,
                DatasetDocument.dataset_id == dataset.id,
            )
            .limit(1)
        )
        if not dataset_document:
            logger.info(click.style(f"Document {document_id} not found, pass.", fg="cyan"))
            return []
        if (
            not dataset_document.enabled
            or dataset_document.archived
            or dataset_document.indexing_status in (IndexingStatus.PAUSED, IndexingStatus.ERROR)
        ):
            raise KnowledgeTaskPermanentError(f"Document {document_id} cannot be indexed in its current state")
        if dataset_document.indexing_status != IndexingStatus.COMPLETED:
            raise RuntimeError(f"Document {document_id} is unavailable for segment indexing")

        all_segments = session.scalars(
            select(DocumentSegment).where(
                DocumentSegment.id.in_(segment_ids),
                DocumentSegment.tenant_id == dataset.tenant_id,
                DocumentSegment.dataset_id == dataset_id,
                DocumentSegment.document_id == document_id,
            )
        ).all()
        allowed_statuses = (SegmentStatus.INDEXING, SegmentStatus.COMPLETED, SegmentStatus.ERROR)
        segments = [
            segment
            for segment in all_segments
            if segment.enabled
            and segment.indexing_generation == expected_generation
            and segment.status in allowed_statuses
        ]
        eligible_ids = {segment.id for segment in segments}
        stale_ids = [segment.id for segment in all_segments if segment.id not in eligible_ids]
        if not segments:
            logger.info(click.style(f"No current enable intent for segments: {segment_ids}", fg="cyan"))
            return stale_ids

        index_processor = IndexProcessorFactory(
            dataset_document.doc_form,
            attachment_writer=SQLAlchemySegmentAttachmentWriter(),
        ).init_index_processor()
        documents: list[Document] = []
        multimodal_documents: list[AttachmentDocument] = []
        for segment in segments:
            document = Document(
                page_content=segment.content,
                metadata={
                    "doc_id": segment.index_node_id,
                    "doc_hash": segment.index_node_hash,
                    "document_id": document_id,
                    "dataset_id": dataset_id,
                },
            )
            if dataset_document.doc_form == IndexStructureType.PARENT_CHILD_INDEX:
                document.children = [
                    ChildDocument(
                        page_content=child_chunk.content,
                        metadata={
                            "doc_id": child_chunk.index_node_id,
                            "doc_hash": child_chunk.index_node_hash,
                            "document_id": document_id,
                            "dataset_id": dataset_id,
                        },
                    )
                    for child_chunk in get_segment_child_chunks(segment, session=session)
                ]
            if dataset.is_multimodal:
                multimodal_documents.extend(
                    AttachmentDocument(
                        page_content=attachment["name"],
                        metadata={
                            "doc_id": attachment["id"],
                            "doc_hash": "",
                            "document_id": segment.document_id,
                            "dataset_id": segment.dataset_id,
                            "doc_type": DocType.IMAGE,
                        },
                    )
                    for attachment in get_segment_attachments(segment, session=session)
                )
            documents.append(document)

        index_node_ids = [segment.index_node_id for segment in segments if segment.index_node_id]
        attachment_ids = [
            attachment.metadata["doc_id"] for attachment in multimodal_documents if attachment.metadata.get("doc_id")
        ]
        lease.assert_owned()
        index_processor.clean(
            dataset,
            index_node_ids,
            with_keywords=True,
            delete_child_chunks=False,
            session=session,
        )
        lease.assert_owned()
        if attachment_ids and dataset.indexing_technique == IndexTechniqueType.HIGH_QUALITY:
            Vector(dataset, session=session).delete_by_ids(attachment_ids)
            lease.assert_owned()
        index_processor.load(dataset, documents, multimodal_documents=multimodal_documents, session=session)
        lease.assert_owned()
        if dataset.indexing_technique == IndexTechniqueType.ECONOMY:
            session.commit()
            lease.assert_owned()
        tenant_id = dataset.tenant_id
        completed_ids = [segment.id for segment in segments]

    from services.knowledge.summaries.adapters import SummaryIndexAdapter

    SummaryIndexAdapter.enable_summaries_for_segments(
        dataset=dataset,
        segment_ids=completed_ids,
        expected_segment_generation=expected_generation,
        raise_on_failure=True,
    )
    lease.assert_owned()
    mark_segment_intent_completed(
        segment_ids=completed_ids,
        dataset_id=dataset_id,
        document_id=document_id,
        tenant_id=tenant_id,
        expected_enabled=True,
        generation=generation,
    )
    logger.info(click.style(f"Segments enabled to index latency: {time.perf_counter() - start_at}", fg="green"))
    return stale_ids
