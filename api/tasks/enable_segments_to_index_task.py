import logging
import time

import click
from celery import shared_task
from redis.exceptions import RedisError
from sqlalchemy import select, update

from core.db.session_factory import session_factory
from core.rag.index_processor.constant.doc_type import DocType
from core.rag.index_processor.constant.index_type import IndexStructureType
from core.rag.index_processor.index_processor import IndexProcessorFactory
from core.rag.models.document import AttachmentDocument, ChildDocument, Document
from extensions.ext_redis import redis_client
from libs.datetime_utils import naive_utc_now
from models.dataset import Dataset, DocumentSegment
from models.dataset import Document as DatasetDocument
from models.enums import SegmentStatus
from repositories.knowledge.segment_query_repository import get_segment_attachment_files, get_segment_child_chunks
from services.knowledge.indexing.adapters.redis_lock import RedisKnowledgeIndexingLock
from services.knowledge.indexing.locks import (
    KnowledgeIndexingLease,
    KnowledgeIndexingLeaseLostError,
    KnowledgeIndexingLockBusyError,
    document_index_lock_name,
)

logger = logging.getLogger(__name__)


@shared_task(
    queue="dataset",
    autoretry_for=(KnowledgeIndexingLockBusyError, KnowledgeIndexingLeaseLostError, RedisError),
    retry_backoff=True,
    max_retries=5,
    acks_late=True,
    reject_on_worker_lost=True,
)
def enable_segments_to_index_task(segment_ids: list, dataset_id: str, document_id: str):
    """
    Async enable segments to index
    :param segment_ids: list of segment ids
    :param dataset_id: dataset id
    :param document_id: document id

    Usage: enable_segments_to_index_task.delay(segment_ids, dataset_id, document_id)
    """
    locks = RedisKnowledgeIndexingLock(redis=redis_client)
    with locks.hold(document_index_lock_name(document_id), timeout=600, blocking_timeout=5) as lease:
        processed_ids = _enable_segments_to_index(segment_ids, dataset_id, document_id, lease=lease)
        lease.assert_owned()
        for segment_id in processed_ids:
            try:
                redis_client.delete(f"segment_{segment_id}_indexing")
            except Exception:
                logger.warning("Failed to clear indexing cache for segment %s", segment_id, exc_info=True)


def _enable_segments_to_index(
    segment_ids: list[str], dataset_id: str, document_id: str, *, lease: KnowledgeIndexingLease
) -> tuple[str, ...]:
    start_at = time.perf_counter()
    with session_factory.create_session() as session:
        dataset = session.scalar(select(Dataset).where(Dataset.id == dataset_id).limit(1))
        if not dataset:
            logger.info(click.style(f"Dataset {dataset_id} not found, pass.", fg="cyan"))
            return ()

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
            return ()
        if not dataset_document.enabled or dataset_document.archived or dataset_document.indexing_status != "completed":
            logger.info(click.style(f"Document {document_id} status is invalid, pass.", fg="cyan"))
            return ()
        # sync index processor
        index_processor = IndexProcessorFactory(dataset_document.doc_form).init_index_processor()

        segments = session.scalars(
            select(DocumentSegment).where(
                DocumentSegment.id.in_(segment_ids),
                DocumentSegment.tenant_id == dataset.tenant_id,
                DocumentSegment.dataset_id == dataset_id,
                DocumentSegment.document_id == document_id,
                DocumentSegment.enabled.is_(True),
                # A segment that never finished indexing has no trustworthy index
                # payload (its ``index_node_id`` may still be NULL), so it must not
                # be pushed into the vector index. This mirrors the guard in
                # ``enable_segment_to_index_task`` ("Segment is not completed,
                # enable is not allowed") and in
                # ``disable_segment_from_index_task``.
                DocumentSegment.status == SegmentStatus.COMPLETED,
            )
        ).all()
        if not segments:
            logger.info(click.style(f"Segments not found: {segment_ids}", fg="cyan"))
            return ()

        documents = []
        multimodal_documents = []
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
                child_chunks = get_segment_child_chunks(segment, session=session)
                if child_chunks:
                    child_documents = []
                    for child_chunk in child_chunks:
                        child_document = ChildDocument(
                            page_content=child_chunk.content,
                            metadata={
                                "doc_id": child_chunk.index_node_id,
                                "doc_hash": child_chunk.index_node_hash,
                                "document_id": document_id,
                                "dataset_id": dataset_id,
                            },
                        )
                        child_documents.append(child_document)
                    document.children = child_documents

            if dataset.is_multimodal:
                for attachment in get_segment_attachment_files(segment, session=session):
                    multimodal_documents.append(
                        AttachmentDocument(
                            page_content=attachment.name,
                            metadata={
                                "doc_id": attachment.id,
                                "doc_hash": "",
                                "document_id": segment.document_id,
                                "dataset_id": segment.dataset_id,
                                "doc_type": DocType.IMAGE,
                            },
                        )
                    )
            documents.append(document)
        # save vector index
        try:
            lease.assert_owned()
            index_processor.load(dataset, documents, multimodal_documents=multimodal_documents, session=session)
            lease.assert_owned()
            session.commit()
        except KnowledgeIndexingLeaseLostError:
            session.rollback()
            raise
        except Exception as error:
            session.rollback()
            session.execute(
                update(DocumentSegment)
                .where(
                    DocumentSegment.id.in_([segment.id for segment in segments]),
                    DocumentSegment.tenant_id == dataset.tenant_id,
                    DocumentSegment.dataset_id == dataset_id,
                    DocumentSegment.document_id == document_id,
                    DocumentSegment.enabled.is_(True),
                )
                .values(
                    enabled=False,
                    disabled_at=naive_utc_now().replace(microsecond=0),
                    disabled_by=None,
                    error=str(error),
                )
            )
            session.commit()
            for segment in segments:
                try:
                    redis_client.delete(f"segment_{segment.id}_indexing")
                except Exception:
                    logger.warning("Failed to clear indexing cache for segment %s", segment.id, exc_info=True)
            raise

        # Enable summary indexes for these segments
        from services.knowledge.summaries.adapters import SummaryIndexAdapter

        segment_ids_list = [segment.id for segment in segments]
        try:
            lease.assert_owned()
            SummaryIndexAdapter.enable_summaries_for_segments(
                dataset=dataset,
                segment_ids=segment_ids_list,
            )
            lease.assert_owned()
        except KnowledgeIndexingLeaseLostError:
            raise
        except Exception:
            logger.warning("Failed to enable summaries for segments", exc_info=True)

        end_at = time.perf_counter()
        logger.info(click.style(f"Segments enabled to index latency: {end_at - start_at}", fg="green"))
        return tuple(segment.id for segment in segments)
