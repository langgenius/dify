"""Celery tasks for preparing workflow-run archive downloads."""

import logging

from celery import shared_task

from core.db.session_factory import get_session_maker
from extensions.ext_redis import redis_client
from repositories.workflow_run_archive_repository import WorkflowRunArchiveBundleQueryRepository
from services.retention.workflow_run.archive_download_preparation import WorkflowRunArchiveDownloadPreparer
from services.retention.workflow_run.archive_download_task_cache import WorkflowRunArchiveDownloadTaskCache

logger = logging.getLogger(__name__)

WORKFLOW_RUN_ARCHIVE_DOWNLOAD_QUEUE = "workflow_archive"


@shared_task(queue=WORKFLOW_RUN_ARCHIVE_DOWNLOAD_QUEUE)
def prepare_workflow_run_archive_download_task(tenant_id: str, download_id: str) -> None:
    """Prepare a cached workflow-run archive download in the background."""
    logger.info("Preparing workflow run archive download: tenant=%s download_id=%s", tenant_id, download_id)
    WorkflowRunArchiveDownloadPreparer(
        bundles=WorkflowRunArchiveBundleQueryRepository(session_factory=get_session_maker()),
        cache=WorkflowRunArchiveDownloadTaskCache(redis=redis_client),
    ).prepare(tenant_id=tenant_id, download_id=download_id)
