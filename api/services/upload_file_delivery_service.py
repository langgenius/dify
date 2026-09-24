"""Application service for delivering uploaded files through public file endpoints."""

from collections.abc import Iterator
from typing import NamedTuple, Protocol

from constants import IMAGE_EXTENSIONS
from graphon.file import helpers as file_helpers
from services.errors.file import UnsupportedFileTypeError


class UploadFileDeliveryNotFoundError(LookupError):
    pass


class UploadFileDeliveryRecord(NamedTuple):
    key: str
    name: str
    size: int
    extension: str
    mime_type: str | None


class UploadFileDeliveryQuery(Protocol):
    def get_by_id(self, *, file_id: str) -> UploadFileDeliveryRecord | None: ...

    def get_workspace_logo(self, *, workspace_id: str) -> UploadFileDeliveryRecord | None: ...


class UploadFileStorage(Protocol):
    def load_stream(self, filename: str) -> Iterator[bytes]: ...

    def load_once(self, filename: str) -> bytes: ...


class UploadFileDelivery(NamedTuple):
    content: bytes | Iterator[bytes]
    file: UploadFileDeliveryRecord


class UploadFileDeliveryService:
    def __init__(
        self,
        *,
        files: UploadFileDeliveryQuery,
        storage: UploadFileStorage,
    ) -> None:
        self._files = files
        self._storage = storage

    def get_signed_image_preview(
        self,
        *,
        file_id: str,
        timestamp: str,
        nonce: str,
        sign: str,
    ) -> UploadFileDelivery:
        if not file_helpers.verify_image_signature(
            upload_file_id=file_id,
            timestamp=timestamp,
            nonce=nonce,
            sign=sign,
        ):
            raise UploadFileDeliveryNotFoundError("File not found or signature is invalid")

        file = self._get_file(file_id=file_id)
        self._ensure_image(file=file)
        return UploadFileDelivery(
            content=self._storage.load_stream(file.key),
            file=file,
        )

    def get_signed_file_preview(
        self,
        *,
        file_id: str,
        timestamp: str,
        nonce: str,
        sign: str,
    ) -> UploadFileDelivery:
        if not file_helpers.verify_file_signature(
            upload_file_id=file_id,
            timestamp=timestamp,
            nonce=nonce,
            sign=sign,
        ):
            raise UploadFileDeliveryNotFoundError("File not found or signature is invalid")

        file = self._get_file(file_id=file_id)
        return UploadFileDelivery(
            content=self._storage.load_stream(file.key),
            file=file,
        )

    def get_workspace_webapp_logo(self, *, workspace_id: str) -> UploadFileDelivery:
        file = self._files.get_workspace_logo(workspace_id=workspace_id)
        if file is None:
            raise UploadFileDeliveryNotFoundError("File not found or signature is invalid")

        self._ensure_image(file=file)
        return UploadFileDelivery(
            content=self._storage.load_once(file.key),
            file=file,
        )

    def _get_file(self, *, file_id: str) -> UploadFileDeliveryRecord:
        file = self._files.get_by_id(file_id=file_id)
        if file is None:
            raise UploadFileDeliveryNotFoundError("File not found or signature is invalid")
        return file

    @staticmethod
    def _ensure_image(*, file: UploadFileDeliveryRecord) -> None:
        if file.extension.lower() not in IMAGE_EXTENSIONS:
            raise UnsupportedFileTypeError()
