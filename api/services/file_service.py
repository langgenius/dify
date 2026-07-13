import hashlib
import os
import uuid
from typing import Literal

from sqlalchemy import Engine
from sqlalchemy.orm import Session, sessionmaker

from configs import dify_config
from constants import (
    DOCUMENT_EXTENSIONS,
)
from extensions.ext_storage import storage
from extensions.storage.storage_type import StorageType
from graphon.file import helpers as file_helpers
from libs.datetime_utils import naive_utc_now
from libs.helper import extract_tenant_id
from models import Account
from models.enums import CreatorUserRole
from models.model import EndUser, UploadFile

from .errors.file import BlockedFileExtensionError, FileTooLargeError, UnsupportedFileTypeError

PREVIEW_WORDS_LIMIT = 3000


class FileService:
    _session_maker: sessionmaker[Session]

    def __init__(self, session_factory: sessionmaker | Engine | None = None):
        match session_factory:
            case Engine():
                self._session_maker = sessionmaker(bind=session_factory)
            case sessionmaker():
                self._session_maker = session_factory
            case _:
                raise AssertionError("must be a sessionmaker or an Engine.")

    def upload_file(
        self,
        *,
        filename: str,
        content: bytes,
        mimetype: str,
        user: Account | EndUser,
        source: Literal["datasets"] | None = None,
        source_url: str = "",
    ) -> UploadFile:
        # get file extension
        extension = os.path.splitext(filename)[1].lstrip(".").lower()

        # Only reject path separators here. The original filename is stored as metadata,
        # while the storage key is UUID-based.
        if any(c in filename for c in ["/", "\\"]):
            raise ValueError("Filename contains invalid characters")

        if len(filename) > 200:
            filename = filename.split(".")[0][:200] + "." + extension

        # check if extension is in blacklist
        if extension and extension in dify_config.UPLOAD_FILE_EXTENSION_BLACKLIST:
            raise BlockedFileExtensionError(f"File extension '.{extension}' is not allowed for security reasons")

        if source == "datasets" and extension not in DOCUMENT_EXTENSIONS:
            raise UnsupportedFileTypeError()

        # get file size
        file_size = len(content)

        # check if the file size is exceeded
        if not FileService.is_file_size_within_limit(extension=extension, file_size=file_size):
            raise FileTooLargeError(message="File size exceeds limit")

        # generate file key
        file_uuid = str(uuid.uuid4())

        current_tenant_id = extract_tenant_id(user)

        file_key = "upload_files/" + (current_tenant_id or "") + "/" + file_uuid + "." + extension

        # save file to storage
        storage.save(file_key, content)

        # save file to db
        upload_file = UploadFile(
            tenant_id=current_tenant_id or "",
            storage_type=StorageType(dify_config.STORAGE_TYPE),
            key=file_key,
            name=filename,
            size=file_size,
            extension=extension,
            mime_type=mimetype,
            created_by_role=(CreatorUserRole.ACCOUNT if isinstance(user, Account) else CreatorUserRole.END_USER),
            created_by=user.id,
            created_at=naive_utc_now(),
            used=False,
            hash=hashlib.sha3_256(content).hexdigest(),
            source_url=source_url,
        )

        with self._session_maker(expire_on_commit=False) as session:
            session.add(upload_file)
            session.commit()

        if not upload_file.source_url:
            upload_file.source_url = file_helpers.get_signed_file_url(upload_file_id=upload_file.id)

        return upload_file
