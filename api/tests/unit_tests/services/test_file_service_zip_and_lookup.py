"""
Unit tests for `services.file_service.FileService` helpers.

We keep these tests focused on:
- ZIP tempfile building (sanitization + deduplication + content writes)
- tenant-scoped batch lookup behavior (`get_upload_files_by_ids`)
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any
from zipfile import ZipFile

import pytest

import services.file_service as file_service_module
from services.file_service import FileService


def test_build_upload_files_zip_tempfile_sanitizes_and_dedupes_names(monkeypatch: pytest.MonkeyPatch) -> None:
    """Ensure ZIP entry names are safe and unique while preserving extensions."""

    # Arrange: three upload files that all sanitize down to the same basename ("b.txt").
    upload_files: list[Any] = [
        SimpleNamespace(name="a/b.txt", key="k1"),
        SimpleNamespace(name="c/b.txt", key="k2"),
        SimpleNamespace(name="../b.txt", key="k3"),
    ]

    # Stream distinct bytes per key so we can verify content is written to the right entry.
    data_by_key: dict[str, list[bytes]] = {"k1": [b"one"], "k2": [b"two"], "k3": [b"three"]}

    def _load(key: str, stream: bool = True) -> list[bytes]:
        # Return the corresponding chunks for this key (the production code iterates chunks).
        assert stream is True
        return data_by_key[key]

    monkeypatch.setattr(file_service_module.storage, "load", _load)

    # Act: build zip in a tempfile.
    with FileService.build_upload_files_zip_tempfile(upload_files=upload_files) as tmp:
        with ZipFile(tmp, mode="r") as zf:
            # Assert: names are sanitized (no directory components) and deduped with suffixes.
            assert zf.namelist() == ["b.txt", "b (1).txt", "b (2).txt"]

            # Assert: each entry contains the correct bytes from storage.
            assert zf.read("b.txt") == b"one"
            assert zf.read("b (1).txt") == b"two"
            assert zf.read("b (2).txt") == b"three"


def test_get_upload_files_by_ids_returns_empty_when_no_ids(monkeypatch: pytest.MonkeyPatch) -> None:
    """Ensure empty input returns an empty mapping without hitting the database."""

    class _Session:
        def scalars(self, _stmt):  # type: ignore[no-untyped-def]
            raise AssertionError("db.session.scalars should not be called for empty id lists")

    monkeypatch.setattr(file_service_module, "db", SimpleNamespace(session=_Session()))

    assert FileService.get_upload_files_by_ids("tenant-1", []) == {}


def test_get_upload_files_by_ids_returns_id_keyed_mapping(monkeypatch: pytest.MonkeyPatch) -> None:
    """Ensure batch lookup returns a dict keyed by stringified UploadFile ids."""

    upload_files: list[Any] = [
        SimpleNamespace(id="file-1", tenant_id="tenant-1"),
        SimpleNamespace(id="file-2", tenant_id="tenant-1"),
    ]

    class _ScalarResult:
        def __init__(self, items: list[Any]) -> None:
            self._items = items

        def all(self) -> list[Any]:
            return self._items

    class _Session:
        def __init__(self, items: list[Any]) -> None:
            self._items = items
            self.calls: list[object] = []

        def scalars(self, stmt):  # type: ignore[no-untyped-def]
            # Capture the statement so we can at least assert the query path is taken.
            self.calls.append(stmt)
            return _ScalarResult(self._items)

    session = _Session(upload_files)
    monkeypatch.setattr(file_service_module, "db", SimpleNamespace(session=session))

    # Provide duplicates to ensure callers can safely pass repeated ids.
    result = FileService.get_upload_files_by_ids("tenant-1", ["file-1", "file-1", "file-2"])

    assert set(result.keys()) == {"file-1", "file-2"}
    assert result["file-1"].id == "file-1"
    assert result["file-2"].id == "file-2"
    assert len(session.calls) == 1
