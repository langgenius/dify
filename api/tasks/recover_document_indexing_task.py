import logging
import time

import click
from celery import shared_task
from sqlalchemy import select

from core.db.session_factory import session_factory
from models.dataset import Document
from services.knowledge.indexing.adapters.execution import build_document_indexing_service
from services.knowledge.indexing.errors import DocumentIsPausedError
from services.knowledge.resource_scope import DatasetRef

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

    with session_factory.create_session() as session:
        document = session.scalar(
            select(Document).where(Document.id == document_id, Document.dataset_id == dataset_id).limit(1)
        )

        if not document:
            logger.info(click.style(f"Document not found: {document_id}", fg="red"))
            return

        try:
            indexing_service = build_document_indexing_service(session_factory=session_factory.get_session_maker())
            document_ref = DatasetRef(document.tenant_id, document.dataset_id).document(document.id)
            status = document.indexing_status
            session.commit()
            if status in {"waiting", "parsing", "cleaning"}:
                indexing_service.run([document_ref])
            elif status == "splitting":
                indexing_service.run_in_splitting_status(document_ref)
            elif status == "indexing":
                indexing_service.run_in_indexing_status(document_ref)
            end_at = time.perf_counter()
            logger.info(click.style(f"Processed document: {document.id} latency: {end_at - start_at}", fg="green"))
        except DocumentIsPausedError as ex:
            logger.info(click.style(str(ex), fg="yellow"))
        except Exception:
            logger.exception("recover_document_indexing_task failed, document_id: %s", document_id)
