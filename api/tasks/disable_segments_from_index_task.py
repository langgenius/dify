import logging
import time

import click
from celery import shared_task  # type: ignore

from core.rag.index_processor.index_processor_factory import IndexProcessorFactory
from extensions.ext_database import db
from extensions.ext_redis import redis_client
from models.dataset import Dataset, DocumentSegment
from models.dataset import Document as DatasetDocument


@shared_task(queue="dataset")
def disable_segments_from_index_task(segment_ids: list, dataset_id: str, document_id: str):
    """
    Async disable segments from index
    :param segment_ids:

    Usage: disable_segments_from_index_task.delay(segment_ids, dataset_id, document_id)
    """
    start_at = time.perf_counter()

    dataset = db.session.query(Dataset).filter(Dataset.id == dataset_id).first()
    if not dataset:
        logging.info(click.style("Dataset {} not found, pass.".format(dataset_id), fg="cyan"))
        return

    dataset_document = db.session.query(DatasetDocument).filter(DatasetDocument.id == document_id).first()

    if not dataset_document:
        logging.info(click.style("Document {} not found, pass.".format(document_id), fg="cyan"))
        return
    if not dataset_document.enabled or dataset_document.archived or dataset_document.indexing_status != "completed":
        logging.info(click.style("Document {} status is invalid, pass.".format(document_id), fg="cyan"))
        return
    # sync index processor
    index_processor = IndexProcessorFactory(dataset_document.doc_form).init_index_processor()

    segments = (
        db.session.query(DocumentSegment)
        .filter(
            DocumentSegment.id.in_(segment_ids),
            DocumentSegment.dataset_id == dataset_id,
            DocumentSegment.document_id == document_id,
        )
        .all()
    )

    if not segments:
        return

    try:
        index_node_ids = [segment.index_node_id for segment in segments]
        index_processor.clean(dataset, index_node_ids, with_keywords=True, delete_child_chunks=False)

        end_at = time.perf_counter()
        logging.info(click.style("Segments removed from index latency: {}".format(end_at - start_at), fg="green"))
    except Exception:
        # update segment error msg
        db.session.query(DocumentSegment).filter(
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
            indexing_cache_key = "segment_{}_indexing".format(segment.id)
            redis_client.delete(indexing_cache_key)
