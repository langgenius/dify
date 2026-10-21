import logging
import time

import click
from celery import shared_task
from sqlalchemy import select

from core.db.session_factory import session_factory
from core.rag.index_processor.index_processor import IndexProcessorFactory
from extensions.ext_redis import redis_client
from models.dataset import Document, DocumentSegment
from repositories.knowledge.document_query_repository import get_document_dataset
from repositories.knowledge.document_repository import complete_document_index_remove
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
def remove_document_from_index_task(
    document_id: str,
    expected_generation: str | None = None,
    outbox_id: str | None = None,
) -> None:
    with document_index_state_task_execution(
        document_id,
        expected_generation,
        outbox_id,
        action="remove",
    ) as task_context:
        if task_context is None:
            return
        _run_remove_document_from_index(
            task_context.ref,
            outbox_id,
            task_context.indexing_execution,
        )


def _run_remove_document_from_index(
    document_ref: DocumentRef,
    outbox_id: str | None,
    execution: DocumentIndexingExecution,
) -> None:
    """
    Async Remove document from index
    :param document_id: document id

    Usage: remove_document_from_index.delay(document_id)
    """
    document_id = document_ref.document_id
    logger.info(click.style(f"Start remove document segments from index: {document_id}", fg="green"))
    start_at = time.perf_counter()

    with session_factory.create_session() as session:
        execution.assert_owned()
        conditions = [
            Document.id == document_id,
            Document.tenant_id == document_ref.dataset.tenant_id,
            Document.dataset_id == document_ref.dataset.dataset_id,
            Document.indexing_generation == execution.expected_generation,
            Document.is_paused.is_(False),
        ]
        document = session.scalar(select(Document).where(*conditions).limit(1))
        if not document:
            raise DocumentIndexingGenerationChangedError(document_id)

        if document.enabled and not document.archived:
            raise DocumentIndexingGenerationChangedError(document_id)

        indexing_cache_key = f"document_{document.id}_indexing"

        try:
            dataset = get_document_dataset(document, session=session)

            if not dataset:
                raise Exception("Document has no dataset")

            index_processor = IndexProcessorFactory(document.doc_form).init_index_processor()

            segments = session.scalars(select(DocumentSegment).where(DocumentSegment.document_id == document.id)).all()

            # Disable summary indexes for all segments in this document
            from services.knowledge.summaries.adapters import SummaryIndexAdapter

            segment_ids_list = [segment.id for segment in segments]
            if segment_ids_list:
                try:
                    execution.assert_owned()
                    SummaryIndexAdapter.disable_summaries_for_segments(
                        dataset=dataset,
                        segment_ids=segment_ids_list,
                        disabled_by=document.disabled_by,
                    )
                    execution.assert_owned()
                except Exception:
                    logger.warning("Failed to disable summaries for document %s", document.id, exc_info=True)
                    if outbox_id is not None:
                        raise

            index_node_ids = [segment.index_node_id for segment in segments if segment.index_node_id]
            if index_node_ids:
                try:
                    execution.assert_owned()
                    index_processor.clean(
                        dataset,
                        index_node_ids,
                        with_keywords=True,
                        delete_child_chunks=False,
                        session=session,
                    )
                    execution.assert_owned()
                except Exception:
                    logger.exception("clean dataset %s from index failed", dataset.id)
                    if outbox_id is not None:
                        raise
            complete_document_index_remove(session, document_ref, execution=execution)
            session.commit()

            end_at = time.perf_counter()
            logger.info(
                click.style(
                    f"Document removed from index: {document.id} latency: {end_at - start_at}",
                    fg="green",
                )
            )
        except (
            DocumentIndexingGenerationChangedError,
            KnowledgeIndexingLeaseLostError,
            KnowledgeTaskExecutionLeaseLostError,
        ):
            session.rollback()
            raise
        except Exception:
            logger.exception("remove document from index failed")
            session.rollback()
            if outbox_id is not None:
                raise
        finally:
            execution.assert_owned()
            redis_client.delete(indexing_cache_key)
