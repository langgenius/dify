import logging
import time

import click
from celery import shared_task
from werkzeug.exceptions import NotFound

from core.rag.index_processor.index_processor_factory import IndexProcessorFactory
from extensions.ext_database import db
from extensions.ext_redis import redis_client
from models.dataset import Document, DocumentSegment


@shared_task(queue='dataset')
def remove_document_from_index_task(document_id: str):
    """
    Async Remove document from index
    :param document_id: document id

    Usage: remove_document_from_index.delay(document_id)
    """
    logging.info(click.style('Start remove document segments from index: {}'.format(document_id), fg='green'))
    start_at = time.perf_counter()

    document = db.session.query(Document).filter(Document.id == document_id).first()
    if not document:
        raise NotFound('Document not found')

    if document.indexing_status != 'completed':
        return

    indexing_cache_key = 'document_{}_indexing'.format(document.id)

    try:
        dataset = document.dataset

        if not dataset:
            raise Exception('Document has no dataset')

        index_processor = IndexProcessorFactory(document.doc_form).init_index_processor()

        segments = db.session.query(DocumentSegment).filter(DocumentSegment.document_id == document.id).all()
        index_node_ids = [segment.index_node_id for segment in segments]
        if index_node_ids:
            try:
                index_processor.clean(dataset, index_node_ids)
            except Exception:
                logging.exception(f"clean dataset {dataset.id} from index failed")

        end_at = time.perf_counter()
        logging.info(
            click.style('Document removed from index: {} latency: {}'.format(document.id, end_at - start_at), fg='green'))
    except Exception:
        logging.exception("remove document from index failed")
        if not document.archived:
            document.enabled = True
            db.session.commit()
    finally:
        redis_client.delete(indexing_cache_key)
