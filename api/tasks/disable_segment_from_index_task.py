import logging
import time

import click
from celery import shared_task  # type: ignore
from werkzeug.exceptions import NotFound

from core.rag.index_processor.index_processor_factory import IndexProcessorFactory
from extensions.ext_database import db
from extensions.ext_redis import redis_client
from models.dataset import DocumentSegment


@shared_task(queue="dataset")
def disable_segment_from_index_task(segment_id: str):
    """
    Async disable segment from index
    :param segment_id:

    Usage: disable_segment_from_index_task.delay(segment_id)
    """
    logging.info(click.style("Start disable segment from index: {}".format(segment_id), fg="green"))
    start_at = time.perf_counter()

    segment = db.session.query(DocumentSegment).filter(DocumentSegment.id == segment_id).first()
    if not segment:
        raise NotFound("Segment not found")

    if segment.status != "completed":
        raise NotFound("Segment is not completed , disable action is not allowed.")

    indexing_cache_key = "segment_{}_indexing".format(segment.id)

    try:
        dataset = segment.dataset

        if not dataset:
            logging.info(click.style("Segment {} has no dataset, pass.".format(segment.id), fg="cyan"))
            return

        dataset_document = segment.document

        if not dataset_document:
            logging.info(click.style("Segment {} has no document, pass.".format(segment.id), fg="cyan"))
            return

        if not dataset_document.enabled or dataset_document.archived or dataset_document.indexing_status != "completed":
            logging.info(click.style("Segment {} document status is invalid, pass.".format(segment.id), fg="cyan"))
            return

        index_type = dataset_document.doc_form
        index_processor = IndexProcessorFactory(index_type).init_index_processor()
        index_processor.clean(dataset, [segment.index_node_id])

        end_at = time.perf_counter()
        logging.info(
            click.style("Segment removed from index: {} latency: {}".format(segment.id, end_at - start_at), fg="green")
        )
    except Exception:
        logging.exception("remove segment from index failed")
        segment.enabled = True
        db.session.commit()
    finally:
        redis_client.delete(indexing_cache_key)
