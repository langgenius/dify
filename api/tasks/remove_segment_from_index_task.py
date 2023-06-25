import logging
import time

import click
from celery import shared_task
from werkzeug.exceptions import NotFound

from core.index.index import IndexBuilder
from extensions.ext_database import db
from extensions.ext_redis import redis_client
from models.dataset import DocumentSegment


@shared_task
def remove_segment_from_index_task(segment_id: str):
    """
    Async Remove segment from index
    :param segment_id:

    Usage: remove_segment_from_index.delay(segment_id)
    """
    logging.info(click.style('Start remove segment from index: {}'.format(segment_id), fg='green'))
    start_at = time.perf_counter()

    segment = db.session.query(DocumentSegment).filter(DocumentSegment.id == segment_id).first()
    if not segment:
        raise NotFound('Segment not found')

    if segment.status != 'completed':
        return

    indexing_cache_key = 'segment_{}_indexing'.format(segment.id)

    try:
        dataset = segment.dataset

        if not dataset:
            logging.info(click.style('Segment {} has no dataset, pass.'.format(segment.id), fg='cyan'))
            return

        dataset_document = segment.document

        if not dataset_document:
            logging.info(click.style('Segment {} has no document, pass.'.format(segment.id), fg='cyan'))
            return

        if not dataset_document.enabled or dataset_document.archived or dataset_document.indexing_status != 'completed':
            logging.info(click.style('Segment {} document status is invalid, pass.'.format(segment.id), fg='cyan'))
            return

        vector_index = IndexBuilder.get_index(dataset, 'high_quality')
        kw_index = IndexBuilder.get_index(dataset, 'economy')

        # delete from vector index
        if vector_index:
            vector_index.delete_by_ids([segment.index_node_id])

        # delete from keyword index
        kw_index.delete_by_ids([segment.index_node_id])

        end_at = time.perf_counter()
        logging.info(click.style('Segment removed from index: {} latency: {}'.format(segment.id, end_at - start_at), fg='green'))
    except Exception:
        logging.exception("remove segment from index failed")
        segment.enabled = True
        db.session.commit()
    finally:
        redis_client.delete(indexing_cache_key)
