"""Archive-only deletion jobs on the existing workflow archive queue."""

import logging

from celery import shared_task

from core.db.session_factory import get_session_maker
from extensions.ext_redis import redis_client
from libs.archive_storage import ArchiveStorageError, get_archive_storage, get_export_storage
from repositories.workflow_run_archive_repository import WorkflowRunArchiveBundleQueryRepository
from services.retention.workflow_run.archive_deletion import WorkflowRunArchiveDeleter
from services.retention.workflow_run.archive_deletion_task import WorkflowRunArchiveDeletionStatus
from services.retention.workflow_run.archive_month_lock import (
    RedisWorkflowRunArchiveMonthLock,
)
from tasks.workflow_run_archive_download_tasks import WORKFLOW_RUN_ARCHIVE_DOWNLOAD_QUEUE

logger = logging.getLogger(__name__)


@shared_task(
    queue=WORKFLOW_RUN_ARCHIVE_DOWNLOAD_QUEUE,
    acks_late=True,
    reject_on_worker_lost=True,
    autoretry_for=(Exception,),
    retry_backoff=30,
    retry_backoff_max=120,
    retry_kwargs={"max_retries": 5},
)
def delete_workflow_run_archive_task(tenant_id: str, year: int, month: int) -> None:
    """Redelivery is safe because only DB rows with durable deletion requests are selected."""
    logger.info("Deleting workflow run archive month: tenant=%s year=%s month=%s", tenant_id, year, month)
    result = WorkflowRunArchiveDeleter(
        bundles=WorkflowRunArchiveBundleQueryRepository(session_factory=get_session_maker()),
        archive_storage_provider=get_archive_storage,
        download_storage_provider=get_export_storage,
        month_lock=RedisWorkflowRunArchiveMonthLock(redis=redis_client),
    ).delete(tenant_id=tenant_id, year=year, month=month)
    if result.status is WorkflowRunArchiveDeletionStatus.FAILED:
        # The deleter persists FAILED durably but swallows the fault: without
        # raising, Celery reports SUCCESS and the configured autoretry/backoff
        # never engages (#44059). Exhausting the retry budget then surfaces as
        # a task failure instead of silent success.
        raise ArchiveStorageError(result.error or "Failed to delete archive files. Please retry.")
