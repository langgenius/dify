"""Unit tests for HITL human input file upload endpoints."""

from __future__ import annotations

from datetime import datetime
from io import BytesIO
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from flask import Flask

import controllers.web.human_input_file_upload as upload_module
from controllers.common.errors import (
    BlockedFileExtensionError,
    FileTooLargeError,
    NoFileUploadedError,
    RemoteFileAccessDeniedError,
    RemoteFileInvalidResponseError,
    RemoteFileInvalidUrlError,
    RemoteFileNotFoundError,
    RemoteFileUnavailableError,
    RemoteFileUrlBlockedError,
    UnsupportedFileTypeError,
)
from controllers.web.human_input_file_upload import (
    HumanInputFileUploadApi,
    InvalidUploadTokenForbiddenError,
    InvalidUploadTokenUnauthorizedError,
)
from extensions.storage.storage_type import StorageType
from models import Account
from models.account import AccountStatus
from models.enums import CreatorUserRole
from models.model import UploadFile
from services.errors.file import (
    BlockedFileExtensionError as BlockedFileExtensionServiceError,
)
from services.errors.file import FileTooLargeError as FileTooLargeServiceError
from services.errors.file import UnsupportedFileTypeError as UnsupportedFileTypeServiceError
from services.human_input_file_upload_service import (
    HumanInputUploadContext,
    InvalidUploadTokenError,
)
from services.remote_file_service import (
    RemoteFileAccessDeniedError as RemoteFileAccessDeniedServiceError,
)
from services.remote_file_service import (
    RemoteFileInvalidResponseError as RemoteFileInvalidResponseServiceError,
)
from services.remote_file_service import RemoteFileInvalidUrlError as RemoteFileInvalidUrlServiceError
from services.remote_file_service import RemoteFileNotFoundError as RemoteFileNotFoundServiceError
from services.remote_file_service import RemoteFileUnavailableError as RemoteFileUnavailableServiceError
from services.remote_file_service import RemoteFileUploadResult
from services.remote_file_service import RemoteFileUrlBlockedError as RemoteFileUrlBlockedServiceError


@pytest.fixture
def app() -> Flask:
    app = Flask(__name__)
    app.config["TESTING"] = True
    return app


def _account() -> Account:
    account = Account(name="Form Owner", email="owner@example.com", status=AccountStatus.ACTIVE)
    account.id = "owner-1"
    return account


def _upload_context() -> HumanInputUploadContext:
    return HumanInputUploadContext(
        tenant_id="tenant-1",
        app_id="app-1",
        form_id="form-1",
        recipient_id="recipient-1",
        upload_token_id="token-row-1",
        owner=_account(),
    )


def _upload_file() -> UploadFile:
    upload_file = UploadFile(
        tenant_id="tenant-1",
        storage_type=StorageType.LOCAL,
        key="upload/sample.txt",
        name="sample.txt",
        size=7,
        extension="txt",
        mime_type="text/plain",
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by="end-user-1",
        created_at=datetime(2024, 1, 1),
        used=False,
        source_url="signed-source-url",
    )
    upload_file.id = "file-1"
    return upload_file


def _remote_upload_file() -> RemoteFileUploadResult:
    return RemoteFileUploadResult(
        id="file-1",
        name="sample.txt",
        size=6,
        extension="txt",
        url="signed:file-1",
        mime_type="text/plain",
        created_by="owner-1",
        created_at=datetime(2024, 1, 1),
    )


def _patch_upload_service(monkeypatch: pytest.MonkeyPatch, service: MagicMock) -> None:
    monkeypatch.setattr(
        upload_module,
        "application_services",
        lambda: SimpleNamespace(human_input_file_uploads=service),
    )


def test_human_input_file_upload_route_uses_unified_path() -> None:
    urls = {
        url for _resource, resource_urls, _route_doc, _kwargs in upload_module.web_ns.resources for url in resource_urls
    }

    assert "/human-input-forms/files" in urls
    assert "/form/human_input/files/upload" not in urls
    assert "/form/human_input/files/remote-upload" not in urls


def test_local_upload_requires_authorization_before_reading_files(app: Flask) -> None:
    data = {"file": (BytesIO(b"content"), "sample.txt")}

    with app.test_request_context(
        "/api/human-input-forms/files",
        method="POST",
        data=data,
        content_type="multipart/form-data",
    ):
        with pytest.raises(InvalidUploadTokenUnauthorizedError):
            HumanInputFileUploadApi().post()


def test_local_upload_delegates_to_human_input_upload_service(monkeypatch: pytest.MonkeyPatch, app: Flask) -> None:
    service = MagicMock()
    context = _upload_context()
    service.validate_upload_token.return_value = context
    service.upload_local_file.return_value = _upload_file()
    _patch_upload_service(monkeypatch, service)

    data = {
        "file": (BytesIO(b"content"), "sample.txt"),
        "source": "datasets",
    }
    with app.test_request_context(
        "/api/human-input-forms/files",
        method="POST",
        headers={"Authorization": "bearer hitl_upload_token-1"},
        data=data,
        content_type="multipart/form-data",
    ):
        result, status = HumanInputFileUploadApi().post()

    assert status == 201
    assert result["id"] == "file-1"
    service.upload_local_file.assert_called_once_with(
        context=context,
        filename="sample.txt",
        content=b"content",
        mimetype="text/plain",
    )


def test_local_upload_missing_file_raises_after_valid_token(monkeypatch: pytest.MonkeyPatch, app: Flask) -> None:
    service = MagicMock()
    service.validate_upload_token.return_value = _upload_context()
    _patch_upload_service(monkeypatch, service)

    with app.test_request_context(
        "/api/human-input-forms/files",
        method="POST",
        headers={"Authorization": "bearer hitl_upload_token-1"},
        content_type="multipart/form-data",
    ):
        with pytest.raises(NoFileUploadedError):
            HumanInputFileUploadApi().post()

    service.validate_upload_token.assert_called_once_with("hitl_upload_token-1")


def test_remote_upload_validates_token_before_fetching_remote_url(monkeypatch: pytest.MonkeyPatch, app: Flask) -> None:
    service = MagicMock()
    service.validate_upload_token.side_effect = InvalidUploadTokenError()
    _patch_upload_service(monkeypatch, service)

    with app.test_request_context(
        "/api/human-input-forms/files",
        method="POST",
        headers={"Authorization": "Bearer hitl_upload_token-1"},
        data={"url": "https://example.com/file.txt"},
        content_type="multipart/form-data",
    ):
        with pytest.raises(InvalidUploadTokenForbiddenError):
            HumanInputFileUploadApi().post()

    service.upload_remote_file.assert_not_called()


def test_remote_upload_delegates_to_human_input_upload_service(monkeypatch: pytest.MonkeyPatch, app: Flask) -> None:
    service = MagicMock()
    context = _upload_context()
    service.validate_upload_token.return_value = context
    service.upload_remote_file.return_value = _remote_upload_file()
    _patch_upload_service(monkeypatch, service)

    with app.test_request_context(
        "/api/human-input-forms/files",
        method="POST",
        headers={"Authorization": "Bearer hitl_upload_token-1"},
        data={"url": "https://example.com/file.txt"},
        content_type="multipart/form-data",
    ):
        result, status = HumanInputFileUploadApi().post()

    assert status == 201
    assert result["url"] == "signed:file-1"
    service.upload_remote_file.assert_called_once_with(
        context=context,
        url="https://example.com/file.txt",
    )


@pytest.mark.parametrize(
    ("service_error", "http_error"),
    [
        pytest.param(RemoteFileInvalidUrlServiceError(), RemoteFileInvalidUrlError, id="invalid-url"),
        pytest.param(RemoteFileUrlBlockedServiceError(), RemoteFileUrlBlockedError, id="blocked-url"),
        pytest.param(RemoteFileNotFoundServiceError(), RemoteFileNotFoundError, id="not-found"),
        pytest.param(RemoteFileAccessDeniedServiceError(), RemoteFileAccessDeniedError, id="access-denied"),
        pytest.param(RemoteFileUnavailableServiceError(), RemoteFileUnavailableError, id="unavailable"),
        pytest.param(RemoteFileInvalidResponseServiceError(), RemoteFileInvalidResponseError, id="invalid-response"),
    ],
)
def test_remote_upload_maps_remote_file_errors(
    monkeypatch: pytest.MonkeyPatch,
    app: Flask,
    service_error: Exception,
    http_error: type[Exception],
) -> None:
    service = MagicMock()
    service.validate_upload_token.return_value = _upload_context()
    service.upload_remote_file.side_effect = service_error
    _patch_upload_service(monkeypatch, service)

    with app.test_request_context(
        "/api/human-input-forms/files",
        method="POST",
        headers={"Authorization": "Bearer hitl_upload_token-1"},
        data={"url": "https://example.com/file.txt"},
        content_type="multipart/form-data",
    ):
        with pytest.raises(http_error) as raised:
            HumanInputFileUploadApi().post()

    assert raised.value.__cause__ is service_error


@pytest.mark.parametrize(
    ("service_error", "http_error"),
    [
        pytest.param(FileTooLargeServiceError(), FileTooLargeError, id="too-large"),
        pytest.param(UnsupportedFileTypeServiceError(), UnsupportedFileTypeError, id="unsupported"),
        pytest.param(BlockedFileExtensionServiceError("Blocked extension"), BlockedFileExtensionError, id="blocked"),
    ],
)
@pytest.mark.parametrize("remote", [False, True], ids=["local", "remote"])
def test_upload_maps_file_service_errors(
    monkeypatch: pytest.MonkeyPatch,
    app: Flask,
    service_error: Exception,
    http_error: type[Exception],
    remote: bool,
) -> None:
    service = MagicMock()
    service.validate_upload_token.return_value = _upload_context()
    if remote:
        service.upload_remote_file.side_effect = service_error
        data = {"url": "https://example.com/file.txt"}
    else:
        service.upload_local_file.side_effect = service_error
        data = {"file": (BytesIO(b"content"), "sample.txt")}
    _patch_upload_service(monkeypatch, service)

    with app.test_request_context(
        "/api/human-input-forms/files",
        method="POST",
        headers={"Authorization": "Bearer hitl_upload_token-1"},
        data=data,
        content_type="multipart/form-data",
    ):
        with pytest.raises(http_error) as raised:
            HumanInputFileUploadApi().post()

    assert raised.value.__cause__ is service_error
    if isinstance(service_error, FileTooLargeServiceError):
        assert isinstance(raised.value, FileTooLargeError)
        assert raised.value.description == "File size exceeded."
