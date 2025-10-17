import hashlib
import os
import uuid
from typing import Literal, Union

from sqlalchemy import Engine
from sqlalchemy.orm import sessionmaker
from werkzeug.exceptions import NotFound

from configs import dify_config
from constants import (
    AUDIO_EXTENSIONS,
    DOCUMENT_EXTENSIONS,
    IMAGE_EXTENSIONS,
    VIDEO_EXTENSIONS,
)
from core.file import helpers as file_helpers
from core.rag.extractor.extract_processor import ExtractProcessor
from extensions.ext_storage import storage
from libs.datetime_utils import naive_utc_now
from libs.helper import extract_tenant_id
from models import Account
from models.enums import CreatorUserRole
from models.model import EndUser, UploadFile

from .errors.file import FileTooLargeError, UnsupportedFileTypeError

PREVIEW_WORDS_LIMIT = 3000


class FileService:
    _session_maker: sessionmaker

    def __init__(self, session_factory: sessionmaker | Engine | None = None):
        if isinstance(session_factory, Engine):
            self._session_maker = sessionmaker(bind=session_factory)
        elif isinstance(session_factory, sessionmaker):
            self._session_maker = session_factory
        else:
            raise AssertionError("must be a sessionmaker or an Engine.")

    def upload_file(
        self,
        *,
        filename: str,
        content: bytes,
        mimetype: str,
        user: Union[Account, EndUser],
        source: Literal["datasets"] | None = None,
        source_url: str = "",
    ) -> UploadFile:
        # get file extension
        extension = os.path.splitext(filename)[1].lstrip(".").lower()

        # check if filename contains invalid characters
        if any(c in filename for c in ["/", "\\", ":", "*", "?", '"', "<", ">", "|"]):
            raise ValueError("Filename contains invalid characters")

        if len(filename) > 200:
            filename = filename.split(".")[0][:200] + "." + extension

        if source == "datasets" and extension not in DOCUMENT_EXTENSIONS:
            raise UnsupportedFileTypeError()

        # get file size
        file_size = len(content)

        # check if the file size is exceeded
        if not FileService.is_file_size_within_limit(extension=extension, file_size=file_size):
            raise FileTooLargeError

        # generate file key
        file_uuid = str(uuid.uuid4())

        current_tenant_id = extract_tenant_id(user)

        file_key = "upload_files/" + (current_tenant_id or "") + "/" + file_uuid + "." + extension

        # save file to storage
        storage.save(file_key, content)

        # save file to db
        upload_file = UploadFile(
            tenant_id=current_tenant_id or "",
            storage_type=dify_config.STORAGE_TYPE,
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
        # The `UploadFile` ID is generated within its constructor, so flushing to retrieve the ID is unnecessary.
        # We can directly generate the `source_url` here before committing.
        if not upload_file.source_url:
            upload_file.source_url = file_helpers.get_signed_file_url(upload_file_id=upload_file.id)

        with self._session_maker(expire_on_commit=False) as session:
            session.add(upload_file)
            session.commit()

        return upload_file

    @staticmethod
    def is_file_size_within_limit(*, extension: str, file_size: int) -> bool:
        if extension in IMAGE_EXTENSIONS:
            file_size_limit = dify_config.UPLOAD_IMAGE_FILE_SIZE_LIMIT * 1024 * 1024
        elif extension in VIDEO_EXTENSIONS:
            file_size_limit = dify_config.UPLOAD_VIDEO_FILE_SIZE_LIMIT * 1024 * 1024
        elif extension in AUDIO_EXTENSIONS:
            file_size_limit = dify_config.UPLOAD_AUDIO_FILE_SIZE_LIMIT * 1024 * 1024
        else:
            file_size_limit = dify_config.UPLOAD_FILE_SIZE_LIMIT * 1024 * 1024

        return file_size <= file_size_limit

    def upload_text(self, text: str, text_name: str, user_id: str, tenant_id: str) -> UploadFile:
        if len(text_name) > 200:
            text_name = text_name[:200]
        # user uuid as file name
        file_uuid = str(uuid.uuid4())
        file_key = "upload_files/" + tenant_id + "/" + file_uuid + ".txt"

        # save file to storage
        storage.save(file_key, text.encode("utf-8"))

        # save file to db
        upload_file = UploadFile(
            tenant_id=tenant_id,
            storage_type=dify_config.STORAGE_TYPE,
            key=file_key,
            name=text_name,
            size=len(text),
            extension="txt",
            mime_type="text/plain",
            created_by=user_id,
            created_by_role=CreatorUserRole.ACCOUNT,
            created_at=naive_utc_now(),
            used=True,
            used_by=user_id,
            used_at=naive_utc_now(),
        )

        with self._session_maker(expire_on_commit=False) as session:
            session.add(upload_file)
            session.commit()

        return upload_file

    def get_file_preview(self, file_id: str):
        with self._session_maker(expire_on_commit=False) as session:
            upload_file = session.query(UploadFile).where(UploadFile.id == file_id).first()

        if not upload_file:
            raise NotFound("File not found")

        # extract text from file
        extension = upload_file.extension
        if extension.lower() not in DOCUMENT_EXTENSIONS:
            raise UnsupportedFileTypeError()

        text = ExtractProcessor.load_from_upload_file(upload_file, return_text=True)
        text = text[0:PREVIEW_WORDS_LIMIT] if text else ""

        return text

    def get_image_preview(self, file_id: str, timestamp: str, nonce: str, sign: str):
        result = file_helpers.verify_image_signature(
            upload_file_id=file_id, timestamp=timestamp, nonce=nonce, sign=sign
        )
        if not result:
            raise NotFound("File not found or signature is invalid")
        with self._session_maker(expire_on_commit=False) as session:
            upload_file = session.query(UploadFile).where(UploadFile.id == file_id).first()

        if not upload_file:
            raise NotFound("File not found or signature is invalid")

        # extract text from file
        extension = upload_file.extension
        if extension.lower() not in IMAGE_EXTENSIONS:
            raise UnsupportedFileTypeError()

        generator = storage.load(upload_file.key, stream=True)

        return generator, upload_file.mime_type

    def get_file_generator_by_file_id(self, file_id: str, timestamp: str, nonce: str, sign: str):
        result = file_helpers.verify_file_signature(upload_file_id=file_id, timestamp=timestamp, nonce=nonce, sign=sign)
        if not result:
            raise NotFound("File not found or signature is invalid")

        with self._session_maker(expire_on_commit=False) as session:
            upload_file = session.query(UploadFile).where(UploadFile.id == file_id).first()

        if not upload_file:
            raise NotFound("File not found or signature is invalid")

        generator = storage.load(upload_file.key, stream=True)

        return generator, upload_file

    def get_public_image_preview(self, file_id: str):
        with self._session_maker(expire_on_commit=False) as session:
            upload_file = session.query(UploadFile).where(UploadFile.id == file_id).first()

        if not upload_file:
            raise NotFound("File not found or signature is invalid")

        # extract text from file
        extension = upload_file.extension
        if extension.lower() not in IMAGE_EXTENSIONS:
            raise UnsupportedFileTypeError()

        generator = storage.load(upload_file.key)

        return generator, upload_file.mime_type

    def get_file_content(self, file_id: str) -> str:
        with self._session_maker(expire_on_commit=False) as session:
            upload_file: UploadFile | None = session.query(UploadFile).where(UploadFile.id == file_id).first()

        if not upload_file:
            raise NotFound("File not found")
        content = storage.load(upload_file.key)

        return content.decode("utf-8")

    def delete_file(self, file_id: str):
        with self._session_maker(expire_on_commit=False) as session:
            upload_file: UploadFile | None = session.query(UploadFile).where(UploadFile.id == file_id).first()

        if not upload_file:
            return
        storage.delete(upload_file.key)
        session.delete(upload_file)
        session.commit()
