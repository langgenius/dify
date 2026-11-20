"""Open completed conversation exports from the configured storage."""

from configs import dify_config
from enums import DeploymentEdition
from extensions.ext_storage import storage
from extensions.storage.storage_type import StorageType
from services.retention.conversation.log_export_service import (
    ConversationLogExportFileNotFoundError,
    LogExportDownload,
)


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
