"""Unit tests for HITL human input file upload endpoints."""

from __future__ import annotations

from datetime import datetime
from io import BytesIO
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from flask import Flask
from pytest_mock import MockerFixture
from werkzeug.exceptions import Forbidden

import controllers.web.human_input_file_upload as upload_module
from controllers.common.errors import (
    BlockedFileExtensionError,
    FileTooLargeError,
    NoFileUploadedError,
    NotFoundError,
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
from extensions.ext_application_services import ApplicationServices
from models import Account
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
from services.human_input_service import FormExpiredError, FormSubmittedError
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
from tests.unit_tests.controllers.error_body import raised_error
from tests.unit_tests.model_factories import make_account, make_upload_file


@pytest.fixture
def app() -> Flask:
    app = Flask(__name__)
    app.config["TESTING"] = True
    return app


@pytest.fixture(autouse=True)
def form_app_checks(monkeypatch: pytest.MonkeyPatch) -> list[dict[str, str]]:
    """Treat the token's form app as available; record each check.

    Tests for an unavailable app replace this with a check that raises.
    """
    calls: list[dict[str, str]] = []

    def _record(**kwargs: str) -> None:
        calls.append(kwargs)

    monkeypatch.setattr(upload_module, "resolve_form_app_site", _record)
    return calls


def _account() -> Account:
    return make_account(account_id="owner-1", name="Form Owner", email="owner@example.com")


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
    return make_upload_file(
        file_id="file-1",
        key="upload/sample.txt",
        name="sample.txt",
        size=7,
        created_by="end-user-1",
        source_url="signed-source-url",
    )


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


class _FormStateRejectingUploads:
    """An upload service whose token check fails with one form-state error; counts the uploads that follow."""

    def __init__(self, error: Exception) -> None:
        self.error = error
        self.uploads = 0

    def validate_upload_token(self, _upload_token: str) -> HumanInputUploadContext:
        raise self.error

    def upload_local_file(self, **_: object) -> UploadFile:
        self.uploads += 1
        raise AssertionError("upload must not run after the token check failed")


class _ValidTokenUploads:
    """An upload service that accepts the token and counts each upload."""

    def __init__(self) -> None:
        self.local_uploads = 0
        self.remote_uploads = 0

    def validate_upload_token(self, _upload_token: str) -> HumanInputUploadContext:
        return _upload_context()

    def upload_local_file(self, **_: object) -> UploadFile:
        self.local_uploads += 1
        return _upload_file()

    def upload_remote_file(self, **_: object) -> RemoteFileUploadResult:
        self.remote_uploads += 1
        return _remote_upload_file()


def _patch_upload_service(monkeypatch: pytest.MonkeyPatch, service: object) -> None:
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


@pytest.mark.parametrize("separator", ["\xa0", "\x1c", "\v", "\u2003"])
def test_non_http_whitespace_cannot_bypass_gateway_upload_identity(
    monkeypatch: pytest.MonkeyPatch, app: Flask, separator: str
) -> None:
    service = MagicMock()
    _patch_upload_service(monkeypatch, service)
    with app.test_request_context(
        "/api/human-input-forms/files",
        method="POST",
        headers={"Authorization": f"Bearer{separator}hitl_upload_token-1"},
        content_type="multipart/form-data",
    ):
        with pytest.raises(InvalidUploadTokenUnauthorizedError):
            HumanInputFileUploadApi().post()
    service.validate_upload_token.assert_not_called()
    service.upload_local_file.assert_not_called()
    service.upload_remote_file.assert_not_called()


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


@pytest.mark.parametrize(
    ("error", "code"),
    [
        (FormSubmittedError("form-1"), "human_input_form_submitted"),
        (FormExpiredError("form-1"), "human_input_form_expired"),
    ],
)
def test_upload_reports_the_form_state_before_touching_files(
    monkeypatch: pytest.MonkeyPatch, app: Flask, error: Exception, code: str
) -> None:
    # The token service re-checks the form on every upload; a submitted or expired form answers 412.
    service = _FormStateRejectingUploads(error)
    _patch_upload_service(monkeypatch, service)

    with app.test_request_context(
        "/api/human-input-forms/files",
        method="POST",
        headers={"Authorization": "bearer hitl_upload_token-1"},
        data={"file": (BytesIO(b"content"), "sample.txt")},
        content_type="multipart/form-data",
    ):
        body, status = raised_error(HumanInputFileUploadApi().post)

    assert status == 412
    assert body["code"] == code
    assert service.uploads == 0


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


def test_upload_checks_the_form_app_of_the_token(
    monkeypatch: pytest.MonkeyPatch, app: Flask, form_app_checks: list[dict[str, str]]
) -> None:
    service = _ValidTokenUploads()
    _patch_upload_service(monkeypatch, service)

    with app.test_request_context(
        "/api/human-input-forms/files",
        method="POST",
        headers={"Authorization": "Bearer hitl_upload_token-1"},
        data={"file": (BytesIO(b"content"), "sample.txt")},
        content_type="multipart/form-data",
    ):
        _, status = HumanInputFileUploadApi().post()

    assert status == 201
    assert service.local_uploads == 1
    assert form_app_checks == [{"app_id": "app-1", "tenant_id": "tenant-1"}]


@pytest.mark.parametrize(
    "check_error",
    [
        pytest.param(Forbidden(), id="archived-workspace-or-no-site"),
        pytest.param(NotFoundError("Form not found"), id="app-deleted"),
    ],
)
@pytest.mark.parametrize("source", ["local", "remote"])
def test_upload_rejects_token_when_form_app_is_unavailable(
    monkeypatch: pytest.MonkeyPatch, app: Flask, check_error: Exception, source: str
) -> None:
    # The form page refuses these forms, so their upload tokens must stop working
    # before any file is read, fetched, or stored.
    service = _ValidTokenUploads()
    _patch_upload_service(monkeypatch, service)

    def _reject(**_: str) -> None:
        raise check_error

    monkeypatch.setattr(upload_module, "resolve_form_app_site", _reject)
    data: dict[str, object] = (
        {"file": (BytesIO(b"content"), "sample.txt")} if source == "local" else {"url": "https://example.com/file.txt"}
    )

    with app.test_request_context(
        "/api/human-input-forms/files",
        method="POST",
        headers={"Authorization": "Bearer hitl_upload_token-1"},
        data=data,
        content_type="multipart/form-data",
    ):
        body, status = raised_error(HumanInputFileUploadApi().post)

    assert status == 403
    assert body["code"] == "invalid_upload_token"
    assert service.local_uploads == 0
    assert service.remote_uploads == 0


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
    mocker: MockerFixture,
    account_application_services: ApplicationServices,
) -> None:
    service = account_application_services.human_input_file_uploads
    mocker.patch.object(service, "validate_upload_token", return_value=_upload_context())
    if remote:
        mocker.patch.object(service, "upload_remote_file", side_effect=service_error)
        data = {"url": "https://example.com/file.txt"}
    else:
        mocker.patch.object(service, "upload_local_file", side_effect=service_error)
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
