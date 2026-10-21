import logging
import time
from collections.abc import Mapping

import click
from celery import shared_task
from celery.exceptions import Reject

from services.knowledge.task_outbox.contracts import KnowledgeTaskDeliveryHandledError
from tasks.clean_document_task import _clean_documents
from tasks.clean_upload_files_task import (
    defer_started_upload_file_cleanup_if_disabled,
    defer_upload_file_cleanup_if_disabled,
)
from tasks.knowledge_task_outbox_task import knowledge_task_execution

logger = logging.getLogger(__name__)


@shared_task(
    queue="dataset",
    autoretry_for=(Exception,),
    retry_backoff=True,
    max_retries=5,
    dont_autoretry_for=(KnowledgeTaskDeliveryHandledError, Reject),
    acks_late=True,
    reject_on_worker_lost=True,
)
def batch_clean_document_task(
    document_ids: list[str],
    dataset_id: str,
    doc_form: str | None,
    file_ids: list[str],
    tenant_id: str | None = None,
    cleanup_manifest: Mapping[str, object] | None = None,
    outbox_id: str | None = None,
) -> None:
    """Clean a deleted document batch using one persisted cleanup snapshot."""

    logger.info(click.style("Start batch clean documents when documents deleted", fg="green"))
    start_at = time.perf_counter()
    if not doc_form:
        raise ValueError("doc_form is required")
    if defer_upload_file_cleanup_if_disabled(outbox_id):
        return
    with knowledge_task_execution(outbox_id) as execution:
        if execution is None:
            return
        _clean_documents(
            document_ids=document_ids,
            dataset_id=dataset_id,
            doc_form=doc_form,
            file_ids=file_ids,
            tenant_id=tenant_id,
            cleanup_manifest=cleanup_manifest,
            source_outbox_id=outbox_id,
            assert_owned=execution.assert_owned,
            assert_cleanup_allowed=lambda: defer_started_upload_file_cleanup_if_disabled(
                execution,
                outbox_id=outbox_id,
            ),
        )
    logger.info(
        click.style(
            f"Cleaned documents when documents deleted latency: {time.perf_counter() - start_at:.2f}s, "
            f"dataset_id: {dataset_id}, document_ids: {document_ids}",
            fg="green",
        )
    )
