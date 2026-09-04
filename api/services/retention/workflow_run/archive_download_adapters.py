"""Infrastructure adapters used by the workflow-run archive application service."""

from libs.archive_storage import get_export_storage
from services.retention.workflow_run.archive_download_task import WorkflowRunArchiveDownloadTask

_ARCHIVE_DOWNLOAD_MIME_TYPE = "application/zip"


def dispatch_workflow_run_archive_download_task(
    task: WorkflowRunArchiveDownloadTask,
) -> None:
    """Enqueue ZIP preparation after the application service claims the Celery task id."""
    from tasks.workflow_run_archive_download_tasks import prepare_workflow_run_archive_download_task

    celery_task_id = task.celery_task_id
    if celery_task_id is None:
        raise ValueError("celery_task_id is required before dispatch")

    prepare_workflow_run_archive_download_task.apply_async(
        args=(task.tenant_id, task.download_id),
        task_id=celery_task_id,
    )


def sign_workflow_run_archive_download_url(
    storage_key: str,
    *,
    expires_in: int,
    filename: str,
) -> str:
    """Create a browser download URL without initializing export storage during app startup."""
    return get_export_storage().generate_presigned_url(
        storage_key,
        expires_in=expires_in,
        filename=filename,
        content_type=_ARCHIVE_DOWNLOAD_MIME_TYPE,
    )
