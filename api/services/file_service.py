"""File operations over detached metadata and injected storage/extraction ports."""

import base64
import os
import posixpath
from collections.abc import Generator, Sequence
from contextlib import closing, contextmanager, suppress
from dataclasses import dataclass
from tempfile import NamedTemporaryFile
from typing import Protocol
from zipfile import ZIP_DEFLATED, ZipFile

from configs import dify_config
from constants import DOCUMENT_EXTENSIONS
from core.file.uploads import FileUploadResult
from enums import DeploymentEdition
from services.errors.file import FileNotExistsError, UnsupportedFileTypeError
from services.file_upload_service import FileUploadUrlSigner

PREVIEW_WORDS_LIMIT = 3000


class FileRepository(Protocol):
    def get(self, *, file_id: str, tenant_id: str | None = None) -> FileUploadResult | None:
        """Return metadata, or None when missing. No tenant filter is for trusted internal IDs only."""
        ...

    def delete(self, *, file: FileUploadResult) -> None:
        """Delete the exact metadata record after its stored content has been removed."""
        ...


class FileStorage(Protocol):
    def load_once(self, filename: str) -> bytes: ...

    def load_stream(self, filename: str) -> Generator[bytes, None, None]: ...

    def delete(self, filename: str) -> None: ...

    def generate_presigned_url(self, filename: str, *, expires_in: int, content_type: str | None = None) -> str: ...


class FileTextExtractor(Protocol):
    def __call__(self, *, file: FileUploadResult) -> str: ...


@dataclass(frozen=True, slots=True)
class FileArchiveEntry:
    name: str
    key: str


class FileService:
    def __init__(
        self,
        *,
        files: FileRepository,
        storage: FileStorage,
        storage_type: str,
        extract_text: FileTextExtractor,
        sign_file_url: FileUploadUrlSigner,
    ) -> None:
        self._files: FileRepository = files
        self._storage: FileStorage = storage
        self._storage_type: str = storage_type
        self._extract_text: FileTextExtractor = extract_text
        self._sign_file_url: FileUploadUrlSigner = sign_file_url

    def _get_file(self, *, file_id: str, tenant_id: str | None = None) -> FileUploadResult:
        file = self._files.get(file_id=file_id, tenant_id=tenant_id)
        if file is None:
            raise FileNotExistsError("File not found")
        return file

    def get_file_base64(self, file_id: str) -> str:
        file = self._get_file(file_id=file_id)
        return base64.b64encode(self._storage.load_once(file.key)).decode()

    def get_file_presigned_url(self, *, file_id: str, tenant_id: str) -> str:
        """Generate a direct storage URL for a tenant-owned upload file."""
        file = self._get_file(file_id=file_id, tenant_id=tenant_id)
        return self._storage.generate_presigned_url(
            file.key, expires_in=dify_config.FILES_ACCESS_TIMEOUT, content_type=file.mime_type
        )

    def get_icon_url(self, file_id: str, tenant_id: str) -> str:
        try:
            if dify_config.DEPLOYMENT_EDITION == DeploymentEdition.CLOUD and self._storage_type == "s3":
                return self.get_file_presigned_url(file_id=file_id, tenant_id=tenant_id)
            self._get_file(file_id=file_id, tenant_id=tenant_id)
        except FileNotExistsError as exc:
            raise FileNotExistsError("File reference not found") from exc
        return self._sign_file_url(upload_file_id=file_id)

    def get_file_preview(self, file_id: str, tenant_id: str) -> str:
        """Return a short text preview extracted after the metadata query has closed."""
        file = self._get_file(file_id=file_id, tenant_id=tenant_id)
        if file.extension.lower() not in DOCUMENT_EXTENSIONS:
            raise UnsupportedFileTypeError()
        text = self._extract_text(file=file)
        return text[:PREVIEW_WORDS_LIMIT] if text else ""

    def get_file_content(self, file_id: str) -> str:
        file = self._get_file(file_id=file_id)
        return self._storage.load_once(file.key).decode("utf-8")

    def delete_file(self, file_id: str) -> None:
        file = self._files.get(file_id=file_id)
        if file is None:
            return
        # Storage failure leaves metadata intact. No database transaction spans storage I/O.
        self._storage.delete(file.key)
        self._files.delete(file=file)

    @staticmethod
    def _sanitize_zip_entry_name(name: str) -> str:
        """
        Sanitize a ZIP entry name to avoid path traversal and weird separators.

        We keep this conservative: the upload flow already rejects `/` and `\\`, but older rows (or imported data)
        could still contain unsafe names.
        """
        # ZIP entry paths use forward slashes on every host platform.
        base = posixpath.basename(name).strip() or "file"

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

    @contextmanager
    def build_upload_files_zip_tempfile(
        self, *, upload_files: Sequence[FileArchiveEntry]
    ) -> Generator[str, None, None]:
        """
        Build a ZIP from file names and storage keys and yield a tempfile path.

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
                        with (
                            zf.open(arcname, "w") as entry,
                            closing(self._storage.load_stream(upload_file.key)) as chunks,
                        ):
                            for chunk in chunks:
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
