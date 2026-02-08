import logging
import time

import click
from celery import shared_task

from core.db.session_factory import session_factory
from core.rag.index_processor.index_processor_factory import IndexProcessorFactory
from core.rag.models.document import Document
from extensions.ext_redis import redis_client
from libs.datetime_utils import naive_utc_now
from models.dataset import DocumentSegment

logger = logging.getLogger(__name__)


@shared_task(queue="dataset")
def create_segment_to_index_task(segment_id: str, keywords: list[str] | None = None):
    """
    Async create segment to index
    :param segment_id:
    :param keywords:
    Usage: create_segment_to_index_task.delay(segment_id)
    """
    logger.info(click.style(f"Start create segment to index: {segment_id}", fg="green"))
    start_at = time.perf_counter()

    with session_factory.create_session() as session:
        segment = session.query(DocumentSegment).where(DocumentSegment.id == segment_id).first()
        if not segment:
            logger.info(click.style(f"Segment not found: {segment_id}", fg="red"))
            return

        if segment.status != "waiting":
            return

        indexing_cache_key = f"segment_{segment.id}_indexing"

        try:
            # update segment status to indexing
            session.query(DocumentSegment).filter_by(id=segment.id).update(
                {
                    DocumentSegment.status: "indexing",
                    DocumentSegment.indexing_at: naive_utc_now(),
                }
            )
            session.commit()
            document = Document(
                page_content=segment.content,
                metadata={
                    "doc_id": segment.index_node_id,
                    "doc_hash": segment.index_node_hash,
                    "document_id": segment.document_id,
                    "dataset_id": segment.dataset_id,
                },
            )

            dataset = segment.dataset

            if not dataset:
                logger.info(click.style(f"Segment {segment.id} has no dataset, pass.", fg="cyan"))
                return

            dataset_document = segment.document

            if not dataset_document:
                logger.info(click.style(f"Segment {segment.id} has no document, pass.", fg="cyan"))
                return

            if (
                not dataset_document.enabled
                or dataset_document.archived
                or dataset_document.indexing_status != "completed"
            ):
                logger.info(click.style(f"Segment {segment.id} document status is invalid, pass.", fg="cyan"))
                return

            index_type = dataset.doc_form
            index_processor = IndexProcessorFactory(index_type).init_index_processor()
            index_processor.load(dataset, [document])

            # update segment to completed
            session.query(DocumentSegment).filter_by(id=segment.id).update(
                {
                    DocumentSegment.status: "completed",
                    DocumentSegment.completed_at: naive_utc_now(),
                }
            )
            session.commit()

            end_at = time.perf_counter()
            logger.info(click.style(f"Segment created to index: {segment.id} latency: {end_at - start_at}", fg="green"))
        except Exception as e:
            logger.exception("create segment to index failed")
            segment.enabled = False
            segment.disabled_at = naive_utc_now()
            segment.status = "error"
            segment.error = str(e)
            session.commit()
        finally:
            redis_client.delete(indexing_cache_key)
