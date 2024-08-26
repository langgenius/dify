import datetime
import logging
import time
from typing import Optional

import click
from celery import shared_task
from werkzeug.exceptions import NotFound

from core.rag.index_processor.index_processor_factory import IndexProcessorFactory
from core.rag.models.document import Document
from extensions.ext_database import db
from extensions.ext_redis import redis_client
from models.dataset import DocumentSegment


@shared_task(queue="dataset")
def create_segment_to_index_task(segment_id: str, keywords: Optional[list[str]] = None):
    """
    Async create segment to index
    :param segment_id:
    :param keywords:
    Usage: create_segment_to_index_task.delay(segment_id)
    """
    logging.info(click.style("Start create segment to index: {}".format(segment_id), fg="green"))
    start_at = time.perf_counter()

    segment = db.session.query(DocumentSegment).filter(DocumentSegment.id == segment_id).first()
    if not segment:
        raise NotFound("Segment not found")

    if segment.status != "waiting":
        return

    indexing_cache_key = "segment_{}_indexing".format(segment.id)

    try:
        # update segment status to indexing
        update_params = {
            DocumentSegment.status: "indexing",
            DocumentSegment.indexing_at: datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None),
        }
        DocumentSegment.query.filter_by(id=segment.id).update(update_params)
        db.session.commit()
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
            logging.info(click.style("Segment {} has no dataset, pass.".format(segment.id), fg="cyan"))
            return

        dataset_document = segment.document

        if not dataset_document:
            logging.info(click.style("Segment {} has no document, pass.".format(segment.id), fg="cyan"))
            return

        if not dataset_document.enabled or dataset_document.archived or dataset_document.indexing_status != "completed":
            logging.info(click.style("Segment {} document status is invalid, pass.".format(segment.id), fg="cyan"))
            return

        index_type = dataset.doc_form
        index_processor = IndexProcessorFactory(index_type).init_index_processor()
        index_processor.load(dataset, [document])

        # update segment to completed
        update_params = {
            DocumentSegment.status: "completed",
            DocumentSegment.completed_at: datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None),
        }
        DocumentSegment.query.filter_by(id=segment.id).update(update_params)
        db.session.commit()

        end_at = time.perf_counter()
        logging.info(
            click.style("Segment created to index: {} latency: {}".format(segment.id, end_at - start_at), fg="green")
        )
    except Exception as e:
        logging.exception("create segment to index failed")
        segment.enabled = False
        segment.disabled_at = datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)
        segment.status = "error"
        segment.error = str(e)
        db.session.commit()
    finally:
        redis_client.delete(indexing_cache_key)
