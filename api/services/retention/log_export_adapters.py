"""Deliver CSV export work through Celery and the configured storage."""

from collections.abc import Callable
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import TextIO

from extensions.ext_storage import storage
from services.retention.log_export_task import LogExportKind, LogExportTask


def dispatch_log_export[FiltersT](task: LogExportTask[FiltersT], *, export_kind: LogExportKind) -> None:
    """Send only the IDs required to load a saved task and use its expiration for delivery."""
    from tasks.log_export_tasks import prepare_log_export_task

    kwargs = {"tenant_id": task.tenant_id, "app_id": task.app_id, "task_id": task.task_id}
    # Keep Conversation submissions readable by workers running the previous version.
    if export_kind != "conversation":
        kwargs["export_kind"] = export_kind
    prepare_log_export_task.apply_async(kwargs=kwargs, task_id=task.task_id, expires=task.expires_at)


def store_log_export_csv(storage_key: str, write_csv: Callable[[TextIO], int]) -> None:
    """Write a UTF-8 CSV to a private temporary file, then upload the completed file."""
    with TemporaryDirectory() as directory:
        path = Path(directory) / "logs.csv"
        with path.open("w", encoding="utf-8", newline="") as output:
            write_csv(output)
        storage.save_file(storage_key, path)
