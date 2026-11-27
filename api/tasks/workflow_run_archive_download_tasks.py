"""Celery tasks for preparing workflow-run archive downloads."""

import logging

from celery import Task, shared_task

from core.db.session_factory import get_session_maker
from extensions.ext_redis import redis_client
from libs.archive_storage import get_archive_storage, get_export_storage
from repositories.workflow_run_archive_repository import WorkflowRunArchiveBundleQueryRepository
from services.retention.workflow_run.archive_download_preparation import WorkflowRunArchiveDownloadPreparer
from services.retention.workflow_run.archive_download_task_cache import WorkflowRunArchiveDownloadTaskCache
from services.retention.workflow_run.archive_month_lock import (
    RedisWorkflowRunArchiveMonthLock,
    WorkflowRunArchiveMonthBusyError,
)

logger = logging.getLogger(__name__)

WORKFLOW_RUN_ARCHIVE_DOWNLOAD_QUEUE = "workflow_archive"


@shared_task(
    bind=True,
    queue=WORKFLOW_RUN_ARCHIVE_DOWNLOAD_QUEUE,
    acks_late=True,
    reject_on_worker_lost=True,
    autoretry_for=(WorkflowRunArchiveMonthBusyError,),
    retry_backoff=30,
    retry_backoff_max=120,
    retry_kwargs={"max_retries": 5},
)
def prepare_workflow_run_archive_download_task(self: Task, tenant_id: str, download_id: str) -> None:
    """Redeliver interrupted work; only the matching Celery claim may start a bounded preparation attempt."""
    celery_task_id = self.request.id
    if celery_task_id is None:
        raise ValueError("A Celery request id is required for archive download preparation")
    logger.info(
        "Received workflow run archive download: tenant=%s download_id=%s celery_task_id=%s redelivered=%s retries=%s",
        tenant_id,
        download_id,
        celery_task_id,
        (self.request.delivery_info or {}).get("redelivered", False),
        self.request.retries,
    )
    WorkflowRunArchiveDownloadPreparer(
        archive_storage_provider=get_archive_storage,
        bundles=WorkflowRunArchiveBundleQueryRepository(session_factory=get_session_maker()),
        cache=WorkflowRunArchiveDownloadTaskCache(redis=redis_client),
        download_storage_provider=get_export_storage,
        month_lock=RedisWorkflowRunArchiveMonthLock(redis=redis_client),
    ).prepare(tenant_id=tenant_id, download_id=download_id, celery_task_id=celery_task_id)
