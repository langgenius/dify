import datetime
import logging
import time

import click
from celery import shared_task
from llama_index.data_structs import Node
from llama_index.data_structs.node_v2 import DocumentRelationship
from werkzeug.exceptions import NotFound

from core.index.keyword_table_index import KeywordTableIndex
from core.index.vector_index import VectorIndex
from extensions.ext_database import db
from extensions.ext_redis import redis_client
from models.dataset import DocumentSegment


@shared_task
def add_segment_to_index_task(segment_id: str):
    """
    Async Add segment to index
    :param segment_id:

    Usage: add_segment_to_index.delay(segment_id)
    """
    logging.info(click.style('Start add segment to index: {}'.format(segment_id), fg='green'))
    start_at = time.perf_counter()

    segment = db.session.query(DocumentSegment).filter(DocumentSegment.id == segment_id).first()
    if not segment:
        raise NotFound('Segment not found')

    if segment.status != 'completed':
        return

    indexing_cache_key = 'segment_{}_indexing'.format(segment.id)

    try:
        relationships = {
            DocumentRelationship.SOURCE: segment.document_id,
        }

        previous_segment = segment.previous_segment
        if previous_segment:
            relationships[DocumentRelationship.PREVIOUS] = previous_segment.index_node_id

        next_segment = segment.next_segment
        if next_segment:
            relationships[DocumentRelationship.NEXT] = next_segment.index_node_id

        node = Node(
            doc_id=segment.index_node_id,
            doc_hash=segment.index_node_hash,
            text=segment.content,
            extra_info=None,
            node_info=None,
            relationships=relationships
        )

        dataset = segment.dataset

        if not dataset:
            raise Exception('Segment has no dataset')

        vector_index = VectorIndex(dataset=dataset)
        keyword_table_index = KeywordTableIndex(dataset=dataset)

        # save vector index
        if dataset.indexing_technique == "high_quality":
            vector_index.add_nodes(
                nodes=[node],
                duplicate_check=True
            )

        # save keyword index
        keyword_table_index.add_nodes([node])

        end_at = time.perf_counter()
        logging.info(click.style('Segment added to index: {} latency: {}'.format(segment.id, end_at - start_at), fg='green'))
    except Exception as e:
        logging.exception("add segment to index failed")
        segment.enabled = False
        segment.disabled_at = datetime.datetime.utcnow()
        segment.status = 'error'
        segment.error = str(e)
        db.session.commit()
    finally:
        redis_client.delete(indexing_cache_key)
