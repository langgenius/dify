"""Application service for delivering uploaded files through public file endpoints."""

from collections.abc import Iterator
from typing import Literal, NamedTuple, Protocol

from constants import IMAGE_EXTENSIONS
from graphon.file import helpers as file_helpers
from services.errors.file import UnsupportedFileTypeError


class UploadFileDeliveryNotFoundError(LookupError):
    pass


def is_scoped_upload_preview_nonce(nonce: str) -> bool:
    """Recognize the reserved scoped-preview namespace without trusting its claims.

    Ordinary historical random nonces need no application context. Reserved
    versions require the live scoped-access service after signature validation.
    """
    return nonce.startswith("byoa.")


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


class SignedUploadFileAccess(Protocol):
    def verify_signature(
        self,
        *,
        file_id: str,
        timestamp: str,
        nonce: str,
        sign: str,
        preview_kind: Literal["file-preview", "image-preview"],
    ) -> bool:
        """Validate the isolated scoped MAC and TTL without trusting nonce claims."""
        ...

    def authorize(self, *, file_id: str, nonce: str) -> None:
        """Revalidate supported scoped nonces only after isolated scoped HMAC/TTL verification.

        Ordinary signed nonces retain existing semantics. Denials must raise
        UploadFileDeliveryNotFoundError before any storage content is read.
        """
        ...


class UploadFileDelivery(NamedTuple):
    content: bytes | Iterator[bytes]
    file: UploadFileDeliveryRecord


class UploadFileDeliveryService:
    def __init__(
        self,
        *,
        files: UploadFileDeliveryQuery,
        storage: UploadFileStorage,
        access: SignedUploadFileAccess,
    ) -> None:
        self._files = files
        self._storage = storage
        self._access = access

    def verify_and_authorize_preview(
        self,
        *,
        file_id: str,
        timestamp: str,
        nonce: str,
        sign: str,
        preview_kind: Literal["file-preview", "image-preview"],
    ) -> None:
        """Validate the selected MAC scheme before rechecking live scope or reading storage.

        Scoped signatures use an isolated key/domain so historical upload, tool
        and datasource readers cannot accept them. This delivery owner verifies
        and re-admits scoped requests, including normal HTTPS file retrieval.
        Ordinary signed URLs retain their existing verifier and authority.
        """
        if is_scoped_upload_preview_nonce(nonce):
            valid = self._access.verify_signature(
                file_id=file_id, timestamp=timestamp, nonce=nonce, sign=sign, preview_kind=preview_kind
            )
        elif preview_kind == "image-preview":
            valid = file_helpers.verify_image_signature(
                upload_file_id=file_id, timestamp=timestamp, nonce=nonce, sign=sign
            )
        else:
            valid = file_helpers.verify_file_signature(
                upload_file_id=file_id, timestamp=timestamp, nonce=nonce, sign=sign
            )
        if not valid:
            raise UploadFileDeliveryNotFoundError("File not found or signature is invalid")
        self._access.authorize(file_id=file_id, nonce=nonce)

    def get_signed_image_preview(
        self,
        *,
        file_id: str,
        timestamp: str,
        nonce: str,
        sign: str,
    ) -> UploadFileDelivery:
        self.verify_and_authorize_preview(
            file_id=file_id, timestamp=timestamp, nonce=nonce, sign=sign, preview_kind="image-preview"
        )
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
        self.verify_and_authorize_preview(
            file_id=file_id, timestamp=timestamp, nonce=nonce, sign=sign, preview_kind="file-preview"
        )
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
