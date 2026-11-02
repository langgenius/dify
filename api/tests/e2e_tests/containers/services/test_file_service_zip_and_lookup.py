"""
Testcontainers integration tests for FileService helpers.

Covers:
- ZIP tempfile building (sanitization + deduplication + content writes)
- tenant-scoped batch lookup behavior (get_upload_files_by_ids)
"""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass, field
from datetime import UTC, datetime
from uuid import uuid4
from zipfile import ZipFile

import pytest
from sqlalchemy.orm import Session, sessionmaker

from enums.creator import CreatorUserRole
from extensions.storage.storage_type import StorageType
from models.model import UploadFile
from services import file_adapters
from services.entities.upload_file import UploadFileRecord
from services.file_adapters import build_file_service
from services.file_service import FileService


@dataclass
class _ArchiveStorage:
    content: dict[str, bytes]
    loaded: list[str] = field(default_factory=list)

    def save(self, filename: str, data: bytes) -> None:
        self.content[filename] = data

    def load_once(self, filename: str) -> bytes:
        return self.content[filename]

    def load_stream(self, filename: str) -> Iterator[bytes]:
        self.loaded.append(filename)
        return iter((self.content[filename],))

    def generate_presigned_url(self, filename: str, *, expires_in: int, content_type: str | None = None) -> str:
        del expires_in, content_type
        return filename

    def delete(self, filename: str) -> None:
        self.content.pop(filename, None)


def _build_service(
    session: Session,
    monkeypatch: pytest.MonkeyPatch | None = None,
    storage: _ArchiveStorage | None = None,
) -> FileService:
    if monkeypatch is not None and storage is not None:
        monkeypatch.setattr(file_adapters, "storage", storage)
    return build_file_service(session_factory=sessionmaker(bind=session.get_bind(), expire_on_commit=False))


def _create_upload_file(db_session: Session, *, tenant_id: str, key: str, name: str) -> UploadFile:
    upload_file = UploadFile(
        tenant_id=tenant_id,
        storage_type=StorageType.OPENDAL,
        key=key,
        name=name,
        size=100,
        extension="txt",
        mime_type="text/plain",
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by=str(uuid4()),
        created_at=datetime.now(UTC),
        used=False,
    )
    db_session.add(upload_file)
    db_session.commit()
    return upload_file


def test_build_upload_files_zip_tempfile_sanitizes_and_dedupes_names(
    monkeypatch: pytest.MonkeyPatch,
    db_session_with_containers: Session,
) -> None:
    """Ensure ZIP entry names are safe and unique while preserving extensions."""
    tenant_id = str(uuid4())
    upload_files = [
        _create_upload_file(db_session_with_containers, tenant_id=tenant_id, key="k1", name="a/b.txt"),
        _create_upload_file(db_session_with_containers, tenant_id=tenant_id, key="k2", name="c/b.txt"),
        _create_upload_file(db_session_with_containers, tenant_id=tenant_id, key="k3", name="../b.txt"),
    ]
    storage = _ArchiveStorage({"k1": b"one", "k2": b"two", "k3": b"three"})
    service = _build_service(db_session_with_containers, monkeypatch, storage)
    persisted = service.get_files(tenant_id=tenant_id, file_ids=[file.id for file in upload_files])
    records: list[UploadFileRecord] = [persisted[file.id] for file in upload_files]

    with service.build_upload_files_zip_tempfile(upload_files=records) as tmp:
        with ZipFile(tmp, mode="r") as zf:
            assert zf.namelist() == ["b.txt", "b (1).txt", "b (2).txt"]
            assert zf.read("b.txt") == b"one"
            assert zf.read("b (1).txt") == b"two"
            assert zf.read("b (2).txt") == b"three"
    assert storage.loaded == ["k1", "k2", "k3"]


def test_get_upload_files_by_ids_returns_empty_when_no_ids(db_session_with_containers: Session) -> None:
    """Ensure empty input returns an empty mapping without hitting the database."""
    assert _build_service(db_session_with_containers).get_files(tenant_id=str(uuid4()), file_ids=[]) == {}


def test_get_upload_files_by_ids_returns_id_keyed_mapping(db_session_with_containers: Session) -> None:
    """Ensure batch lookup returns a dict keyed by stringified UploadFile ids."""
    tenant_id = str(uuid4())
    file1 = _create_upload_file(db_session_with_containers, tenant_id=tenant_id, key="k1", name="file1.txt")
    file2 = _create_upload_file(db_session_with_containers, tenant_id=tenant_id, key="k2", name="file2.txt")

    result = _build_service(db_session_with_containers).get_files(
        tenant_id=tenant_id,
        file_ids=[file1.id, file1.id, file2.id],
    )

    assert set(result.keys()) == {file1.id, file2.id}
    assert result[file1.id].id == file1.id
    assert result[file2.id].id == file2.id


def test_get_upload_files_by_ids_filters_by_tenant(db_session_with_containers: Session) -> None:
    """Ensure files from other tenants are not returned."""
    tenant_a = str(uuid4())
    tenant_b = str(uuid4())
    file_a = _create_upload_file(db_session_with_containers, tenant_id=tenant_a, key="ka", name="a.txt")
    _create_upload_file(db_session_with_containers, tenant_id=tenant_b, key="kb", name="b.txt")

    result = _build_service(db_session_with_containers).get_files(tenant_id=tenant_a, file_ids=[file_a.id])

    assert set(result.keys()) == {file_a.id}
