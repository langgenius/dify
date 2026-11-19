"""Adapt conversation export work to Celery and configured file storage."""

from collections.abc import Callable
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import TextIO

from configs import dify_config
from enums import DeploymentEdition
from extensions.ext_storage import storage
from extensions.storage.storage_type import StorageType
from services.retention.conversation.log_export_service import (
    ConversationLogExportFileNotFoundError,
    ConversationLogExportTask,
    LogExportDownload,
)


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


def open_conversation_log_export_csv(storage_key: str, expires_in: int, filename: str) -> LogExportDownload:
    """Sign the Cloud S3 download or open the CSV through the configured storage."""
    # Self-hosted S3 endpoints can be private to the API container.
    if dify_config.DEPLOYMENT_EDITION == DeploymentEdition.CLOUD and dify_config.STORAGE_TYPE == StorageType.S3:
        if not storage.exists(storage_key):
            raise ConversationLogExportFileNotFoundError()
        return storage.generate_presigned_url(
            storage_key, expires_in=expires_in, content_type="text/csv; charset=utf-8", download_filename=filename
        )

    # Read the first chunk before sending headers so a missing CSV can return a 404.
    try:
        stream = storage.load(storage_key, stream=True)
        return next(stream), stream
    except (FileNotFoundError, StopIteration) as exc:
        raise ConversationLogExportFileNotFoundError() from exc
