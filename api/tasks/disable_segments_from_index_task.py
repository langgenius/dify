import logging
import time

import click
from celery import shared_task
from sqlalchemy import select

from core.rag.index_processor.index_processor_factory import IndexProcessorFactory
from extensions.ext_database import db
from extensions.ext_redis import redis_client
from models.dataset import Dataset, DocumentSegment
from models.dataset import Document as DatasetDocument

logger = logging.getLogger(__name__)


@shared_task(queue="dataset")
def disable_segments_from_index_task(segment_ids: list, dataset_id: str, document_id: str):
    """
    Async disable segments from index
    :param segment_ids: list of segment ids
    :param dataset_id: dataset id
    :param document_id: document id

    Usage: disable_segments_from_index_task.delay(segment_ids, dataset_id, document_id)
    """
    start_at = time.perf_counter()

    dataset = db.session.query(Dataset).where(Dataset.id == dataset_id).first()
    if not dataset:
        logger.info(click.style(f"Dataset {dataset_id} not found, pass.", fg="cyan"))
        db.session.close()
        return

    dataset_document = db.session.query(DatasetDocument).where(DatasetDocument.id == document_id).first()

    if not dataset_document:
        logger.info(click.style(f"Document {document_id} not found, pass.", fg="cyan"))
        db.session.close()
        return
    if not dataset_document.enabled or dataset_document.archived or dataset_document.indexing_status != "completed":
        logger.info(click.style(f"Document {document_id} status is invalid, pass.", fg="cyan"))
        db.session.close()
        return
    # sync index processor
    index_processor = IndexProcessorFactory(dataset_document.doc_form).init_index_processor()

    segments = db.session.scalars(
        select(DocumentSegment).where(
            DocumentSegment.id.in_(segment_ids),
            DocumentSegment.dataset_id == dataset_id,
            DocumentSegment.document_id == document_id,
        )
    ).all()

    if not segments:
        db.session.close()
        return

    try:
        index_node_ids = [segment.index_node_id for segment in segments]
        index_processor.clean(dataset, index_node_ids, with_keywords=True, delete_child_chunks=False)

        end_at = time.perf_counter()
        logger.info(click.style(f"Segments removed from index latency: {end_at - start_at}", fg="green"))
    except Exception:
        # update segment error msg
        db.session.query(DocumentSegment).where(
            DocumentSegment.id.in_(segment_ids),
            DocumentSegment.dataset_id == dataset_id,
            DocumentSegment.document_id == document_id,
        ).update(
            {
                "disabled_at": None,
                "disabled_by": None,
                "enabled": True,
            }
        )
        db.session.commit()
    finally:
        for segment in segments:
            indexing_cache_key = f"segment_{segment.id}_indexing"
            redis_client.delete(indexing_cache_key)
        db.session.close()
