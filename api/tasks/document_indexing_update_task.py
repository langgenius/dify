import datetime
import logging
import time

import click
from celery import shared_task
from werkzeug.exceptions import NotFound

from core.index.keyword_table_index import KeywordTableIndex
from core.index.vector_index import VectorIndex
from core.indexing_runner import IndexingRunner, DocumentIsPausedException
from core.llm.error import ProviderTokenNotInitError
from extensions.ext_database import db
from models.dataset import Document, Dataset, DocumentSegment


@shared_task
def document_indexing_update_task(dataset_id: str, document_id: str):
    """
    Async update document
    :param dataset_id:
    :param document_id:

    Usage: document_indexing_update_task.delay(dataset_id, document_id)
    """
    logging.info(click.style('Start update document: {}'.format(document_id), fg='green'))
    start_at = time.perf_counter()

    document = db.session.query(Document).filter(
        Document.id == document_id,
        Document.dataset_id == dataset_id
    ).first()

    if not document:
        raise NotFound('Document not found')

    document.indexing_status = 'parsing'
    document.processing_started_at = datetime.datetime.utcnow()
    db.session.commit()

    # delete all document segment and index
    try:
        dataset = db.session.query(Dataset).filter(Dataset.id == dataset_id).first()
        if not dataset:
            raise Exception('Dataset not found')

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
            click.style('Cleaned document when document update data source or process rule: {} latency: {}'.format(document_id, end_at - start_at), fg='green'))
    except Exception:
        logging.exception("Cleaned document when document update data source or process rule failed")
    try:
        indexing_runner = IndexingRunner()
        indexing_runner.run([document])
        end_at = time.perf_counter()
        logging.info(click.style('update document: {} latency: {}'.format(document.id, end_at - start_at), fg='green'))
    except DocumentIsPausedException:
        logging.info(click.style('Document update paused, document id: {}'.format(document.id), fg='yellow'))
    except ProviderTokenNotInitError as e:
        document.indexing_status = 'error'
        document.error = str(e.description)
        document.stopped_at = datetime.datetime.utcnow()
        db.session.commit()
    except Exception as e:
        logging.exception("consume update document failed")
        document.indexing_status = 'error'
        document.error = str(e)
        document.stopped_at = datetime.datetime.utcnow()
        db.session.commit()
