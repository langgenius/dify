"""
Testcontainers integration tests for FileService helpers.

Covers:
- ZIP tempfile building (sanitization + deduplication + content writes)
- tenant-scoped batch lookup behavior (get_upload_files_by_ids)
"""

from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Any
from uuid import uuid4
from zipfile import ZipFile

import pytest

import services.file_service as file_service_module
from extensions.storage.storage_type import StorageType
from models.enums import CreatorUserRole
from models.model import UploadFile
from services.file_service import FileService


def _create_upload_file(db_session, *, tenant_id: str, key: str, name: str) -> UploadFile:
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


def test_build_upload_files_zip_tempfile_sanitizes_and_dedupes_names(monkeypatch: pytest.MonkeyPatch) -> None:
    """Ensure ZIP entry names are safe and unique while preserving extensions."""
    upload_files: list[Any] = [
        SimpleNamespace(name="a/b.txt", key="k1"),
        SimpleNamespace(name="c/b.txt", key="k2"),
        SimpleNamespace(name="../b.txt", key="k3"),
    ]

    data_by_key: dict[str, list[bytes]] = {"k1": [b"one"], "k2": [b"two"], "k3": [b"three"]}

    def _load(key: str, stream: bool = True) -> list[bytes]:
        assert stream is True
        return data_by_key[key]

    monkeypatch.setattr(file_service_module.storage, "load", _load)

    with FileService.build_upload_files_zip_tempfile(upload_files=upload_files) as tmp:
        with ZipFile(tmp, mode="r") as zf:
            assert zf.namelist() == ["b.txt", "b (1).txt", "b (2).txt"]
            assert zf.read("b.txt") == b"one"
            assert zf.read("b (1).txt") == b"two"
            assert zf.read("b (2).txt") == b"three"


def test_get_upload_files_by_ids_returns_empty_when_no_ids(db_session_with_containers) -> None:
    """Ensure empty input returns an empty mapping without hitting the database."""
    assert FileService.get_upload_files_by_ids(str(uuid4()), []) == {}


def test_get_upload_files_by_ids_returns_id_keyed_mapping(db_session_with_containers) -> None:
    """Ensure batch lookup returns a dict keyed by stringified UploadFile ids."""
    tenant_id = str(uuid4())
    file1 = _create_upload_file(db_session_with_containers, tenant_id=tenant_id, key="k1", name="file1.txt")
    file2 = _create_upload_file(db_session_with_containers, tenant_id=tenant_id, key="k2", name="file2.txt")

    result = FileService.get_upload_files_by_ids(tenant_id, [file1.id, file1.id, file2.id])

    assert set(result.keys()) == {file1.id, file2.id}
    assert result[file1.id].id == file1.id
    assert result[file2.id].id == file2.id


def test_get_upload_files_by_ids_filters_by_tenant(db_session_with_containers) -> None:
    """Ensure files from other tenants are not returned."""
    tenant_a = str(uuid4())
    tenant_b = str(uuid4())
    file_a = _create_upload_file(db_session_with_containers, tenant_id=tenant_a, key="ka", name="a.txt")
    _create_upload_file(db_session_with_containers, tenant_id=tenant_b, key="kb", name="b.txt")

    result = FileService.get_upload_files_by_ids(tenant_a, [file_a.id])

    assert set(result.keys()) == {file_a.id}
