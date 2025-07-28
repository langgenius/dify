import datetime
import logging
import time

import click
from celery import shared_task  # type: ignore

from core.rag.index_processor.index_processor_factory import IndexProcessorFactory
from extensions.ext_database import db
from extensions.ext_redis import redis_client
from models.dataset import Document, DocumentSegment


@shared_task(queue="dataset")
def remove_document_from_index_task(document_id: str):
    """
    Async Remove document from index
    :param document_id: document id

    Usage: remove_document_from_index.delay(document_id)
    """
    logging.info(click.style(f"Start remove document segments from index: {document_id}", fg="green"))
    start_at = time.perf_counter()

    document = db.session.query(Document).where(Document.id == document_id).first()
    if not document:
        logging.info(click.style(f"Document not found: {document_id}", fg="red"))
        db.session.close()
        return

    if document.indexing_status != "completed":
        logging.info(click.style(f"Document is not completed, remove is not allowed: {document_id}", fg="red"))
        db.session.close()
        return

    indexing_cache_key = f"document_{document.id}_indexing"

    try:
        dataset = document.dataset

        if not dataset:
            raise Exception("Document has no dataset")

        index_processor = IndexProcessorFactory(document.doc_form).init_index_processor()

        segments = db.session.query(DocumentSegment).where(DocumentSegment.document_id == document.id).all()
        index_node_ids = [segment.index_node_id for segment in segments]
        if index_node_ids:
            try:
                index_processor.clean(dataset, index_node_ids, with_keywords=True, delete_child_chunks=False)
            except Exception:
                logging.exception("clean dataset %s from index failed", dataset.id)
        # update segment to disable
        db.session.query(DocumentSegment).where(DocumentSegment.document_id == document.id).update(
            {
                DocumentSegment.enabled: False,
                DocumentSegment.disabled_at: datetime.datetime.now(datetime.UTC).replace(tzinfo=None),
                DocumentSegment.disabled_by: document.disabled_by,
                DocumentSegment.updated_at: datetime.datetime.now(datetime.UTC).replace(tzinfo=None),
            }
        )
        db.session.commit()

        end_at = time.perf_counter()
        logging.info(
            click.style(f"Document removed from index: {document.id} latency: {end_at - start_at}", fg="green")
        )
    except Exception:
        logging.exception("remove document from index failed")
        if not document.archived:
            document.enabled = True
            db.session.commit()
    finally:
        redis_client.delete(indexing_cache_key)
        db.session.close()
