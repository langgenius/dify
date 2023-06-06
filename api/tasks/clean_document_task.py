import logging
import time

import click
from celery import shared_task

from core.index.keyword_table_index import KeywordTableIndex
from core.index.vector_index import VectorIndex
from extensions.ext_database import db
from models.dataset import DocumentSegment, Dataset


@shared_task
def clean_document_task(document_id: str, dataset_id: str):
    """
    Clean document when document deleted.
    :param document_id: document id
    :param dataset_id: dataset id

    Usage: clean_document_task.delay(document_id, dataset_id)
    """
    logging.info(click.style('Start clean document when document deleted: {}'.format(document_id), fg='green'))
    start_at = time.perf_counter()

    try:
        dataset = db.session.query(Dataset).filter(Dataset.id == dataset_id).first()

        if not dataset:
            raise Exception('Document has no dataset')

        vector_index = VectorIndex(dataset=dataset)
        keyword_table_index = KeywordTableIndex(dataset=dataset)

        segments = db.session.query(DocumentSegment).filter(DocumentSegment.document_id == document_id).all()
        index_node_ids = [segment.index_node_id for segment in segments]

        # delete from vector index
        vector_index.del_nodes(index_node_ids)

        # delete from keyword index
        if index_node_ids:
            keyword_table_index.del_nodes(index_node_ids)

        for segment in segments:
            db.session.delete(segment)
        db.session.commit()
        end_at = time.perf_counter()
        logging.info(
            click.style('Cleaned document when document deleted: {} latency: {}'.format(document_id, end_at - start_at), fg='green'))
    except Exception:
        logging.exception("Cleaned document when document deleted failed")
