import logging
import time

import click
from celery import shared_task
from redis.exceptions import RedisError
from sqlalchemy import select, update

from core.db.session_factory import session_factory
from core.rag.index_processor.index_processor import IndexProcessorFactory
from extensions.ext_redis import redis_client
from models.dataset import Dataset, DocumentSegment
from models.dataset import Document as DatasetDocument
from models.enums import SegmentStatus
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
def disable_segments_from_index_task(segment_ids: list, dataset_id: str, document_id: str):
    """
    Async disable segments from index
    :param segment_ids: list of segment ids
    :param dataset_id: dataset id
    :param document_id: document id

    Usage: disable_segments_from_index_task.delay(segment_ids, dataset_id, document_id)
    """
    locks = RedisKnowledgeIndexingLock(redis=redis_client)
    with locks.hold(document_index_lock_name(document_id), timeout=600, blocking_timeout=5) as lease:
        processed_ids = _disable_segments_from_index(segment_ids, dataset_id, document_id, lease=lease)
        lease.assert_owned()
        for segment_id in processed_ids:
            try:
                redis_client.delete(f"segment_{segment_id}_indexing")
            except Exception:
                logger.warning("Failed to clear indexing cache for segment %s", segment_id, exc_info=True)


def _disable_segments_from_index(
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
                DocumentSegment.enabled.is_(False),
                DocumentSegment.status == SegmentStatus.COMPLETED,
            )
        ).all()

        if not segments:
            return ()

        index_node_ids = [segment.index_node_id for segment in segments if segment.index_node_id]
        # Keep attachment vectors while one owner is disabled. Their
        # physical ids are dataset-wide and can be shared by other active
        # segments; the retained bindings are also needed when this owner
        # is enabled again. Whole-dataset index cleanup owns physical
        # vector deletion.
        try:
            lease.assert_owned()
            if index_node_ids:
                index_processor.clean(
                    dataset, index_node_ids, with_keywords=True, delete_child_chunks=False, session=session
                )
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
                    DocumentSegment.enabled.is_(False),
                )
                .values(
                    enabled=True,
                    disabled_at=None,
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

        # Disable summary indexes for these segments
        from services.knowledge.summaries.adapters import SummaryIndexAdapter

        segment_ids_list = [segment.id for segment in segments]
        try:
            # Get disabled_by from first segment (they should all have the same disabled_by)
            disabled_by = segments[0].disabled_by if segments else None
            lease.assert_owned()
            SummaryIndexAdapter.disable_summaries_for_segments(
                dataset=dataset,
                segment_ids=segment_ids_list,
                disabled_by=disabled_by,
            )
            lease.assert_owned()
        except KnowledgeIndexingLeaseLostError:
            raise
        except Exception:
            logger.warning("Failed to disable summaries for segments", exc_info=True)

        end_at = time.perf_counter()
        logger.info(click.style(f"Segments removed from index latency: {end_at - start_at}", fg="green"))
        return tuple(segment.id for segment in segments)
