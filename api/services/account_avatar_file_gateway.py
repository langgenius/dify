"""File-domain adapter used by the account avatar application service."""

import hashlib
from io import BytesIO
from pathlib import PurePath
from typing import override
from uuid import uuid4

from PIL import Image, UnidentifiedImageError
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from configs import dify_config
from constants import IMAGE_EXTENSIONS
from extensions.ext_storage import storage
from extensions.storage.storage_type import StorageType
from graphon.file import helpers as file_helpers
from libs.datetime_utils import naive_utc_now
from models.enums import CreatorUserRole
from models.model import UploadFile
from services.account_ports import AccountAvatarFileGateway
from services.entities.account_entities import AccountAvatarUpload
from services.errors.file import BlockedFileExtensionError, FileTooLargeError, UnsupportedFileTypeError


class SQLAlchemyAccountAvatarFileGateway(AccountAvatarFileGateway):
    def __init__(self, *, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

    @override
    def get_owned_signed_url(self, *, account_id: str, upload_file_id: str) -> str | None:
        with self._session_factory() as session:
            owned_file_id = session.scalar(
                select(UploadFile.id)
                .where(
                    UploadFile.id == upload_file_id,
                    UploadFile.created_by_role == CreatorUserRole.ACCOUNT,
                    UploadFile.created_by == account_id,
                )
                .limit(1)
            )

        if owned_file_id is None:
            return None
        return file_helpers.get_signed_file_url(upload_file_id=owned_file_id)

    @override
    def upload(self, *, account_id: str, filename: str, content: bytes) -> AccountAvatarUpload:
        """Validate and store an Account image; NULL tenant ownership excludes workspace queries.

        Storage writes happen outside the transaction. A failed metadata write
        removes the new blob; successful uploads leave the Account unchanged.
        """
        if any(separator in filename for separator in ("/", "\\")):
            raise ValueError("Filename contains invalid characters")
        extension = PurePath(filename).suffix.lstrip(".").lower()
        if extension in dify_config.UPLOAD_FILE_EXTENSION_BLACKLIST:
            raise BlockedFileExtensionError(f"File extension '.{extension}' is not allowed for security reasons")
        if extension not in IMAGE_EXTENSIONS:
            raise UnsupportedFileTypeError
        if len(content) > dify_config.UPLOAD_IMAGE_FILE_SIZE_LIMIT * 1024 * 1024:
            raise FileTooLargeError
        try:
            with Image.open(BytesIO(content)) as image:
                if image.format is None or image.format != Image.registered_extensions().get(f".{extension}"):
                    raise UnsupportedFileTypeError
                mimetype = Image.MIME.get(image.format, "application/octet-stream")
                image.verify()
        except (UnidentifiedImageError, OSError, SyntaxError, Image.DecompressionBombError) as error:
            raise UnsupportedFileTypeError from error

        file_id = str(uuid4())
        key = f"account_avatars/{account_id}/{file_id}.{extension}"
        upload_file = UploadFile(
            tenant_id=None,
            storage_type=StorageType(dify_config.STORAGE_TYPE),
            key=key,
            name=filename[:200],
            size=len(content),
            extension=extension,
            mime_type=mimetype,
            created_by_role=CreatorUserRole.ACCOUNT,
            created_by=account_id,
            created_at=naive_utc_now(),
            used=False,
            hash=hashlib.sha3_256(content).hexdigest(),
        )
        upload_file.id = file_id
        storage.save(key, content)
        try:
            with self._session_factory.begin() as session:
                session.add(upload_file)
        except Exception:
            storage.delete(key)
            raise
        return AccountAvatarUpload(id=file_id, avatar_url=file_helpers.get_signed_file_url(upload_file_id=file_id))
