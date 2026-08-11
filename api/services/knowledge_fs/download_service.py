"""Download preparation for authorized KnowledgeFS object descriptors."""

from __future__ import annotations

import os
from collections.abc import Generator, Sequence
from contextlib import contextmanager, suppress
from tempfile import NamedTemporaryFile
from zipfile import ZIP_DEFLATED, ZipFile

from services.file_service import FileService
from services.knowledge_fs.object_storage import KnowledgeFSObjectStorageService
from services.knowledge_fs.product_dto import KnowledgeFSDocumentDownloadDescriptor

KNOWLEDGE_FS_BATCH_DOWNLOAD_MAX_BYTES = 500 * 1024 * 1024


class KnowledgeFSDownloadTooLargeError(ValueError):
    pass


class KnowledgeFSDownloadObjectNotFoundError(FileNotFoundError):
    pass


class KnowledgeFSDownloadService:
    def __init__(self, *, object_storage: KnowledgeFSObjectStorageService | None = None) -> None:
        self._object_storage = object_storage or KnowledgeFSObjectStorageService()

    def load_stream(self, descriptor: KnowledgeFSDocumentDownloadDescriptor) -> Generator[bytes, None, None]:
        metadata = self._object_storage.head_object(key=descriptor.object_key)
        if metadata is None or metadata.size_bytes != descriptor.size_bytes:
            raise KnowledgeFSDownloadObjectNotFoundError(descriptor.document_id)
        stream = self._object_storage.load_stream(key=descriptor.object_key)
        if stream is None:
            raise KnowledgeFSDownloadObjectNotFoundError(descriptor.document_id)
        return stream

    @contextmanager
    def build_zip_tempfile(
        self, descriptors: Sequence[KnowledgeFSDocumentDownloadDescriptor]
    ) -> Generator[str, None, None]:
        total_size = sum(item.size_bytes for item in descriptors)
        if total_size > KNOWLEDGE_FS_BATCH_DOWNLOAD_MAX_BYTES:
            raise KnowledgeFSDownloadTooLargeError("KnowledgeFS batch download exceeds the size limit")

        used_names: set[str] = set()
        tmp_path: str | None = None
        try:
            with NamedTemporaryFile(mode="w+b", suffix=".zip", delete=False) as tmp:
                tmp_path = tmp.name
                with ZipFile(tmp, mode="w", compression=ZIP_DEFLATED) as archive:
                    for descriptor in descriptors:
                        safe_name = FileService._sanitize_zip_entry_name(descriptor.filename)
                        entry_name = FileService._dedupe_zip_entry_name(safe_name, used_names)
                        used_names.add(entry_name)
                        with archive.open(entry_name, "w") as entry:
                            for chunk in self.load_stream(descriptor):
                                entry.write(chunk)
                tmp.flush()
            assert tmp_path is not None
            yield tmp_path
        finally:
            if tmp_path is not None:
                with suppress(FileNotFoundError):
                    os.remove(tmp_path)
