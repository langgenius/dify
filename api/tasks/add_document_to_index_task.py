import logging
import time

import click
from celery import shared_task
from sqlalchemy import select

from core.db.session_factory import session_factory
from core.rag.index_processor.constant.doc_type import DocType
from core.rag.index_processor.constant.index_type import IndexStructureType
from core.rag.index_processor.index_processor import IndexProcessorFactory
from core.rag.models.document import AttachmentDocument, ChildDocument, Document
from extensions.ext_redis import redis_client
from models.dataset import Document as DatasetDocument
from models.dataset import DocumentSegment
from models.enums import IndexingStatus, SegmentStatus
from repositories.knowledge.dataset_read_repository import get_dataset_doc_form
from repositories.knowledge.document_query_repository import get_document_dataset
from repositories.knowledge.document_repository import complete_document_index_add
from repositories.knowledge.segment_query_repository import get_segment_child_chunks
from repositories.knowledge.segment_read_adapter import get_segment_attachments
from services.knowledge.indexing.contracts import DocumentIndexingExecution
from services.knowledge.indexing.errors import DocumentIndexingGenerationChangedError
from services.knowledge.indexing.locks import KnowledgeIndexingLeaseLostError
from services.knowledge.resource_scope import DocumentRef
from services.knowledge.task_outbox.contracts import (
    KnowledgeTaskDeliveryHandledError,
    KnowledgeTaskExecutionLeaseLostError,
)
from tasks.document_index_state_task_support import document_index_state_task_execution

logger = logging.getLogger(__name__)


@shared_task(
    queue="dataset",
    acks_late=True,
    reject_on_worker_lost=True,
    autoretry_for=(Exception,),
    dont_autoretry_for=(KnowledgeTaskDeliveryHandledError,),
    retry_backoff=True,
    retry_kwargs={"max_retries": 10},
)
def add_document_to_index_task(
    dataset_document_id: str,
    expected_generation: str | None = None,
    outbox_id: str | None = None,
) -> None:
    with document_index_state_task_execution(
        dataset_document_id,
        expected_generation,
        outbox_id,
        action="add",
    ) as task_context:
        if task_context is None:
            return
        _run_add_document_to_index(
            task_context.ref,
            outbox_id,
            task_context.indexing_execution,
        )


def _run_add_document_to_index(
    document_ref: DocumentRef,
    outbox_id: str | None,
    execution: DocumentIndexingExecution,
) -> None:
    """
    Async Add document to index
    :param dataset_document_id:

    Usage: add_document_to_index_task.delay(dataset_document_id)
    """
    dataset_document_id = document_ref.document_id
    logger.info(click.style(f"Start add document to index: {dataset_document_id}", fg="green"))
    start_at = time.perf_counter()

    with session_factory.create_session() as session:
        execution.assert_owned()
        conditions = [
            DatasetDocument.id == dataset_document_id,
            DatasetDocument.tenant_id == document_ref.dataset.tenant_id,
            DatasetDocument.dataset_id == document_ref.dataset.dataset_id,
            DatasetDocument.indexing_generation == execution.expected_generation,
            DatasetDocument.indexing_status == IndexingStatus.COMPLETED,
            DatasetDocument.enabled.is_(True),
            DatasetDocument.archived.is_(False),
            DatasetDocument.is_paused.is_(False),
        ]
        dataset_document = session.scalar(select(DatasetDocument).where(*conditions).limit(1))
        if not dataset_document:
            raise DocumentIndexingGenerationChangedError(dataset_document_id)

        indexing_cache_key = f"document_{dataset_document.id}_indexing"

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
                    for attachment in get_segment_attachments(segment, session=session):
                        multimodal_documents.append(
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
                        )
                documents.append(document)

            index_type = get_dataset_doc_form(dataset, session=session)
            index_processor = IndexProcessorFactory(index_type).init_index_processor()
            execution.assert_owned()
            index_processor.load(dataset, documents, multimodal_documents=multimodal_documents, session=session)
            execution.assert_owned()

            complete_document_index_add(session, document_ref, execution=execution)
            session.commit()

            # Enable summary indexes for all segments in this document
            from services.knowledge.summaries.adapters import SummaryIndexAdapter

            segment_ids_list = [segment.id for segment in segments]
            if segment_ids_list:
                try:
                    execution.assert_owned()
                    SummaryIndexAdapter.enable_summaries_for_segments(
                        dataset=dataset,
                        segment_ids=segment_ids_list,
                    )
                    execution.assert_owned()
                except Exception:
                    logger.warning("Failed to enable summaries for document %s", dataset_document.id, exc_info=True)
                    if outbox_id is not None:
                        raise

            end_at = time.perf_counter()
            logger.info(
                click.style(f"Document added to index: {dataset_document.id} latency: {end_at - start_at}", fg="green")
            )
        except (
            DocumentIndexingGenerationChangedError,
            KnowledgeIndexingLeaseLostError,
            KnowledgeTaskExecutionLeaseLostError,
        ):
            session.rollback()
            raise
        except Exception:
            logger.exception("add document to index failed")
            session.rollback()
            if outbox_id is not None:
                raise
        finally:
            execution.assert_owned()
            redis_client.delete(indexing_cache_key)
