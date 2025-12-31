"""
Celery task for exporting workflow runs asynchronously.
"""

import logging
from datetime import UTC, datetime
from typing import cast

from celery import shared_task

from libs.archive_storage import ArchiveStorageNotConfiguredError, get_archive_storage
from services.retention.export_workflow_run import WorkflowRunExportError, WorkflowRunExportService
from services.retention.workflow_run_export_task_status import (
    EXPORT_SIGNED_URL_EXPIRE_SECONDS,
    set_task_status,
)

logger = logging.getLogger(__name__)


@shared_task(queue="export")
def export_workflow_run_task(task_id: str, tenant_id: str, run_id: str) -> None:
    set_task_status(
        task_id,
        "running",
        {
            "tenant_id": tenant_id,
            "run_id": run_id,
            "started_at": datetime.now(UTC).isoformat(),
        },
    )

    service = WorkflowRunExportService()

    try:
        export_result = service.export_to_storage(
            tenant_id=tenant_id,
            run_id=run_id,
        )

        storage_key = cast(str, export_result["storage_key"])

        try:
            storage = get_archive_storage()
            presigned_url = storage.generate_presigned_url(
                storage_key,
                expires_in=EXPORT_SIGNED_URL_EXPIRE_SECONDS,
            )
        except ArchiveStorageNotConfiguredError:
            presigned_url = None

        set_task_status(
            task_id,
            "success",
            {
                "storage_key": storage_key,
                "checksum": export_result["checksum"],
                "size_bytes": export_result["size_bytes"],
                "presigned_url": presigned_url,
                "finished_at": datetime.now(UTC).isoformat(),
            },
        )
    except (WorkflowRunExportError, Exception) as e:
        logger.exception("Export task failed for run %s", run_id)
        set_task_status(
            task_id,
            "failed",
            {
                "error": str(e),
                "finished_at": datetime.now(UTC).isoformat(),
            },
        )
        # re-raise to allow Celery retry policies if configured
        raise
