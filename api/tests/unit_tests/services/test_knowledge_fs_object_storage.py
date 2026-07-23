from __future__ import annotations

from base64 import b64encode
from collections.abc import Generator
from hashlib import sha256
from pathlib import Path

import pytest

from extensions.storage.opendal_storage import OpenDALStorage
from services.knowledge_fs.object_storage import (
    KnowledgeFSObjectStorageChecksumError,
    KnowledgeFSObjectStorageInvalidInputError,
    KnowledgeFSObjectStorageService,
    KnowledgeFSObjectStorageUnavailableError,
)


class FakeStorage:
    objects: dict[str, bytes]
    scan_supported: bool

    def __init__(self, *, scan_supported: bool = True) -> None:
        self.objects = {}
        self.scan_supported = scan_supported

    def save(self, filename: str, data: bytes) -> None:
        self.objects[filename] = bytes(data)

    def load_once(self, filename: str) -> bytes:
        try:
            return self.objects[filename]
        except KeyError as exc:
            raise FileNotFoundError("missing") from exc

    def load_stream(self, filename: str) -> Generator[bytes, None, None]:
        yield self.load_once(filename)

    def exists(self, filename: str) -> bool:
        return filename in self.objects

    def delete(self, filename: str) -> None:
        self.objects.pop(filename, None)

    def scan(self, path: str, files: bool = True, directories: bool = False) -> list[str]:
        if not self.scan_supported:
            raise NotImplementedError("scan unsupported")
        return sorted(key for key in self.objects if key.startswith(path))


def test_round_trips_metadata_streams_lists_and_deletes_objects() -> None:
    backend = FakeStorage()
    service = KnowledgeFSObjectStorageService(backend=backend)
    body = b"knowledge-fs"
    checksum = b64encode(sha256(body).digest()).decode()

    stored = service.put_object(
        key="tenant-1/spaces/space-1/documents/doc-1/file.txt",
        body=body,
        checksum_sha256_base64=checksum,
        content_type="text/plain",
        metadata={"assetId": "doc-1", "tenantId": "tenant-1"},
    )

    assert stored.key == "tenant-1/spaces/space-1/documents/doc-1/file.txt"
    assert stored.size_bytes == len(body)
    assert stored.checksum_sha256_base64 == checksum
    assert stored.content_type == "text/plain"
    assert stored.metadata == {"assetId": "doc-1", "tenantId": "tenant-1"}
    assert service.head_object(key=stored.key) == stored
    assert b"".join(service.load_stream(key=stored.key) or ()) == body

    listed = service.list_objects(prefix="tenant-1/spaces/space-1/", limit=10)
    assert listed.objects == (stored,)
    assert listed.next_cursor is None

    service.delete_object(key=stored.key)
    assert service.head_object(key=stored.key) is None
    assert service.load_stream(key=stored.key) is None


def test_list_uses_lexical_cursor_without_exposing_physical_storage_paths() -> None:
    service = KnowledgeFSObjectStorageService(backend=FakeStorage())
    for name in ("a.txt", "b.txt", "c.txt"):
        service.put_object(
            key=f"tenant-1/spaces/space-1/{name}",
            body=name.encode(),
            content_type="text/plain",
            metadata={},
        )

    first = service.list_objects(prefix="tenant-1/spaces/space-1/", limit=2)
    assert [item.key for item in first.objects] == [
        "tenant-1/spaces/space-1/a.txt",
        "tenant-1/spaces/space-1/b.txt",
    ]
    assert first.next_cursor == "tenant-1/spaces/space-1/b.txt"

    second = service.list_objects(
        prefix="tenant-1/spaces/space-1/",
        cursor=first.next_cursor,
        limit=2,
    )
    assert [item.key for item in second.objects] == ["tenant-1/spaces/space-1/c.txt"]
    assert second.next_cursor is None


def test_rejects_checksum_mismatch_and_path_traversal() -> None:
    service = KnowledgeFSObjectStorageService(backend=FakeStorage())

    with pytest.raises(KnowledgeFSObjectStorageChecksumError):
        service.put_object(
            key="tenant-1/file.txt",
            body=b"body",
            checksum_sha256_base64=b64encode(bytes(32)).decode(),
            metadata={},
        )

    with pytest.raises(KnowledgeFSObjectStorageInvalidInputError):
        service.put_object(key="../dify-secret", body=b"body", metadata={})


def test_fails_health_and_listing_when_unified_backend_cannot_scan() -> None:
    service = KnowledgeFSObjectStorageService(backend=FakeStorage(scan_supported=False))

    assert service.health() is False
    with pytest.raises(KnowledgeFSObjectStorageUnavailableError):
        service.list_objects(prefix="tenant-1/", limit=10)


def test_round_trips_through_dify_default_opendal_filesystem(tmp_path: Path) -> None:
    service = KnowledgeFSObjectStorageService(backend=OpenDALStorage(scheme="fs", root=str(tmp_path)))

    stored = service.put_object(
        key="tenant-1/spaces/space-1/file.txt",
        body=b"data",
        metadata={"tenantId": "tenant-1"},
    )

    assert service.head_object(key=stored.key) == stored
    assert service.list_objects(prefix="tenant-1/spaces/space-1/", limit=10).objects == (stored,)
    assert service.health() is True
