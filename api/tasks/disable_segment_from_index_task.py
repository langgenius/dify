import logging
import time

import click
from celery import shared_task

from core.rag.index_processor.index_processor_factory import IndexProcessorFactory
from extensions.ext_database import db
from extensions.ext_redis import redis_client
from models.dataset import DocumentSegment

logger = logging.getLogger(__name__)


@shared_task(queue="dataset")
def disable_segment_from_index_task(segment_id: str):
    """
    Async disable segment from index
    :param segment_id:

    Usage: disable_segment_from_index_task.delay(segment_id)
    """
    logger.info(click.style(f"Start disable segment from index: {segment_id}", fg="green"))
    start_at = time.perf_counter()

    segment = db.session.query(DocumentSegment).where(DocumentSegment.id == segment_id).first()
    if not segment:
        logger.info(click.style(f"Segment not found: {segment_id}", fg="red"))
        db.session.close()
        return

    if segment.status != "completed":
        logger.info(click.style(f"Segment is not completed, disable is not allowed: {segment_id}", fg="red"))
        db.session.close()
        return

    indexing_cache_key = f"segment_{segment.id}_indexing"

    try:
        dataset = segment.dataset

        if not dataset:
            logger.info(click.style(f"Segment {segment.id} has no dataset, pass.", fg="cyan"))
            return

        dataset_document = segment.document

        if not dataset_document:
            logger.info(click.style(f"Segment {segment.id} has no document, pass.", fg="cyan"))
            return

        if not dataset_document.enabled or dataset_document.archived or dataset_document.indexing_status != "completed":
            logger.info(click.style(f"Segment {segment.id} document status is invalid, pass.", fg="cyan"))
            return

        index_type = dataset_document.doc_form
        index_processor = IndexProcessorFactory(index_type).init_index_processor()
        index_processor.clean(dataset, [segment.index_node_id])

        end_at = time.perf_counter()
        logger.info(click.style(f"Segment removed from index: {segment.id} latency: {end_at - start_at}", fg="green"))
    except Exception:
        logger.exception("remove segment from index failed")
        segment.enabled = True
        db.session.commit()
    finally:
        redis_client.delete(indexing_cache_key)
        db.session.close()
