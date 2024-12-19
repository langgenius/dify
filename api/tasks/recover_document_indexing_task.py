import logging
import time

import click
from celery import shared_task
from werkzeug.exceptions import NotFound

from core.indexing_runner import DocumentIsPausedError, IndexingRunner
from extensions.ext_database import db
from models.dataset import Document


@shared_task(queue="dataset")
def recover_document_indexing_task(dataset_id: str, document_id: str):
    """
    Async recover document
    :param dataset_id:
    :param document_id:

    Usage: recover_document_indexing_task.delay(dataset_id, document_id)
    """
    logging.info(click.style("Recover document: {}".format(document_id), fg="green"))
    start_at = time.perf_counter()

    document = db.session.query(Document).filter(Document.id == document_id, Document.dataset_id == dataset_id).first()

    if not document:
        raise NotFound("Document not found")

    try:
        indexing_runner = IndexingRunner()
        if document.indexing_status in {"waiting", "parsing", "cleaning"}:
            indexing_runner.run([document])
        elif document.indexing_status == "splitting":
            indexing_runner.run_in_splitting_status(document)
        elif document.indexing_status == "indexing":
            indexing_runner.run_in_indexing_status(document)
        end_at = time.perf_counter()
        logging.info(
            click.style("Processed document: {} latency: {}".format(document.id, end_at - start_at), fg="green")
        )
    except DocumentIsPausedError as ex:
        logging.info(click.style(str(ex), fg="yellow"))
    except Exception:
        pass
