from inspect import unwrap
from io import BytesIO
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from flask import Flask
from werkzeug.exceptions import BadRequest

from controllers.common.errors import (
    BlockedFileExtensionError,
    FileTooLargeError,
    UnsupportedFileTypeError,
)
from controllers.openapi.auth.data import AuthData, CallerKind
from controllers.openapi.files import AppFileUploadApi
from libs.exception import BaseHTTPException
from libs.oauth_bearer import Scope, TokenType
from models import Account
from services.errors.file import BlockedFileExtensionError as ServiceBlockedFileExtensionError
from services.errors.file import FileTooLargeError as ServiceFileTooLargeError
from services.errors.file import UnsupportedFileTypeError as ServiceUnsupportedFileTypeError


def _auth_data(caller: Account) -> AuthData:
    return AuthData.model_construct(
        token_type=TokenType.OAUTH_ACCOUNT,
        token_hash="test-token",
        scopes=frozenset({Scope.APPS_RUN}),
        app=object(),
        caller=caller,
        caller_kind=CallerKind.ACCOUNT,
    )


def _caller() -> Account:
    caller = Account(name="Uploader", email="uploader@example.com")
    caller.id = "account-1"
    return caller


def _upload_result() -> SimpleNamespace:
    return SimpleNamespace(
        id="00000000-0000-0000-0000-000000000001",
        name="note.txt",
        size=5,
        extension="txt",
        mime_type="text/plain",
    )


def _file_service(monkeypatch: pytest.MonkeyPatch) -> Mock:
    from controllers.openapi import files as module

    service = Mock()
    monkeypatch.setattr(module, "application_services", lambda: SimpleNamespace(files=service))
    return service


def test_upload_uses_injected_file_service(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    service = _file_service(monkeypatch)
    service.upload_file.return_value = _upload_result()
    caller = _caller()

    with app.test_request_context(
        "/openapi/v1/apps/app-1/files",
        method="POST",
        data={"file": (BytesIO(b"hello"), "note.txt", "text/plain")},
        content_type="multipart/form-data",
    ):
        result = unwrap(AppFileUploadApi.post)(
            AppFileUploadApi(),
            app_id="app-1",
            auth_data=_auth_data(caller),
        )

    assert result.id == "00000000-0000-0000-0000-000000000001"
    service.upload_file.assert_called_once_with(
        filename="note.txt",
        content=b"hello",
        mimetype="text/plain",
        user=caller,
    )


@pytest.mark.parametrize(
    ("service_error", "controller_error", "status", "error_code", "message"),
    [
        (ServiceFileTooLargeError("too large"), FileTooLargeError, 413, "file_too_large", "too large"),
        (
            ServiceUnsupportedFileTypeError(),
            UnsupportedFileTypeError,
            415,
            "unsupported_file_type",
            "File type not allowed.",
        ),
        (
            ServiceBlockedFileExtensionError("blocked extension"),
            BlockedFileExtensionError,
            400,
            "file_extension_blocked",
            "blocked extension",
        ),
    ],
)
def test_upload_preserves_specific_file_errors(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
    service_error: ValueError,
    controller_error: type[BaseHTTPException],
    status: int,
    error_code: str,
    message: str,
) -> None:
    service = _file_service(monkeypatch)
    service.upload_file.side_effect = service_error

    with app.test_request_context(
        "/openapi/v1/apps/app-1/files",
        method="POST",
        data={"file": (BytesIO(b"hello"), "note.txt", "text/plain")},
        content_type="multipart/form-data",
    ):
        with pytest.raises(controller_error) as error_info:
            unwrap(AppFileUploadApi.post)(
                AppFileUploadApi(),
                app_id="app-1",
                auth_data=_auth_data(_caller()),
            )

    assert error_info.value.code == status
    assert error_info.value.error_code == error_code
    assert error_info.value.data == {"code": error_code, "message": message, "status": status}
    assert error_info.value.__cause__ is service_error


def test_upload_maps_other_value_errors_to_bad_request(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    service = _file_service(monkeypatch)
    service_error = ValueError("Filename contains invalid characters")
    service.upload_file.side_effect = service_error

    with app.test_request_context(
        "/openapi/v1/apps/app-1/files",
        method="POST",
        data={"file": (BytesIO(b"hello"), "../note.txt", "text/plain")},
        content_type="multipart/form-data",
    ):
        with pytest.raises(BadRequest) as error_info:
            unwrap(AppFileUploadApi.post)(
                AppFileUploadApi(),
                app_id="app-1",
                auth_data=_auth_data(_caller()),
            )

    assert error_info.value.description == str(service_error)
    assert error_info.value.__cause__ is service_error
