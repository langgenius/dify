"""File operations over explicit tenant and creator identities."""

from __future__ import annotations

import hashlib
import logging
import os
import posixpath
from collections.abc import Callable, Generator, Iterator, Sequence
from contextlib import contextmanager, suppress
from dataclasses import replace
from datetime import datetime
from tempfile import NamedTemporaryFile
from typing import Protocol
from uuid import uuid4
from zipfile import ZIP_DEFLATED, ZipFile

from constants import DOCUMENT_EXTENSIONS
from services.entities.upload_file import CreatedUploadArtifact, FileUploadActor, UploadFileRecord
from services.errors.file import FileNotExistsError, UnsupportedFileTypeError
from services.file_upload_policy import FileUploadPolicy

logger = logging.getLogger(__name__)
PREVIEW_WORDS_LIMIT = 3000


class UploadFileStore(Protocol):
    """Own database transactions used by file operations."""

    def save_created_upload_file(self, *, file: UploadFileRecord) -> None: ...

    def get_file(self, *, tenant_id: str, file_id: str) -> UploadFileRecord | None: ...

    def get_files(self, *, tenant_id: str, file_ids: Sequence[str]) -> dict[str, UploadFileRecord]: ...


class UploadFileReclaimer(Protocol):
    """Decide global liveness and physically reclaim file candidates."""

    def delete_unreferenced_files(
        self,
        *,
        tenant_id: str,
        file_ids: Sequence[str],
        delete_blob: Callable[[str], None],
    ) -> tuple[str, ...]: ...


class FileStorage(Protocol):
    def save(self, filename: str, data: bytes) -> None: ...

    def load_once(self, filename: str) -> bytes: ...

    def load_stream(self, filename: str) -> Iterator[bytes]: ...

    def generate_presigned_url(self, filename: str, *, expires_in: int, content_type: str | None = None) -> str: ...


class FileURLSigner(Protocol):
    def __call__(self, *, upload_file_id: str) -> str: ...


class UploadFileCreator(Protocol):
    """The upload capability used by workflow offload and document extraction."""

    def upload_file(
        self,
        *,
        actor: FileUploadActor,
        tenant_id: str,
        filename: str,
        content: bytes,
        mimetype: str,
        allowed_extensions: frozenset[str] | None = None,
        source_url: str = "",
        default_file_size_limit: int | None = None,
    ) -> UploadFileRecord: ...


class FileService:
    def __init__(
        self,
        *,
        files: UploadFileStore,
        reclaimer: UploadFileReclaimer,
        storage: FileStorage,
        upload_policy: FileUploadPolicy,
        storage_type: str,
        sign_file: FileURLSigner,
        extract_text: Callable[[UploadFileRecord], str],
        delete_blob: Callable[[str], None],
        direct_icon_urls: bool,
        access_timeout: int,
        clock: Callable[[], datetime],
    ) -> None:
        self._files = files
        self._reclaimer = reclaimer
        self._storage = storage
        self._upload_policy = upload_policy
        self._storage_type = storage_type
        self._sign_file = sign_file
        self._extract_text = extract_text
        self._delete_blob = delete_blob
        self._direct_icon_urls = direct_icon_urls
        self._access_timeout = access_timeout
        self._clock = clock

    def upload_file(
        self,
        *,
        actor: FileUploadActor,
        tenant_id: str,
        filename: str,
        content: bytes,
        mimetype: str,
        allowed_extensions: frozenset[str] | None = None,
        source_url: str = "",
        default_file_size_limit: int | None = None,
    ) -> UploadFileRecord:
        """Store a blob and publish its tenant-owned metadata."""
        self._validate_identity(actor=actor, tenant_id=tenant_id)
        filename, extension = self._upload_policy.prepare_upload(
            filename=filename,
            size=len(content),
            allowed_extensions=allowed_extensions,
            default_file_size_limit=default_file_size_limit,
        )
        file = self._new_file(
            actor=actor,
            tenant_id=tenant_id,
            filename=filename,
            extension=extension,
            content=content,
            mimetype=mimetype,
            source_url=source_url,
        )
        return self._store_upload(file=file, content=content)

    def upload_text(self, *, actor: FileUploadActor, tenant_id: str, text: str, text_name: str) -> UploadFileRecord:
        """Store generated text through the shared upload protocol.

        Generated pipeline payloads and document text retain their existing
        size policy, display name and used metadata.
        """
        self._validate_identity(actor=actor, tenant_id=tenant_id)
        content = text.encode("utf-8")
        file = self._new_file(
            actor=actor,
            tenant_id=tenant_id,
            filename=text_name[:200],
            extension="txt",
            content=content,
            mimetype="text/plain",
            source_url="",
        )
        file = replace(file, used=True, used_by=actor.id, used_at=self._clock(), hash=None)
        return self._store_upload(file=file, content=content)

    @staticmethod
    def _validate_identity(*, actor: FileUploadActor, tenant_id: str) -> None:
        if not tenant_id or not actor.id:
            raise ValueError("An upload requires its tenant and creator identity")

    def _new_file(
        self,
        *,
        actor: FileUploadActor,
        tenant_id: str,
        filename: str,
        extension: str,
        content: bytes,
        mimetype: str,
        source_url: str,
    ) -> UploadFileRecord:
        return UploadFileRecord(
            id=str(uuid4()),
            tenant_id=tenant_id,
            storage_type=self._storage_type,
            key=f"upload_files/{tenant_id}/{uuid4()}.{extension}",
            name=filename,
            size=len(content),
            extension=extension,
            mime_type=mimetype,
            created_by_role=actor.creator_role,
            created_by=actor.id,
            created_at=self._clock(),
            hash=hashlib.sha3_256(content).hexdigest(),
            source_url=source_url,
        )

    def _store_upload(self, *, file: UploadFileRecord, content: bytes) -> UploadFileRecord:
        try:
            self._storage.save(file.key, content)
        except Exception:
            # A remote PUT may have completed before its client surfaced an
            # error. Best-effort deletion is safe because the metadata row has
            # not been published yet.
            self._compensate_blob(file)
            raise
        try:
            self._files.save_created_upload_file(file=file)
        except Exception:
            # A commit error can have an unknown outcome. Without the removed
            # durable writer marker, deleting the blob here could corrupt a
            # successfully committed UploadFile row. Retain the blob instead.
            logger.warning("Upload metadata publication failed; blob retained, file_id=%s", file.id)
            raise
        if not file.source_url:
            file = replace(file, source_url=self._sign_file(upload_file_id=file.id))
        return file

    def _compensate_blob(self, file: UploadFileRecord) -> None:
        try:
            self._delete_blob(file.key)
        except Exception:
            logger.exception("Failed to compensate upload storage write, file_id=%s", file.id)

    def get_file(self, *, tenant_id: str, file_id: str) -> UploadFileRecord:
        file = self._files.get_file(tenant_id=tenant_id, file_id=file_id)
        if file is None:
            raise FileNotExistsError("File not found")
        return file

    def get_files(self, *, tenant_id: str, file_ids: Sequence[str]) -> dict[str, UploadFileRecord]:
        return self._files.get_files(tenant_id=tenant_id, file_ids=file_ids)

    def get_file_content(self, *, tenant_id: str, file_id: str) -> str:
        file = self.get_file(tenant_id=tenant_id, file_id=file_id)
        return self._storage.load_once(file.key).decode("utf-8")

    def get_file_preview(self, file_id: str, tenant_id: str) -> str:
        file = self.get_file(tenant_id=tenant_id, file_id=file_id)
        if file.extension.lower() not in DOCUMENT_EXTENSIONS:
            raise UnsupportedFileTypeError()
        return self._extract_text(file)[:PREVIEW_WORDS_LIMIT]

    def get_file_presigned_url(self, *, file_id: str, tenant_id: str) -> str:
        file = self.get_file(tenant_id=tenant_id, file_id=file_id)
        return self._storage.generate_presigned_url(
            file.key,
            expires_in=self._access_timeout,
            content_type=file.mime_type,
        )

    def get_icon_url(self, file_id: str, tenant_id: str) -> str:
        if self._direct_icon_urls:
            return self.get_file_presigned_url(file_id=file_id, tenant_id=tenant_id)
        self.get_file(tenant_id=tenant_id, file_id=file_id)
        return self._sign_file(upload_file_id=file_id)

    def delete_file(self, *, tenant_id: str, file_id: str) -> None:
        """Delete a file only when the global liveness scan finds no owner."""
        self._reclaimer.delete_unreferenced_files(
            tenant_id=tenant_id,
            file_ids=(file_id,),
            delete_blob=self._delete_blob,
        )

    def delete_uncommitted_artifact(self, *, artifact: CreatedUploadArtifact) -> None:
        """Delete an extractor blob known not to have entered metadata commit."""
        self._delete_blob(artifact.key)

    @contextmanager
    def build_upload_files_zip_tempfile(self, *, upload_files: Sequence[UploadFileRecord]) -> Generator[str]:
        """Keep a streamed archive on disk until its caller closes the response."""
        used_names: set[str] = set()
        tmp_path: str | None = None
        try:
            with NamedTemporaryFile(mode="w+b", suffix=".zip", delete=False) as tmp:
                tmp_path = tmp.name
                with ZipFile(tmp, mode="w", compression=ZIP_DEFLATED) as archive:
                    for file in upload_files:
                        name = _dedupe_zip_entry_name(_sanitize_zip_entry_name(file.name), used_names)
                        used_names.add(name)
                        with archive.open(name, "w") as entry:
                            for chunk in self._storage.load_stream(file.key):
                                entry.write(chunk)
                tmp.flush()
            yield tmp_path
        finally:
            if tmp_path is not None:
                with suppress(FileNotFoundError):
                    os.remove(tmp_path)


def _sanitize_zip_entry_name(name: str) -> str:
    base = posixpath.basename(name).strip() or "file"
    return base.replace("/", "_").replace("\\", "_")


def _dedupe_zip_entry_name(original_name: str, used_names: set[str]) -> str:
    if original_name not in used_names:
        return original_name
    stem, extension = os.path.splitext(original_name)
    suffix = 1
    while True:
        candidate = f"{stem} ({suffix}){extension}"
        if candidate not in used_names:
            return candidate
        suffix += 1
