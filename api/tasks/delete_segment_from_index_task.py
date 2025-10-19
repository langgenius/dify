import logging
import time

import click
from celery import shared_task

from core.rag.index_processor.index_processor_factory import IndexProcessorFactory
from extensions.ext_database import db
from models.dataset import Dataset, Document

logger = logging.getLogger(__name__)


@shared_task(queue="dataset")
def delete_segment_from_index_task(
    index_node_ids: list, dataset_id: str, document_id: str, child_node_ids: list | None = None
):
    """
    Async Remove segment from index
    :param index_node_ids:
    :param dataset_id:
    :param document_id:

    Usage: delete_segment_from_index_task.delay(index_node_ids, dataset_id, document_id)
    """
    logger.info(click.style("Start delete segment from index", fg="green"))
    start_at = time.perf_counter()
    try:
        dataset = db.session.query(Dataset).where(Dataset.id == dataset_id).first()
        if not dataset:
            logging.warning("Dataset %s not found, skipping index cleanup", dataset_id)
            return

        dataset_document = db.session.query(Document).where(Document.id == document_id).first()
        if not dataset_document:
            return

        if not dataset_document.enabled or dataset_document.archived or dataset_document.indexing_status != "completed":
            logging.info("Document not in valid state for index operations, skipping")
            return
        doc_form = dataset_document.doc_form

        # Proceed with index cleanup using the index_node_ids directly
        index_processor = IndexProcessorFactory(doc_form).init_index_processor()
        index_processor.clean(
            dataset,
            index_node_ids,
            with_keywords=True,
            delete_child_chunks=True,
            precomputed_child_node_ids=child_node_ids,
        )

        end_at = time.perf_counter()
        logger.info(click.style(f"Segment deleted from index latency: {end_at - start_at}", fg="green"))
    except Exception:
        logger.exception("delete segment from index failed")
    finally:
        db.session.close()
