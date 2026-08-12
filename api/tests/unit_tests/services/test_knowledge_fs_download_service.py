from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from zipfile import ZipFile

import pytest

from services.knowledge_fs.download_service import (
    KNOWLEDGE_FS_BATCH_DOWNLOAD_MAX_BYTES,
    KnowledgeFSDownloadObjectNotFoundError,
    KnowledgeFSDownloadService,
    KnowledgeFSDownloadTooLargeError,
    KnowledgeFSDownloadUnavailableError,
)
from services.knowledge_fs.object_storage import (
    KnowledgeFSObjectStorageCorruptError,
    KnowledgeFSObjectStorageUnavailableError,
)
from services.knowledge_fs.product_dto import KnowledgeFSDocumentDownloadDescriptor


class FakeObjectStorage:
    def __init__(self, objects: dict[str, bytes]) -> None:
        self.objects = objects

    def head_object(self, *, key: str):
        body = self.objects.get(key)
        return None if body is None else SimpleNamespace(size_bytes=len(body))

    def load_stream(self, *, key: str):
        body = self.objects.get(key)
        return None if body is None else iter((body[:2], body[2:]))


def descriptor(*, document_id: str, filename: str, object_key: str, size_bytes: int):
    return KnowledgeFSDocumentDownloadDescriptor(
        document_id=document_id,
        filename=filename,
        mime_type="text/plain",
        object_key=object_key,
        sha256="a" * 64,
        size_bytes=size_bytes,
    )


def test_load_stream_returns_storage_chunks() -> None:
    service = KnowledgeFSDownloadService(object_storage=FakeObjectStorage({"object-1": b"body"}))

    result = service.load_stream(
        descriptor(document_id="document-1", filename="a.txt", object_key="object-1", size_bytes=4)
    )

    assert b"".join(result) == b"body"


def test_load_stream_rejects_missing_or_changed_object() -> None:
    service = KnowledgeFSDownloadService(object_storage=FakeObjectStorage({"object-1": b"body"}))

    with pytest.raises(KnowledgeFSDownloadObjectNotFoundError):
        service.load_stream(descriptor(document_id="document-1", filename="a.txt", object_key="object-1", size_bytes=5))


@pytest.mark.parametrize(
    ("storage_error", "expected_error"),
    [
        (
            KnowledgeFSObjectStorageCorruptError("object body is missing"),
            KnowledgeFSDownloadObjectNotFoundError,
        ),
        (
            KnowledgeFSObjectStorageUnavailableError("storage is unavailable"),
            KnowledgeFSDownloadUnavailableError,
        ),
    ],
)
def test_load_stream_translates_object_storage_errors(
    storage_error: Exception,
    expected_error: type[Exception],
) -> None:
    object_storage = SimpleNamespace(
        head_object=lambda **_: (_ for _ in ()).throw(storage_error),
    )
    service = KnowledgeFSDownloadService(object_storage=object_storage)

    with pytest.raises(expected_error):
        service.load_stream(descriptor(document_id="document-1", filename="a.txt", object_key="object-1", size_bytes=4))


def test_build_zip_streams_objects_and_deduplicates_names() -> None:
    service = KnowledgeFSDownloadService(
        object_storage=FakeObjectStorage({"object-1": b"first", "object-2": b"second"})
    )
    descriptors = [
        descriptor(document_id="document-1", filename="same.txt", object_key="object-1", size_bytes=5),
        descriptor(document_id="document-2", filename="same.txt", object_key="object-2", size_bytes=6),
    ]

    with service.build_zip_tempfile(descriptors) as zip_path:
        assert Path(zip_path).exists()
        with ZipFile(zip_path) as archive:
            assert archive.namelist() == ["same.txt", "same (1).txt"]
            assert archive.read("same.txt") == b"first"
            assert archive.read("same (1).txt") == b"second"
    assert not Path(zip_path).exists()


def test_build_zip_rejects_oversized_batch_before_storage_reads() -> None:
    service = KnowledgeFSDownloadService(object_storage=FakeObjectStorage({}))

    with pytest.raises(KnowledgeFSDownloadTooLargeError):
        with service.build_zip_tempfile(
            [
                descriptor(
                    document_id="document-1",
                    filename="large.bin",
                    object_key="object-1",
                    size_bytes=KNOWLEDGE_FS_BATCH_DOWNLOAD_MAX_BYTES + 1,
                )
            ]
        ):
            pass
