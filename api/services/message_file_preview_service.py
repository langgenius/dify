"""Application service for previewing files attached to app messages."""

from collections.abc import Iterator
from typing import NamedTuple, Protocol


class MessageFilePreviewNotFoundError(Exception):
    """Raised when a requested file is not attached to a message."""


class MessageFilePreviewAccessDeniedError(Exception):
    """Raised when a requested file is outside the authenticated app scope."""


class MessageFilePreviewRecord(NamedTuple):
    key: str
    name: str
    size: int
    extension: str
    mime_type: str | None


class MessageFilePreviewQuery(Protocol):
    def get_for_app(
        self,
        *,
        file_id: str,
        app_id: str,
        tenant_id: str,
    ) -> MessageFilePreviewRecord:
        """Return preview metadata after enforcing the file ownership chain.

        The upload must be referenced by a MessageFile, its Message must belong
        to app_id, and the UploadFile must exist under tenant_id.
        """
        ...


class FileStreamStorage(Protocol):
    def load_stream(self, filename: str) -> Iterator[bytes]: ...


class MessageFilePreview(NamedTuple):
    content: Iterator[bytes]
    file: MessageFilePreviewRecord


class MessageFilePreviewService:
    def __init__(
        self,
        *,
        files: MessageFilePreviewQuery,
        storage: FileStreamStorage,
    ) -> None:
        self._files = files
        self._storage = storage

    def get_preview(
        self,
        *,
        file_id: str,
        app_id: str,
        tenant_id: str,
    ) -> MessageFilePreview:
        file = self._files.get_for_app(
            file_id=file_id,
            app_id=app_id,
            tenant_id=tenant_id,
        )
        return MessageFilePreview(
            content=self._storage.load_stream(file.key),
            file=file,
        )
