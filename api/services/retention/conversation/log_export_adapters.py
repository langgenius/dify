"""Adapt conversation export work to Celery and configured file storage."""

from collections.abc import Callable
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import TextIO

from extensions.ext_storage import storage
from services.retention.conversation.log_export_service import ConversationLogExportTask


def dispatch_conversation_log_export(task: ConversationLogExportTask) -> None:
    """Publish only the IDs needed to load the saved task, expiring it with its state."""
    from tasks.conversation_log_export_tasks import prepare_conversation_log_export_task

    prepare_conversation_log_export_task.apply_async(
        kwargs={"tenant_id": task.tenant_id, "app_id": task.app_id, "task_id": task.task_id},
        task_id=task.task_id,
        expires=task.expires_at,
    )


def store_conversation_log_export_csv(storage_key: str, write_csv: Callable[[TextIO], int]) -> None:
    """Write a UTF-8 CSV to a private temporary file, then upload the completed file."""
    with TemporaryDirectory() as directory:
        path = Path(directory) / "logs.csv"
        with path.open("w", encoding="utf-8", newline="") as output:
            write_csv(output)
        storage.save_file(storage_key, path)
