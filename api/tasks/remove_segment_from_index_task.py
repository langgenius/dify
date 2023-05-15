import logging
import time

import click
from celery import shared_task
from werkzeug.exceptions import NotFound

from core.index.keyword_table_index import KeywordTableIndex
from core.index.vector_index import VectorIndex
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
            raise Exception('Segment has no dataset')

        vector_index = VectorIndex(dataset=dataset)
        keyword_table_index = KeywordTableIndex(dataset=dataset)

        # delete from vector index
        if dataset.indexing_technique == "high_quality":
            vector_index.del_nodes([segment.index_node_id])

        # delete from keyword index
        keyword_table_index.del_nodes([segment.index_node_id])

        end_at = time.perf_counter()
        logging.info(click.style('Segment removed from index: {} latency: {}'.format(segment.id, end_at - start_at), fg='green'))
    except Exception:
        logging.exception("remove segment from index failed")
        segment.enabled = True
        db.session.commit()
    finally:
        redis_client.delete(indexing_cache_key)
