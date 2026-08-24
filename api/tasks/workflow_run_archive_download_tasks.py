"""Celery tasks for preparing workflow-run archive downloads."""

import logging

from celery import shared_task

from services.retention.workflow_run.archive_download_preparation import WorkflowRunArchiveDownloadPreparer

logger = logging.getLogger(__name__)

WORKFLOW_RUN_ARCHIVE_DOWNLOAD_QUEUE = "workflow_archive"


@shared_task(queue=WORKFLOW_RUN_ARCHIVE_DOWNLOAD_QUEUE)
def prepare_workflow_run_archive_download_task(tenant_id: str, download_id: str) -> None:
    """Prepare a cached workflow-run archive download in the background."""
    logger.info("Preparing workflow run archive download: tenant=%s download_id=%s", tenant_id, download_id)
    WorkflowRunArchiveDownloadPreparer().prepare(tenant_id=tenant_id, download_id=download_id)
