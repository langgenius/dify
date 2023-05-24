import datetime
import logging
import time

import click
from celery import shared_task
from werkzeug.exceptions import NotFound

from core.indexing_runner import IndexingRunner, DocumentIsPausedException
from core.llm.error import ProviderTokenNotInitError
from extensions.ext_database import db
from models.dataset import Document


@shared_task
def document_indexing_task(dataset_id: str, document_ids: list):
    """
    Async process document
    :param dataset_id:
    :param document_ids:

    Usage: document_indexing_task.delay(dataset_id, document_id)
    """
    documents = []
    for document_id in document_ids:
        logging.info(click.style('Start process document: {}'.format(document_id), fg='green'))
        start_at = time.perf_counter()

        document = db.session.query(Document).filter(
            Document.id == document_id,
            Document.dataset_id == dataset_id
        ).first()

        if not document:
            raise NotFound('Document not found')

        document.indexing_status = 'parsing'
        document.processing_started_at = datetime.datetime.utcnow()
        documents.append(document)
        db.session.add(document)
    db.session.commit()

    try:
        indexing_runner = IndexingRunner()
        indexing_runner.run(documents)
        end_at = time.perf_counter()
        logging.info(click.style('Processed document: {} latency: {}'.format(document.id, end_at - start_at), fg='green'))
    except DocumentIsPausedException:
        logging.info(click.style('Document paused, document id: {}'.format(document.id), fg='yellow'))
    except ProviderTokenNotInitError as e:
        document.indexing_status = 'error'
        document.error = str(e.description)
        document.stopped_at = datetime.datetime.utcnow()
        db.session.commit()
    except Exception as e:
        logging.exception("consume document failed")
        document.indexing_status = 'error'
        document.error = str(e)
        document.stopped_at = datetime.datetime.utcnow()
        db.session.commit()
