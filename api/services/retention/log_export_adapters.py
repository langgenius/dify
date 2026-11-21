"""Deliver CSV export work through Celery and the configured storage."""

from collections.abc import Callable
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import TextIO

from configs import dify_config
from enums import DeploymentEdition
from extensions.ext_storage import storage
from extensions.storage.storage_type import StorageType
from services.retention.log_export_task import (
    LogExportDownload,
    LogExportFileNotFoundError,
    LogExportKind,
    LogExportTask,
)


def dispatch_log_export[FiltersT](task: LogExportTask[FiltersT], *, export_kind: LogExportKind) -> None:
    """Send only the IDs required to load a saved task and use its expiration for delivery."""
    from tasks.log_export_tasks import prepare_log_export_task

    kwargs = {"tenant_id": task.tenant_id, "app_id": task.app_id, "task_id": task.task_id}
    # Keep Conversation submissions readable by workers running the previous version.
    if export_kind != "conversation":
        kwargs["export_kind"] = export_kind
    prepare_log_export_task.apply_async(kwargs=kwargs, task_id=task.task_id, expires=task.expires_at)


def store_log_export_csv(storage_key: str, write_csv: Callable[[TextIO], int]) -> int:
    """Write a UTF-8 CSV to a private temporary file, then upload it and return the row count."""
    with TemporaryDirectory() as directory:
        path = Path(directory) / "logs.csv"
        with path.open("w", encoding="utf-8", newline="") as output:
            row_count = write_csv(output)
        storage.save_file(storage_key, path)
        return row_count


def open_log_export_csv(storage_key: str, expires_in: int, filename: str) -> LogExportDownload:
    """Sign the Cloud S3 download or open the CSV through the configured storage."""
    # Self-hosted S3 endpoints can be private to the API container.
    if dify_config.DEPLOYMENT_EDITION == DeploymentEdition.CLOUD and dify_config.STORAGE_TYPE == StorageType.S3:
        if not storage.exists(storage_key):
            raise LogExportFileNotFoundError()
        return storage.generate_presigned_url(
            storage_key, expires_in=expires_in, content_type="text/csv; charset=utf-8", download_filename=filename
        )

    # Read the first chunk before sending headers so a missing CSV can return a 404.
    try:
        stream = storage.load(storage_key, stream=True)
        return next(stream), stream
    except (FileNotFoundError, StopIteration) as exc:
        raise LogExportFileNotFoundError() from exc
