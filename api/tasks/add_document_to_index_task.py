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
from models.dataset import DocumentSegment, Document


@shared_task
def add_document_to_index_task(document_id: str):
    """
    Async Add document to index
    :param document_id:

    Usage: add_document_to_index.delay(document_id)
    """
    logging.info(click.style('Start add document to index: {}'.format(document_id), fg='green'))
    start_at = time.perf_counter()

    document = db.session.query(Document).filter(Document.id == document_id).first()
    if not document:
        raise NotFound('Document not found')

    if document.indexing_status != 'completed':
        return

    indexing_cache_key = 'document_{}_indexing'.format(document.id)

    try:
        segments = db.session.query(DocumentSegment).filter(
            DocumentSegment.document_id == document.id,
            DocumentSegment.enabled == True
        ) \
            .order_by(DocumentSegment.position.asc()).all()

        nodes = []
        previous_node = None
        for segment in segments:
            relationships = {
                DocumentRelationship.SOURCE: document.id
            }

            if previous_node:
                relationships[DocumentRelationship.PREVIOUS] = previous_node.doc_id

                previous_node.relationships[DocumentRelationship.NEXT] = segment.index_node_id

            node = Node(
                doc_id=segment.index_node_id,
                doc_hash=segment.index_node_hash,
                text=segment.content,
                extra_info=None,
                node_info=None,
                relationships=relationships
            )

            previous_node = node

            nodes.append(node)

        dataset = document.dataset

        if not dataset:
            raise Exception('Document has no dataset')

        vector_index = VectorIndex(dataset=dataset)
        keyword_table_index = KeywordTableIndex(dataset=dataset)

        # save vector index
        if dataset.indexing_technique == "high_quality":
            vector_index.add_nodes(
                nodes=nodes,
                duplicate_check=True
            )

        # save keyword index
        keyword_table_index.add_nodes(nodes)

        end_at = time.perf_counter()
        logging.info(
            click.style('Document added to index: {} latency: {}'.format(document.id, end_at - start_at), fg='green'))
    except Exception as e:
        logging.exception("add document to index failed")
        document.enabled = False
        document.disabled_at = datetime.datetime.utcnow()
        document.status = 'error'
        document.error = str(e)
        db.session.commit()
    finally:
        redis_client.delete(indexing_cache_key)
