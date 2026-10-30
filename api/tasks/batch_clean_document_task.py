import logging
import time

import click
from celery import Task, shared_task

from services.knowledge.indexing.locks import KnowledgeIndexingLockBusyError
from tasks.clean_document_task import _clean_documents

logger = logging.getLogger(__name__)


@shared_task(
    bind=True,
    queue="dataset",
    autoretry_for=(Exception,),
    retry_backoff=True,
    max_retries=None,
    dont_autoretry_for=(ValueError,),
    acks_late=True,
    reject_on_worker_lost=True,
)
def batch_clean_document_task(
    self: Task,
    document_ids: list[str],
    dataset_id: str,
    doc_form: str | None,
    file_ids: list[str],
) -> None:
    """Clean a deleted document batch using the established four-field message."""

    logger.info(click.style("Start batch clean documents when documents deleted", fg="green"))
    start_at = time.perf_counter()
    if not doc_form:
        raise ValueError("doc_form is required")
    try:
        _clean_documents(
            document_ids=document_ids,
            dataset_id=dataset_id,
            doc_form=doc_form,
            file_ids=file_ids,
        )
    except KnowledgeIndexingLockBusyError as error:
        raise self.retry(exc=error, countdown=60, max_retries=None) from error
    logger.info(
        click.style(
            f"Cleaned documents when documents deleted latency: {time.perf_counter() - start_at:.2f}s, "
            f"dataset_id: {dataset_id}, document_ids: {document_ids}",
            fg="green",
        )
    )
