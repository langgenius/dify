import logging
import time

import click
from celery import shared_task  # type: ignore

from core.rag.index_processor.index_processor_factory import IndexProcessorFactory
from extensions.ext_database import db
from models.dataset import Dataset, Document


@shared_task(queue="dataset")
def delete_segment_from_index_task(index_node_ids: list, dataset_id: str, document_id: str):
    """
    Async Remove segment from index
    :param index_node_ids:
    :param dataset_id:
    :param document_id:

    Usage: delete_segment_from_index_task.delay(index_node_ids, dataset_id, document_id)
    """
    logging.info(click.style("Start delete segment from index", fg="green"))
    start_at = time.perf_counter()
    try:
        dataset = db.session.query(Dataset).filter(Dataset.id == dataset_id).first()
        if not dataset:
            return

        dataset_document = db.session.query(Document).filter(Document.id == document_id).first()
        if not dataset_document:
            return

        if not dataset_document.enabled or dataset_document.archived or dataset_document.indexing_status != "completed":
            return

        index_type = dataset_document.doc_form
        index_processor = IndexProcessorFactory(index_type).init_index_processor()
        index_processor.clean(dataset, index_node_ids, with_keywords=True, delete_child_chunks=True)

        end_at = time.perf_counter()
        logging.info(click.style("Segment deleted from index latency: {}".format(end_at - start_at), fg="green"))
    except Exception:
        logging.exception("delete segment from index failed")
