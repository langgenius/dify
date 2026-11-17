import logging
import time

import click
from celery import Task, shared_task

from services.knowledge.indexing.locks import KnowledgeIndexingLockBusyError
from tasks.clean_document_task import (
    DOCUMENT_CLEANUP_MAX_RETRIES,
    _clean_documents,
    document_cleanup_retries_exhausted,
)
from tasks.indexing_task_retry import TaskRetriesExhaustedError, is_final_attempt

logger = logging.getLogger(__name__)


@shared_task(
    bind=True,
    queue="dataset",
    autoretry_for=(Exception,),
    retry_backoff=True,
    max_retries=None,
    dont_autoretry_for=(ValueError, TaskRetriesExhaustedError),
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
    """Clean a deleted document batch using the established four-field message.

    Shares ``clean_document_task``'s retry contract: unbounded waits for a busy
    index lock, a bounded budget for every other error, and relational cleanup
    that still runs once index cleanup has failed terminally.
    """

    logger.info(click.style("Start batch clean documents when documents deleted", fg="green"))
    start_at = time.perf_counter()
    if not doc_form:
        raise ValueError("doc_form is required")
    final_attempt = is_final_attempt(self, max_retries=DOCUMENT_CLEANUP_MAX_RETRIES)
    try:
        _clean_documents(
            document_ids=document_ids,
            dataset_id=dataset_id,
            doc_form=doc_form,
            file_ids=file_ids,
            final_attempt=final_attempt,
        )
    except KnowledgeIndexingLockBusyError as error:
        raise self.retry(exc=error, countdown=60, max_retries=None) from error
    except ValueError:
        raise
    except Exception as error:
        if final_attempt:
            raise document_cleanup_retries_exhausted(error, dataset_id=dataset_id) from error
        raise
    logger.info(
        click.style(
            f"Cleaned documents when documents deleted latency: {time.perf_counter() - start_at:.2f}s, "
            f"dataset_id: {dataset_id}, document_ids: {document_ids}",
            fg="green",
        )
    )
