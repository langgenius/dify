import logging
import time

import click
from celery import shared_task
from redis.exceptions import RedisError
from sqlalchemy import select

from core.db.session_factory import session_factory
from core.rag.index_processor.constant.index_type import IndexStructureType, IndexTechniqueType
from core.rag.index_processor.index_processor import IndexProcessorFactory
from extensions.ext_redis import redis_client
from libs.datetime_utils import naive_utc_now
from models.dataset import Dataset, Document, DocumentSegment
from models.enums import IndexingStatus
from services.knowledge.entities.resource_scope import DatasetRef
from services.knowledge.indexing.adapters.execution import build_document_indexing_service
from services.knowledge.indexing.adapters.redis_lock import RedisKnowledgeIndexingLock
from services.knowledge.indexing.errors import DocumentIsPausedError
from services.knowledge.indexing.locks import (
    KnowledgeIndexingLease,
    KnowledgeIndexingLeaseLostError,
    KnowledgeIndexingLockBusyError,
    document_index_lock_name,
)
from tasks.generate_summary_index_task import generate_summary_index_task

logger = logging.getLogger(__name__)


@shared_task(
    queue="dataset",
    autoretry_for=(KnowledgeIndexingLockBusyError, KnowledgeIndexingLeaseLostError, RedisError),
    retry_backoff=True,
    max_retries=10,
)
def document_indexing_update_task(dataset_id: str, document_id: str) -> None:
    """
    Async update document
    :param dataset_id:
    :param document_id:

    Usage: document_indexing_update_task.delay(dataset_id, document_id)
    """
    locks = RedisKnowledgeIndexingLock(redis=redis_client)
    with locks.hold(
        document_index_lock_name(document_id),
        timeout=600,
        blocking_timeout=5,
    ) as lease:
        _run_document_indexing_update_task(dataset_id, document_id, lease=lease)


def _run_document_indexing_update_task(
    dataset_id: str,
    document_id: str,
    *,
    lease: KnowledgeIndexingLease,
) -> None:
    logger.info(click.style(f"Start update document: {document_id}", fg="green"))
    start_at = time.perf_counter()

    has_error = False
    try:
        with session_factory.create_session() as session:
            dataset = session.scalar(select(Dataset).where(Dataset.id == dataset_id).limit(1))
            if not dataset:
                return

            document = session.scalar(
                select(Document)
                .where(
                    Document.id == document_id,
                    Document.tenant_id == dataset.tenant_id,
                    Document.dataset_id == dataset.id,
                )
                .limit(1)
            )

            if not document:
                logger.info(click.style(f"Document not found: {document_id}", fg="red"))
                return

            document.indexing_status = IndexingStatus.PARSING
            document.processing_started_at = naive_utc_now()

            index_type = document.doc_form
            segments = session.scalars(
                select(DocumentSegment).where(
                    DocumentSegment.tenant_id == dataset.tenant_id,
                    DocumentSegment.dataset_id == dataset.id,
                    DocumentSegment.document_id == document_id,
                )
            ).all()
            index_node_ids = [segment.index_node_id for segment in segments if segment.index_node_id]
            # Persist the parsing status before vector cleanup and extraction.
            session.commit()

            try:
                index_processor = IndexProcessorFactory(index_type).init_index_processor()
                if index_node_ids:
                    lease.assert_owned()
                    index_processor.clean(
                        dataset,
                        index_node_ids,
                        with_keywords=True,
                        delete_child_chunks=True,
                        session=session,
                    )
                    lease.assert_owned()
                    end_at = time.perf_counter()
                    logger.info(
                        click.style(
                            f"Cleaned document when document update data source or process rule: {document_id} "
                            f"latency: {end_at - start_at}",
                            fg="green",
                        )
                    )
            except KnowledgeIndexingLeaseLostError:
                session.rollback()
                raise
            except Exception:
                logger.exception("Failed to clean document index during update, document_id: %s", document_id)
                session.rollback()
                document = session.scalar(
                    select(Document)
                    .where(
                        Document.id == document_id,
                        Document.tenant_id == dataset.tenant_id,
                        Document.dataset_id == dataset.id,
                    )
                    .limit(1)
                )
                if not document:
                    logger.info(click.style(f"Document not found: {document_id}", fg="red"))
                    return
                document.indexing_status = IndexingStatus.PARSING
                document.processing_started_at = naive_utc_now()
                session.commit()

            indexing_service = build_document_indexing_service(session_factory=session_factory.get_session_maker())
            document_refs = [DatasetRef(document.tenant_id, document.dataset_id).document(document.id)]
            session.commit()
            lease.assert_owned()
            indexing_service.run(document_refs, owned_leases={document.id: lease})

            end_at = time.perf_counter()
            logger.info(click.style(f"update document: {document.id} latency: {end_at - start_at}", fg="green"))
    except DocumentIsPausedError as ex:
        logger.info(click.style(str(ex), fg="yellow"))
        has_error = True
    except KnowledgeIndexingLeaseLostError:
        raise
    except Exception:
        logger.exception("document_indexing_update_task failed, document_id: %s", document_id)
        has_error = True

    if has_error:
        return

    # Trigger summary index generation for the updated document if enabled.
    # Only generate for high_quality indexing technique and when summary_index_setting is enabled.
    with session_factory.create_session() as session:
        dataset = session.scalar(select(Dataset).where(Dataset.id == dataset_id).limit(1))
        if not dataset:
            logger.warning("Dataset %s not found after update indexing", dataset_id)
            return
        document = session.scalar(
            select(Document)
            .where(
                Document.id == document_id,
                Document.tenant_id == dataset.tenant_id,
                Document.dataset_id == dataset.id,
            )
            .limit(1)
        )

        if dataset.indexing_technique == IndexTechniqueType.HIGH_QUALITY:
            summary_index_setting = dataset.summary_index_setting
            if summary_index_setting and summary_index_setting.get("enable"):
                if (
                    document
                    and document.indexing_status == IndexingStatus.COMPLETED
                    and document.doc_form != IndexStructureType.QA_INDEX
                    and document.need_summary is True
                ):
                    try:
                        generate_summary_index_task.delay(dataset.id, document.id, None)
                        logger.info(
                            "Queued summary index generation task for document %s in dataset %s "
                            "after update indexing completed",
                            document.id,
                            dataset.id,
                        )
                    except Exception:
                        logger.exception(
                            "Failed to queue summary index generation task for document %s after update",
                            document.id,
                        )
