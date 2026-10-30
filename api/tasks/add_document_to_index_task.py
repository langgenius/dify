import logging
import time

import click
from celery import shared_task
from redis.exceptions import RedisError
from sqlalchemy import delete, select, update

from core.db.session_factory import session_factory
from core.rag.index_processor.constant.doc_type import DocType
from core.rag.index_processor.constant.index_type import IndexStructureType
from core.rag.index_processor.index_processor import IndexProcessorFactory
from core.rag.models.document import AttachmentDocument, ChildDocument, Document
from extensions.ext_redis import redis_client
from libs.datetime_utils import naive_utc_now
from models.dataset import DatasetAutoDisableLog, DocumentSegment
from models.dataset import Document as DatasetDocument
from models.enums import IndexingStatus, SegmentStatus
from repositories.knowledge.dataset_read_repository import (
    get_dataset_doc_form,
)
from repositories.knowledge.document_query_repository import get_document_dataset
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
    max_retries=10,
)
def add_document_to_index_task(dataset_document_id: str):
    """
    Async Add document to index
    :param dataset_document_id:

    Usage: add_document_to_index_task.delay(dataset_document_id)
    """
    locks = RedisKnowledgeIndexingLock(redis=redis_client)
    with locks.hold(
        document_index_lock_name(dataset_document_id),
        timeout=600,
        blocking_timeout=5,
    ) as lease:
        _add_document_to_index(dataset_document_id, lease=lease)
        lease.assert_owned()
        try:
            redis_client.delete(f"document_{dataset_document_id}_indexing")
        except Exception:
            logger.warning("Failed to clear indexing cache for document %s", dataset_document_id, exc_info=True)


def _add_document_to_index(dataset_document_id: str, *, lease: KnowledgeIndexingLease) -> None:
    logger.info(click.style(f"Start add document to index: {dataset_document_id}", fg="green"))
    start_at = time.perf_counter()

    with session_factory.create_session() as session:
        dataset_document = session.scalar(
            select(DatasetDocument).where(DatasetDocument.id == dataset_document_id).limit(1)
        )
        if not dataset_document:
            logger.info(click.style(f"Document not found: {dataset_document_id}", fg="red"))
            return

        if dataset_document.indexing_status != IndexingStatus.COMPLETED:
            return
        if not dataset_document.enabled or dataset_document.archived:
            logger.info(click.style(f"Document no longer requires index add: {dataset_document_id}", fg="yellow"))
            return

        try:
            dataset = get_document_dataset(dataset_document, session=session)
            if not dataset:
                raise Exception(f"Document {dataset_document.id} dataset {dataset_document.dataset_id} doesn't exist.")

            segments = session.scalars(
                select(DocumentSegment)
                .where(
                    DocumentSegment.document_id == dataset_document.id,
                    DocumentSegment.status == SegmentStatus.COMPLETED,
                )
                .order_by(DocumentSegment.position.asc())
            ).all()

            documents = []
            multimodal_documents = []
            for segment in segments:
                document = Document(
                    page_content=segment.content,
                    metadata={
                        "doc_id": segment.index_node_id,
                        "doc_hash": segment.index_node_hash,
                        "document_id": segment.document_id,
                        "dataset_id": segment.dataset_id,
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
                                    "document_id": segment.document_id,
                                    "dataset_id": segment.dataset_id,
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

            index_type = get_dataset_doc_form(dataset, session=session)
            index_processor = IndexProcessorFactory(index_type).init_index_processor()
            lease.assert_owned()
            index_processor.load(dataset, documents, multimodal_documents=multimodal_documents, session=session)
            lease.assert_owned()

            # delete auto disable log
            session.execute(
                delete(DatasetAutoDisableLog).where(DatasetAutoDisableLog.document_id == dataset_document.id)
            )

            # update segment to enable
            session.execute(
                update(DocumentSegment)
                .where(DocumentSegment.document_id == dataset_document.id)
                .values(enabled=True, disabled_at=None, disabled_by=None, updated_at=naive_utc_now())
            )
            session.commit()

            # Enable summary indexes for all segments in this document
            from services.knowledge.summaries.adapters import SummaryIndexAdapter

            segment_ids_list = [segment.id for segment in segments]
            if segment_ids_list:
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
                    logger.warning("Failed to enable summaries for document %s", dataset_document.id, exc_info=True)

            end_at = time.perf_counter()
            logger.info(
                click.style(f"Document added to index: {dataset_document.id} latency: {end_at - start_at}", fg="green")
            )
        except KnowledgeIndexingLeaseLostError:
            session.rollback()
            raise
        except Exception as e:
            logger.exception("add document to index failed")
            dataset_document.enabled = False
            dataset_document.disabled_at = naive_utc_now()
            dataset_document.indexing_status = IndexingStatus.ERROR
            dataset_document.error = str(e)
            session.commit()
