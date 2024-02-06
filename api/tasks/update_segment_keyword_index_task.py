import datetime
import logging
import time

import click
from celery import shared_task
from werkzeug.exceptions import NotFound

from core.index.index import IndexBuilder
from extensions.ext_database import db
from extensions.ext_redis import redis_client
from models.dataset import DocumentSegment


@shared_task(queue='dataset')
def update_segment_keyword_index_task(segment_id: str):
    """
    Async update segment index
    :param segment_id:
    Usage: update_segment_keyword_index_task.delay(segment_id)
    """
    logging.info(click.style('Start update segment keyword index: {}'.format(segment_id), fg='green'))
    start_at = time.perf_counter()

    segment = db.session.query(DocumentSegment).filter(DocumentSegment.id == segment_id).first()
    if not segment:
        raise NotFound('Segment not found')

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

        kw_index = IndexBuilder.get_index(dataset, 'economy')

        # delete from keyword index
        kw_index.delete_by_ids([segment.index_node_id])

        # save keyword index
        index = IndexBuilder.get_index(dataset, 'economy')
        if index:
            index.update_segment_keywords_index(segment.index_node_id, segment.keywords)

        end_at = time.perf_counter()
        logging.info(click.style('Segment update index: {} latency: {}'.format(segment.id, end_at - start_at), fg='green'))
    except Exception as e:
        logging.exception("update segment index failed")
        segment.enabled = False
        segment.disabled_at = datetime.datetime.utcnow()
        segment.status = 'error'
        segment.error = str(e)
        db.session.commit()
    finally:
        redis_client.delete(indexing_cache_key)
