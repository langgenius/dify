"""
Unit tests for the dataset document download endpoint.

These tests validate that the controller returns a signed download URL for
upload-file documents, and rejects unsupported or missing file cases.
"""

from __future__ import annotations

import importlib
import json
import sys
from collections import UserDict
from datetime import UTC, datetime
from inspect import unwrap
from io import BytesIO
from zipfile import ZipFile

import pytest
from flask import Flask
from sqlalchemy.orm import Session
from werkzeug.exceptions import NotFound

from extensions.storage.storage_type import StorageType
from models.account import Account, TenantAccountRole
from models.dataset import Dataset, Document
from models.enums import CreatorUserRole
from models.model import UploadFile


@pytest.fixture
def app() -> Flask:
    """Create a minimal Flask app for request-context based controller tests."""
    app = Flask(__name__)
    app.config["TESTING"] = True
    return app


@pytest.fixture
def datasets_document_module(monkeypatch: pytest.MonkeyPatch):
    """
    Reload `controllers.console.datasets.datasets_document` with lightweight decorators.

    We patch auth / setup / rate-limit decorators to no-ops so we can unit test the
    controller logic without requiring the full console stack.
    """

    from controllers.console import console_ns, wraps
    from libs import login

    def _noop(func):  # type: ignore[no-untyped-def]
        return func

    # Bypass login/setup/account checks in unit tests.
    monkeypatch.setattr(login, "login_required", _noop)
    monkeypatch.setattr(wraps, "setup_required", _noop)
    monkeypatch.setattr(wraps, "account_initialization_required", _noop)

    # Bypass billing-related decorators used by other endpoints in this module.
    monkeypatch.setattr(wraps, "cloud_edition_billing_resource_check", lambda *_args, **_kwargs: lambda f: f)
    monkeypatch.setattr(wraps, "cloud_edition_billing_rate_limit_check", lambda *_args, **_kwargs: lambda f: f)

    # Avoid Flask-RESTX route registration side effects during import.
    def _noop_route(*_args, **_kwargs):  # type: ignore[override]
        def _decorator(cls):
            return cls

        return _decorator

    monkeypatch.setattr(console_ns, "route", _noop_route)

    module_name = "controllers.console.datasets.datasets_document"
    sys.modules.pop(module_name, None)
    return importlib.import_module(module_name)


def _account(*, is_dataset_editor: bool = True) -> Account:
    """Build a real account with the role used by dataset permission checks."""
    account = Account(name="Dataset User", email="dataset-user@example.com")
    account.id = "user-123"
    account.role = TenantAccountRole.EDITOR if is_dataset_editor else TenantAccountRole.NORMAL
    return account


def _document(
    *,
    document_id: str,
    tenant_id: str,
    data_source_type: str,
    upload_file_id: str | None,
) -> Document:
    """Build a real document entity used by the controller."""
    document = Document(
        id=document_id,
        tenant_id=tenant_id,
        dataset_id="ds-1",
        position=1,
        data_source_type=data_source_type,
        data_source_info=json.dumps({"upload_file_id": upload_file_id}) if upload_file_id is not None else "{}",
        batch="batch-1",
        name="document.txt",
        created_from="web",
        created_by="user-123",
    )
    return document


def _dataset() -> Dataset:
    return Dataset(id="ds-1", tenant_id="tenant-123", name="Dataset", created_by="user-123")


def _upload_file(*, file_id: str, name: str = "document.txt", key: str = "key") -> UploadFile:
    upload_file = UploadFile(
        tenant_id="tenant-123",
        storage_type=StorageType.LOCAL,
        key=key,
        name=name,
        size=1,
        extension="txt",
        mime_type="text/plain",
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by="user-123",
        created_at=datetime.now(UTC),
        used=False,
    )
    upload_file.id = file_id
    return upload_file


def _wire_common_success_mocks(
    *,
    module,
    monkeypatch: pytest.MonkeyPatch,
    document_tenant_id: str,
    data_source_type: str,
    upload_file_id: str | None,
    upload_file_exists: bool,
    signed_url: str,
) -> None:
    """Patch controller dependencies to create a deterministic test environment."""
    import services.dataset_service as dataset_service_module

    # Return a dataset object and allow permission checks to pass.
    monkeypatch.setattr(
        module.DatasetService,
        "get_dataset_for_tenant",
        lambda *_args, **_kwargs: _dataset(),
    )
    monkeypatch.setattr(module.DatasetService, "check_dataset_permission", lambda *_args, **_kwargs: None)

    # Return a document that will be validated inside DocumentResource.get_document.
    document = _document(
        document_id="doc-1",
        tenant_id=document_tenant_id,
        data_source_type=data_source_type,
        upload_file_id=upload_file_id,
    )
    monkeypatch.setattr(
        module.DatasetRefService,
        "get_document_by_ref",
        lambda *_args, **_kwargs: document if document.tenant_id == "tenant-123" else None,
    )

    # Mock UploadFile lookup via FileService batch helper.
    upload_files_by_id: dict[str, object] = {}
    if upload_file_exists and upload_file_id is not None:
        upload_files_by_id[upload_file_id] = _upload_file(file_id=upload_file_id)
    monkeypatch.setattr(module.FileService, "get_upload_files_by_ids", lambda *_args, **_kwargs: upload_files_by_id)

    # Mock signing helper so the returned URL is deterministic.
    monkeypatch.setattr(dataset_service_module.file_helpers, "get_signed_file_url", lambda **_kwargs: signed_url)


def _mock_send_file(obj, **kwargs):  # type: ignore[no-untyped-def]
    """Return a lightweight representation of `send_file(...)` for unit tests."""

    class _ResponseMock(UserDict):
        def __init__(self, sent_file: object, send_file_kwargs: dict[str, object]) -> None:
            super().__init__({"_sent_file": sent_file, "_send_file_kwargs": send_file_kwargs})
            self._on_close: object | None = None

        def call_on_close(self, func):  # type: ignore[no-untyped-def]
            self._on_close = func
            return func

    return _ResponseMock(obj, kwargs)


def test_batch_download_zip_returns_send_file(
    app: Flask, datasets_document_module, monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    """Ensure batch ZIP download returns a zip attachment via `send_file`."""

    monkeypatch.setattr(datasets_document_module.DatasetService, "get_dataset", lambda *_args, **_kwargs: _dataset())
    monkeypatch.setattr(
        datasets_document_module.DatasetService, "check_dataset_permission", lambda *_args, **_kwargs: None
    )

    # Two upload-file documents, each referencing an UploadFile.
    doc1 = _document(
        document_id="11111111-1111-1111-1111-111111111111",
        tenant_id="tenant-123",
        data_source_type="upload_file",
        upload_file_id="file-1",
    )
    doc2 = _document(
        document_id="22222222-2222-2222-2222-222222222222",
        tenant_id="tenant-123",
        data_source_type="upload_file",
        upload_file_id="file-2",
    )
    monkeypatch.setattr(
        datasets_document_module.DocumentService,
        "get_documents_by_ids",
        lambda *_args, **_kwargs: [doc1, doc2],
    )
    monkeypatch.setattr(
        datasets_document_module.FileService,
        "get_upload_files_by_ids",
        lambda *_args, **_kwargs: {
            "file-1": _upload_file(file_id="file-1", name="a.txt", key="k1"),
            "file-2": _upload_file(file_id="file-2", name="b.txt", key="k2"),
        },
    )

    # Mock storage streaming content.
    import services.file_service as file_service_module

    monkeypatch.setattr(file_service_module.storage, "load", lambda _key, stream=True: [b"hello"])

    # Replace send_file used by the controller to avoid a real Flask response object.
    monkeypatch.setattr(datasets_document_module, "send_file", _mock_send_file)

    # Act
    with app.test_request_context(
        "/datasets/ds-1/documents/download-zip",
        method="POST",
        json={"document_ids": ["11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222"]},
    ):
        api = datasets_document_module.DocumentBatchDownloadZipApi()
        method = unwrap(api.post)
        result = method(api, sqlite_session, "tenant-123", _account(), dataset_id="ds-1")

    # Assert: we returned via send_file with correct mime type and attachment.
    assert result["_send_file_kwargs"]["mimetype"] == "application/zip"
    assert result["_send_file_kwargs"]["as_attachment"] is True
    assert isinstance(result["_send_file_kwargs"]["download_name"], str)
    assert result["_send_file_kwargs"]["download_name"].endswith(".zip")
    # Ensure our cleanup hook is registered and execute it to avoid temp file leaks in unit tests.
    assert getattr(result, "_on_close", None) is not None
    result._on_close()  # type: ignore[attr-defined]


def test_batch_download_zip_response_is_openable_zip(
    app: Flask, datasets_document_module, monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    """Ensure the real Flask `send_file` response body is a valid ZIP that can be opened."""

    # Arrange: same controller mocks as the lightweight send_file test, but we keep the real `send_file`.
    monkeypatch.setattr(datasets_document_module.DatasetService, "get_dataset", lambda *_args, **_kwargs: _dataset())
    monkeypatch.setattr(
        datasets_document_module.DatasetService, "check_dataset_permission", lambda *_args, **_kwargs: None
    )

    doc1 = _document(
        document_id="33333333-3333-3333-3333-333333333333",
        tenant_id="tenant-123",
        data_source_type="upload_file",
        upload_file_id="file-1",
    )
    doc2 = _document(
        document_id="44444444-4444-4444-4444-444444444444",
        tenant_id="tenant-123",
        data_source_type="upload_file",
        upload_file_id="file-2",
    )
    monkeypatch.setattr(
        datasets_document_module.DocumentService,
        "get_documents_by_ids",
        lambda *_args, **_kwargs: [doc1, doc2],
    )
    monkeypatch.setattr(
        datasets_document_module.FileService,
        "get_upload_files_by_ids",
        lambda *_args, **_kwargs: {
            "file-1": _upload_file(file_id="file-1", name="a.txt", key="k1"),
            "file-2": _upload_file(file_id="file-2", name="b.txt", key="k2"),
        },
    )

    # Stream distinct bytes per key so we can verify both ZIP entries.
    import services.file_service as file_service_module

    monkeypatch.setattr(
        file_service_module.storage, "load", lambda key, stream=True: [b"one"] if key == "k1" else [b"two"]
    )

    # Act
    with app.test_request_context(
        "/datasets/ds-1/documents/download-zip",
        method="POST",
        json={"document_ids": ["33333333-3333-3333-3333-333333333333", "44444444-4444-4444-4444-444444444444"]},
    ):
        api = datasets_document_module.DocumentBatchDownloadZipApi()
        method = unwrap(api.post)
        response = method(api, sqlite_session, "tenant-123", _account(), dataset_id="ds-1")

    # Assert: response body is a valid ZIP and contains the expected entries.
    response.direct_passthrough = False
    data = response.get_data()
    response.close()

    with ZipFile(BytesIO(data), mode="r") as zf:
        assert zf.namelist() == ["a.txt", "b.txt"]
        assert zf.read("a.txt") == b"one"
        assert zf.read("b.txt") == b"two"


def test_batch_download_zip_rejects_non_upload_file_document(
    app: Flask, datasets_document_module, monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    """Ensure batch ZIP download rejects non upload-file documents."""

    monkeypatch.setattr(datasets_document_module.DatasetService, "get_dataset", lambda *_args, **_kwargs: _dataset())
    monkeypatch.setattr(
        datasets_document_module.DatasetService, "check_dataset_permission", lambda *_args, **_kwargs: None
    )

    doc = _document(
        document_id="55555555-5555-5555-5555-555555555555",
        tenant_id="tenant-123",
        data_source_type="website_crawl",
        upload_file_id="file-1",
    )
    monkeypatch.setattr(
        datasets_document_module.DocumentService,
        "get_documents_by_ids",
        lambda *_args, **_kwargs: [doc],
    )

    with app.test_request_context(
        "/datasets/ds-1/documents/download-zip",
        method="POST",
        json={"document_ids": ["55555555-5555-5555-5555-555555555555"]},
    ):
        api = datasets_document_module.DocumentBatchDownloadZipApi()
        method = unwrap(api.post)
        with pytest.raises(NotFound):
            method(api, sqlite_session, "tenant-123", _account(), dataset_id="ds-1")


def test_document_download_returns_url_for_upload_file_document(
    app: Flask, datasets_document_module, monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    """Ensure upload-file documents return a `{url}` JSON payload."""

    _wire_common_success_mocks(
        module=datasets_document_module,
        monkeypatch=monkeypatch,
        document_tenant_id="tenant-123",
        data_source_type="upload_file",
        upload_file_id="file-123",
        upload_file_exists=True,
        signed_url="https://example.com/signed",
    )

    # Build a request context then call the resource method directly.
    with app.test_request_context("/datasets/ds-1/documents/doc-1/download", method="GET"):
        api = datasets_document_module.DocumentDownloadApi()
        method = unwrap(api.get)
        result = method(api, sqlite_session, "tenant-123", _account(), dataset_id="ds-1", document_id="doc-1")

    assert result == {"url": "https://example.com/signed"}


def test_document_download_rejects_non_upload_file_document(
    app: Flask, datasets_document_module, monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    """Ensure non-upload documents raise 404 (no file to download)."""

    _wire_common_success_mocks(
        module=datasets_document_module,
        monkeypatch=monkeypatch,
        document_tenant_id="tenant-123",
        data_source_type="website_crawl",
        upload_file_id="file-123",
        upload_file_exists=True,
        signed_url="https://example.com/signed",
    )

    with app.test_request_context("/datasets/ds-1/documents/doc-1/download", method="GET"):
        api = datasets_document_module.DocumentDownloadApi()
        method = unwrap(api.get)
        with pytest.raises(NotFound):
            method(api, sqlite_session, "tenant-123", _account(), dataset_id="ds-1", document_id="doc-1")


def test_document_download_rejects_missing_upload_file_id(
    app: Flask, datasets_document_module, monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    """Ensure missing `upload_file_id` raises 404."""

    _wire_common_success_mocks(
        module=datasets_document_module,
        monkeypatch=monkeypatch,
        document_tenant_id="tenant-123",
        data_source_type="upload_file",
        upload_file_id=None,
        upload_file_exists=False,
        signed_url="https://example.com/signed",
    )

    with app.test_request_context("/datasets/ds-1/documents/doc-1/download", method="GET"):
        api = datasets_document_module.DocumentDownloadApi()
        method = unwrap(api.get)
        with pytest.raises(NotFound):
            method(api, sqlite_session, "tenant-123", _account(), dataset_id="ds-1", document_id="doc-1")


def test_document_download_rejects_when_upload_file_record_missing(
    app: Flask, datasets_document_module, monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    """Ensure missing UploadFile row raises 404."""

    _wire_common_success_mocks(
        module=datasets_document_module,
        monkeypatch=monkeypatch,
        document_tenant_id="tenant-123",
        data_source_type="upload_file",
        upload_file_id="file-123",
        upload_file_exists=False,
        signed_url="https://example.com/signed",
    )

    with app.test_request_context("/datasets/ds-1/documents/doc-1/download", method="GET"):
        api = datasets_document_module.DocumentDownloadApi()
        method = unwrap(api.get)
        with pytest.raises(NotFound):
            method(api, sqlite_session, "tenant-123", _account(), dataset_id="ds-1", document_id="doc-1")


def test_document_download_rejects_document_owner_mismatch(
    app: Flask, datasets_document_module, monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    """Ensure an owner mismatch is rejected by the shared document resolver."""

    _wire_common_success_mocks(
        module=datasets_document_module,
        monkeypatch=monkeypatch,
        document_tenant_id="tenant-999",
        data_source_type="upload_file",
        upload_file_id="file-123",
        upload_file_exists=True,
        signed_url="https://example.com/signed",
    )

    with app.test_request_context("/datasets/ds-1/documents/doc-1/download", method="GET"):
        api = datasets_document_module.DocumentDownloadApi()
        method = unwrap(api.get)
        with pytest.raises(NotFound):
            method(api, sqlite_session, "tenant-123", _account(), dataset_id="ds-1", document_id="doc-1")
