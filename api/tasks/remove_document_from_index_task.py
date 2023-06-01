import logging
import time

import click
from celery import shared_task
from werkzeug.exceptions import NotFound

from core.index.keyword_table_index import KeywordTableIndex
from core.index.vector_index import VectorIndex
from extensions.ext_database import db
from extensions.ext_redis import redis_client
from models.dataset import DocumentSegment, Document


@shared_task
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

        vector_index = VectorIndex(dataset=dataset)
        keyword_table_index = KeywordTableIndex(dataset=dataset)

        # delete from vector index
        vector_index.del_doc(document.id)

        # delete from keyword index
        segments = db.session.query(DocumentSegment).filter(DocumentSegment.document_id == document.id).all()
        index_node_ids = [segment.index_node_id for segment in segments]
        if index_node_ids:
            keyword_table_index.del_nodes(index_node_ids)

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
