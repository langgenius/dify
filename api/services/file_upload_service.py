"""Validate and store uploads using an explicit creator and resource owner."""

import hashlib
import os
import uuid
from dataclasses import dataclass, replace
from datetime import datetime
from typing import Literal, Protocol

from configs import dify_config
from constants import AUDIO_EXTENSIONS, DOCUMENT_EXTENSIONS, IMAGE_EXTENSIONS, VIDEO_EXTENSIONS
from libs.datetime_utils import naive_utc_now
from models.enums import CreatorUserRole
from services.errors.file import BlockedFileExtensionError, FileTooLargeError, UnsupportedFileTypeError


@dataclass(frozen=True, slots=True)
class FileUploadActor:
    """Creator identity, independent of the tenant receiving the upload."""

    id: str
    creator_role: CreatorUserRole


@dataclass(frozen=True, slots=True)
class FileUploadData:
    """Metadata stored with an upload, before persistence assigns its ID."""

    name: str
    size: int
    extension: str
    mime_type: str
    created_by: str
    created_at: datetime
    tenant_id: str
    source_url: str
    key: str
    storage_type: str
    created_by_role: CreatorUserRole
    hash: str | None
    used: bool
    used_by: str | None
    used_at: datetime | None


@dataclass(frozen=True, slots=True)
class FileUploadResult(FileUploadData):
    """Detached upload metadata; source_url may contain a response-only signed URL."""

    id: str


class FileUploadWriter(Protocol):
    """Upload capability used by indexing without depending on service assembly."""

    def upload_file_for_actor(
        self,
        *,
        actor: FileUploadActor,
        resource_tenant_id: str,
        filename: str,
        content: bytes,
        mimetype: str,
    ) -> FileUploadResult: ...


class FileUploadRepository(Protocol):
    def create(self, *, upload: FileUploadData) -> FileUploadResult: ...


class FileUploadStorage(Protocol):
    def save(self, filename: str, data: bytes, /) -> None: ...


class FileUploadUrlSigner(Protocol):
    def __call__(self, *, upload_file_id: str) -> str: ...


class FileUploadService:
    def __init__(
        self,
        *,
        uploads: FileUploadRepository,
        storage: FileUploadStorage,
        storage_type: str,
        sign_file_url: FileUploadUrlSigner,
    ) -> None:
        self._uploads: FileUploadRepository = uploads
        self._storage: FileUploadStorage = storage
        self._storage_type: str = storage_type
        self._sign_file_url: FileUploadUrlSigner = sign_file_url

    def upload_file_for_actor(
        self,
        *,
        actor: FileUploadActor,
        resource_tenant_id: str,
        filename: str,
        content: bytes,
        mimetype: str,
        source: Literal["datasets"] | None = None,
        source_url: str = "",
        default_file_size_limit: int | None = None,
    ) -> FileUploadResult:
        """Upload into the admitted tenant and return detached metadata.

        default_file_size_limit overrides the non-media limit in MiB, including
        0 for empty files only. None uses dify_config.UPLOAD_FILE_SIZE_LIMIT.
        Images, video and audio retain their dedicated configured limits.
        """
        filename, extension = self.validate_upload(
            filename=filename, content=content, source=source, default_file_size_limit=default_file_size_limit
        )
        file_key = f"upload_files/{resource_tenant_id}/{uuid.uuid4()}.{extension}"
        self._storage.save(file_key, content)

        upload = self._uploads.create(
            upload=FileUploadData(
                name=filename,
                size=len(content),
                extension=extension,
                mime_type=mimetype,
                created_by=actor.id,
                created_at=naive_utc_now(),
                tenant_id=resource_tenant_id,
                source_url=source_url,
                key=file_key,
                storage_type=self._storage_type,
                created_by_role=actor.creator_role,
                hash=hashlib.sha3_256(content).hexdigest(),
                used=False,
                used_by=None,
                used_at=None,
            )
        )
        if not upload.source_url:
            return replace(upload, source_url=self._sign_file_url(upload_file_id=upload.id))
        return upload

    @staticmethod
    def validate_upload(
        *,
        filename: str,
        content: bytes,
        source: Literal["datasets"] | None = None,
        default_file_size_limit: int | None = None,
    ) -> tuple[str, str]:
        """Return normalized metadata after enforcing the shared upload policy."""
        extension = os.path.splitext(filename)[1].lstrip(".").lower()
        if any(separator in filename for separator in ("/", "\\")):
            raise ValueError("Filename contains invalid characters")
        if len(filename) > 200:
            filename = filename.split(".")[0][:200] + "." + extension
        if extension and extension in dify_config.UPLOAD_FILE_EXTENSION_BLACKLIST:
            raise BlockedFileExtensionError(f"File extension '.{extension}' is not allowed for security reasons")
        if source == "datasets" and extension not in DOCUMENT_EXTENSIONS:
            raise UnsupportedFileTypeError()
        if not FileUploadService.is_file_size_within_limit(
            extension=extension, file_size=len(content), default_file_size_limit=default_file_size_limit
        ):
            raise FileTooLargeError()
        return filename, extension

    @staticmethod
    def is_file_size_within_limit(
        *, extension: str, file_size: int, default_file_size_limit: int | None = None
    ) -> bool:
        return file_size <= FileUploadService.file_size_limit(
            extension=extension, default_file_size_limit=default_file_size_limit
        )

    @staticmethod
    def file_size_limit(*, extension: str, default_file_size_limit: int | None = None) -> int:
        """Return the size an extension is allowed, in bytes.

        default_file_size_limit is a non-media override in MiB. None uses
        dify_config.UPLOAD_FILE_SIZE_LIMIT; 0 allows only empty files.
        Images, video and audio use their dedicated limits regardless of this
        override.
        """
        if extension in IMAGE_EXTENSIONS:
            file_size_limit = dify_config.UPLOAD_IMAGE_FILE_SIZE_LIMIT
        elif extension in VIDEO_EXTENSIONS:
            file_size_limit = dify_config.UPLOAD_VIDEO_FILE_SIZE_LIMIT
        elif extension in AUDIO_EXTENSIONS:
            file_size_limit = dify_config.UPLOAD_AUDIO_FILE_SIZE_LIMIT
        else:
            # Context overrides only affect the default, not media-specific limits.
            file_size_limit = (
                default_file_size_limit if default_file_size_limit is not None else dify_config.UPLOAD_FILE_SIZE_LIMIT
            )
        return file_size_limit * 1024 * 1024
