import logging
import time

import click
from celery import shared_task

from core.indexing_runner import DocumentIsPausedError, IndexingRunner
from extensions.ext_database import db
from models.dataset import Document

logger = logging.getLogger(__name__)


@shared_task(queue="dataset")
def recover_document_indexing_task(dataset_id: str, document_id: str):
    """
    Async recover document
    :param dataset_id:
    :param document_id:

    Usage: recover_document_indexing_task.delay(dataset_id, document_id)
    """
    logger.info(click.style(f"Recover document: {document_id}", fg="green"))
    start_at = time.perf_counter()

    document = db.session.query(Document).where(Document.id == document_id, Document.dataset_id == dataset_id).first()

    if not document:
        logger.info(click.style(f"Document not found: {document_id}", fg="red"))
        db.session.close()
        return

    try:
        indexing_runner = IndexingRunner()
        if document.indexing_status in {"waiting", "parsing", "cleaning"}:
            indexing_runner.run([document])
        elif document.indexing_status == "splitting":
            indexing_runner.run_in_splitting_status(document)
        elif document.indexing_status == "indexing":
            indexing_runner.run_in_indexing_status(document)
        end_at = time.perf_counter()
        logger.info(click.style(f"Processed document: {document.id} latency: {end_at - start_at}", fg="green"))
    except DocumentIsPausedError as ex:
        logger.info(click.style(str(ex), fg="yellow"))
    except Exception:
        logger.exception("recover_document_indexing_task failed, document_id: %s", document_id)
    finally:
        db.session.close()
