from inspect import unwrap
from io import BytesIO
from types import SimpleNamespace
from unittest.mock import Mock
from uuid import UUID

import pytest
from flask import Flask
from sqlalchemy.orm import Session
from werkzeug.exceptions import BadRequest

from constants.oauth_bearer import TokenType
from controllers.common.errors import (
    BlockedFileExtensionError,
    FileTooLargeError,
    UnsupportedFileTypeError,
)
from controllers.openapi._errors import InvalidFilePart
from controllers.openapi._files import discard_uploaded_files, merge_files
from controllers.openapi._models import FileUploadPayload
from controllers.openapi._multipart import body_from_request
from controllers.openapi._upload import file_fields
from controllers.openapi.auth.context import Context
from controllers.openapi.auth.subjects import AccountSubject
from controllers.openapi.files import AppFileUploadApi
from libs.exception import BaseHTTPException
from libs.oauth_bearer import AuthContext
from models import Account
from services.errors.file import BlockedFileExtensionError as ServiceBlockedFileExtensionError
from services.errors.file import FileTooLargeError as ServiceFileTooLargeError
from services.errors.file import UnsupportedFileTypeError as ServiceUnsupportedFileTypeError


def _caller() -> Account:
    caller = Account(name="Uploader", email="uploader@example.com")
    caller.id = str(UUID(int=1))
    return caller


def _context(caller: Account, session: Session) -> Context:
    auth = AuthContext(
        token_type=TokenType.OAUTH_ACCOUNT,
        subject_email=caller.email,
        subject_issuer="dify:account",
        account_id=UUID(caller.id),
        client_id="difyctl",
        token_id=UUID(int=2),
        expires_at=None,
    )
    context = Context(AccountSubject(auth), session, {"app_id": "app-1"})
    context._caller = caller
    return context


def _upload_result() -> SimpleNamespace:
    return SimpleNamespace(
        id="00000000-0000-0000-0000-000000000001",
        name="note.txt",
        size=5,
        extension="txt",
        mime_type="text/plain",
    )


def _body() -> FileUploadPayload:
    return FileUploadPayload.model_validate(body_from_request(file_fields=file_fields(FileUploadPayload)))


def _file_service(monkeypatch: pytest.MonkeyPatch) -> Mock:
    from controllers.openapi import _files as module

    service = Mock()
    monkeypatch.setattr(module, "application_services", lambda: SimpleNamespace(files=service))
    return service


def test_upload_uses_injected_file_service(
    app: Flask, monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    service = _file_service(monkeypatch)
    service.upload_file.return_value = _upload_result()
    caller = _caller()

    with app.test_request_context(
        "/openapi/v1/apps/app-1/files",
        method="POST",
        data={"file": (BytesIO(b"hello"), "note.txt", "text/plain")},
        content_type="multipart/form-data",
    ):
        api = AppFileUploadApi()
        result = unwrap(api.post)(api, _context(caller, sqlite_session), app_id="app-1", body=_body())

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
    sqlite_session: Session,
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
        api = AppFileUploadApi()
        with pytest.raises(controller_error) as error_info:
            unwrap(api.post)(api, _context(_caller(), sqlite_session), app_id="app-1", body=_body())

    assert error_info.value.code == status
    assert error_info.value.error_code == error_code
    assert error_info.value.data == {"code": error_code, "message": message, "status": status}
    assert error_info.value.__cause__ is service_error


def test_upload_maps_other_value_errors_to_bad_request(
    app: Flask, monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    service = _file_service(monkeypatch)
    service_error = ValueError("Filename contains invalid characters")
    service.upload_file.side_effect = service_error

    with app.test_request_context(
        "/openapi/v1/apps/app-1/files",
        method="POST",
        data={"file": (BytesIO(b"hello"), "../note.txt", "text/plain")},
        content_type="multipart/form-data",
    ):
        api = AppFileUploadApi()
        with pytest.raises(BadRequest) as error_info:
            unwrap(api.post)(api, _context(_caller(), sqlite_session), app_id="app-1", body=_body())

    assert error_info.value.description == str(service_error)
    assert error_info.value.__cause__ is service_error


def test_merge_files_discards_earlier_upload_when_a_later_part_is_invalid(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from werkzeug.datastructures import FileStorage

    service = _file_service(monkeypatch)
    service.upload_file.return_value = _upload_result()
    caller = _caller()
    uploads = {
        "attachment": FileStorage(BytesIO(b"first"), filename="first.txt", content_type="text/plain"),
        "answer": FileStorage(BytesIO(b"second"), filename="second.txt", content_type="text/plain"),
    }

    with pytest.raises(InvalidFilePart, match="answer is also given in inputs"):
        merge_files({"answer": "provided"}, uploads, caller)

    service.upload_file.assert_called_once()
    service.delete_file.assert_called_once_with(_upload_result().id)


def test_discard_uploaded_files_continues_after_cleanup_failure(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    service = _file_service(monkeypatch)
    service.delete_file.side_effect = [RuntimeError("storage unavailable"), None]

    discard_uploaded_files(["first-upload", "second-upload"])

    assert [call.args for call in service.delete_file.call_args_list] == [
        ("first-upload",),
        ("second-upload",),
    ]
    assert "Failed to discard rejected OpenAPI upload file first-upload" in caplog.text
