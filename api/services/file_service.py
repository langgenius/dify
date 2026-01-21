import base64
import hashlib
import os
import uuid
from collections.abc import Iterator, Sequence
from contextlib import contextmanager, suppress
from tempfile import NamedTemporaryFile
from typing import Literal, Union
from zipfile import ZIP_DEFLATED, ZipFile

from sqlalchemy import Engine, select
from sqlalchemy.orm import Session, sessionmaker
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
from extensions.ext_database import db
from extensions.ext_storage import storage
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

        # check if extension is in blacklist
        if extension and extension in dify_config.UPLOAD_FILE_EXTENSION_BLACKLIST:
            raise BlockedFileExtensionError(f"File extension '.{extension}' is not allowed for security reasons")

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

    def get_file_base64(self, file_id: str) -> str:
        upload_file = (
            self._session_maker(expire_on_commit=False).query(UploadFile).where(UploadFile.id == file_id).first()
        )
        if not upload_file:
            raise NotFound("File not found")
        blob = storage.load_once(upload_file.key)
        return base64.b64encode(blob).decode()

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
        """
        Return a short text preview extracted from a document file.
        """
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
        with self._session_maker() as session, session.begin():
            upload_file = session.scalar(select(UploadFile).where(UploadFile.id == file_id))

            if not upload_file:
                return
            storage.delete(upload_file.key)
            session.delete(upload_file)

    @staticmethod
    def get_upload_files_by_ids(tenant_id: str, upload_file_ids: Sequence[str]) -> dict[str, UploadFile]:
        """
        Fetch `UploadFile` rows for a tenant in a single batch query.

        This is a generic `UploadFile` lookup helper (not dataset/document specific), so it lives in `FileService`.
        """
        if not upload_file_ids:
            return {}

        # Normalize and deduplicate ids before using them in the IN clause.
        upload_file_id_list: list[str] = [str(upload_file_id) for upload_file_id in upload_file_ids]
        unique_upload_file_ids: list[str] = list(set(upload_file_id_list))

        # Fetch upload files in one query for efficient batch access.
        upload_files: Sequence[UploadFile] = db.session.scalars(
            select(UploadFile).where(
                UploadFile.tenant_id == tenant_id,
                UploadFile.id.in_(unique_upload_file_ids),
            )
        ).all()
        return {str(upload_file.id): upload_file for upload_file in upload_files}

    @staticmethod
    def _sanitize_zip_entry_name(name: str) -> str:
        """
        Sanitize a ZIP entry name to avoid path traversal and weird separators.

        We keep this conservative: the upload flow already rejects `/` and `\\`, but older rows (or imported data)
        could still contain unsafe names.
        """
        # Drop any directory components and prevent empty names.
        base = os.path.basename(name).strip() or "file"

        # ZIP uses forward slashes as separators; remove any residual separator characters.
        return base.replace("/", "_").replace("\\", "_")

    @staticmethod
    def _dedupe_zip_entry_name(original_name: str, used_names: set[str]) -> str:
        """
        Return a unique ZIP entry name, inserting suffixes before the extension.
        """
        # Keep the original name when it's not already used.
        if original_name not in used_names:
            return original_name

        # Insert suffixes before the extension (e.g., "doc.txt" -> "doc (1).txt").
        stem, extension = os.path.splitext(original_name)
        suffix = 1
        while True:
            candidate = f"{stem} ({suffix}){extension}"
            if candidate not in used_names:
                return candidate
            suffix += 1

    @staticmethod
    @contextmanager
    def build_upload_files_zip_tempfile(
        *,
        upload_files: Sequence[UploadFile],
    ) -> Iterator[str]:
        """
        Build a ZIP from `UploadFile`s and yield a tempfile path.

        We yield a path (rather than an open file handle) to avoid "read of closed file" issues when Flask/Werkzeug
        streams responses. The caller is expected to keep this context open until the response is fully sent, then
        close it (e.g., via `response.call_on_close(...)`) to delete the tempfile.
        """
        used_names: set[str] = set()

        # Build a ZIP in a temp file and keep it on disk until the caller finishes streaming it.
        tmp_path: str | None = None
        try:
            with NamedTemporaryFile(mode="w+b", suffix=".zip", delete=False) as tmp:
                tmp_path = tmp.name
                with ZipFile(tmp, mode="w", compression=ZIP_DEFLATED) as zf:
                    for upload_file in upload_files:
                        # Ensure the entry name is safe and unique.
                        safe_name = FileService._sanitize_zip_entry_name(upload_file.name)
                        arcname = FileService._dedupe_zip_entry_name(safe_name, used_names)
                        used_names.add(arcname)

                        # Stream file bytes from storage into the ZIP entry.
                        with zf.open(arcname, "w") as entry:
                            for chunk in storage.load(upload_file.key, stream=True):
                                entry.write(chunk)

                # Flush so `send_file(path, ...)` can re-open it safely on all platforms.
                tmp.flush()

            assert tmp_path is not None
            yield tmp_path
        finally:
            # Remove the temp file when the context is closed (typically after the response finishes streaming).
            if tmp_path is not None:
                with suppress(FileNotFoundError):
                    os.remove(tmp_path)
