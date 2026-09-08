from __future__ import annotations

import urllib.parse
from collections.abc import Generator
from contextlib import contextmanager
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from flask import Flask

from controllers.common.errors import (
    BlockedFileExtensionError,
    FileTooLargeError,
    RemoteFileAccessDeniedError,
    RemoteFileInvalidResponseError,
    RemoteFileInvalidUrlError,
    RemoteFileNotFoundError,
    RemoteFileUnavailableError,
    RemoteFileUrlBlockedError,
    UnsupportedFileTypeError,
)
from controllers.web import remote_files as remote_files_module
from libs.exception import BaseHTTPException
from models.enums import EndUserType
from models.model import App, AppMode, EndUser
from services.errors.file import (
    BlockedFileExtensionError as ServiceBlockedFileExtensionError,
)
from services.errors.file import FileTooLargeError as ServiceFileTooLargeError
from services.errors.file import UnsupportedFileTypeError as ServiceUnsupportedFileTypeError
from services.remote_file_service import (
    RemoteFileAccessDeniedError as RemoteFileAccessDeniedServiceError,
)
from services.remote_file_service import RemoteFileError, RemoteFileInfoResult, RemoteFileUploadResult
from services.remote_file_service import (
    RemoteFileInvalidResponseError as RemoteFileInvalidResponseServiceError,
)
from services.remote_file_service import RemoteFileInvalidUrlError as RemoteFileInvalidUrlServiceError
from services.remote_file_service import RemoteFileNotFoundError as RemoteFileNotFoundServiceError
from services.remote_file_service import RemoteFileUnavailableError as RemoteFileUnavailableServiceError
from services.remote_file_service import RemoteFileUrlBlockedError as RemoteFileUrlBlockedServiceError

REMOTE_FILE_ERROR_CASES: tuple[tuple[type[RemoteFileError], type[BaseHTTPException], str, int], ...] = (
    (RemoteFileInvalidUrlServiceError, RemoteFileInvalidUrlError, "remote_file_invalid_url", 400),
    (RemoteFileUrlBlockedServiceError, RemoteFileUrlBlockedError, "remote_file_url_blocked", 400),
    (RemoteFileNotFoundServiceError, RemoteFileNotFoundError, "remote_file_not_found", 404),
    (RemoteFileAccessDeniedServiceError, RemoteFileAccessDeniedError, "remote_file_access_denied", 400),
    (RemoteFileUnavailableServiceError, RemoteFileUnavailableError, "remote_file_unavailable", 502),
    (
        RemoteFileInvalidResponseServiceError,
        RemoteFileInvalidResponseError,
        "remote_file_invalid_response",
        502,
    ),
)


def _app_model() -> App:
    return App(
        id="app-1",
        tenant_id="tenant-1",
        name="Web App",
        description="",
        mode=AppMode.CHAT,
        enable_site=True,
        enable_api=True,
        max_active_requests=0,
    )


def _end_user() -> EndUser:
    return EndUser(
        id="eu-1",
        tenant_id="tenant-1",
        app_id="app-1",
        type=EndUserType.BROWSER,
        session_id="session-1",
    )


def _upload_result() -> RemoteFileUploadResult:
    return RemoteFileUploadResult(
        id="file-1",
        name="report.txt",
        size=16,
        extension="txt",
        url="https://signed.example/file-1",
        mime_type="text/plain",
        created_by="eu-1",
        created_at=datetime(2024, 1, 1, tzinfo=UTC),
    )


@contextmanager
def _patch_application_services(remote_files: MagicMock) -> Generator[None]:
    with patch.object(
        remote_files_module,
        "application_services",
        return_value=SimpleNamespace(remote_files=remote_files),
    ):
        yield


class TestRemoteFileInfoApi:
    def test_decodes_url_and_preserves_web_missing_length_default(self, app: Flask) -> None:
        remote_files = MagicMock()
        remote_files.fetch_info.return_value = RemoteFileInfoResult(
            content_type="text/plain",
            content_length=None,
        )
        target_url = "http://example.com/api/file?name=report.txt"
        encoded_url = urllib.parse.quote(target_url, safe="")

        with (
            app.test_request_context(f"/remote-files/{encoded_url}"),
            _patch_application_services(remote_files),
        ):
            result = remote_files_module.RemoteFileInfoApi().get(_app_model(), _end_user(), encoded_url)

        assert result == {"file_type": "text/plain", "file_length": -1}
        remote_files.fetch_info.assert_called_once_with(url=target_url)

    @pytest.mark.parametrize(("service_error_type", "http_error", "error_code", "status"), REMOTE_FILE_ERROR_CASES)
    def test_translates_remote_file_errors(
        self,
        app: Flask,
        service_error_type: type[RemoteFileError],
        http_error: type[BaseHTTPException],
        error_code: str,
        status: int,
    ) -> None:
        service_error = service_error_type("sensitive upstream details")
        remote_files = MagicMock()
        remote_files.fetch_info.side_effect = service_error

        with (
            app.test_request_context("/remote-files/url"),
            _patch_application_services(remote_files),
            pytest.raises(http_error) as error_info,
        ):
            remote_files_module.RemoteFileInfoApi().get(_app_model(), _end_user(), "url")

        assert error_info.value.__cause__ is service_error
        assert error_info.value.data is not None
        assert error_info.value.data["code"] == error_code
        assert error_info.value.data["status"] == status
        assert "sensitive upstream details" not in error_info.value.data["message"]


class TestRemoteFileUploadApi:
    def test_upload_delegates_without_overriding_web_tenant(self, app: Flask) -> None:
        remote_files = MagicMock()
        remote_files.upload_from_url.return_value = _upload_result()
        end_user = _end_user()
        url = "https://example.com/report.txt"

        with (
            app.test_request_context("/remote-files/upload", method="POST", json={"url": url}),
            _patch_application_services(remote_files),
        ):
            response, status = remote_files_module.RemoteFileUploadApi().post(_app_model(), end_user)

        assert status == 201
        assert response == {
            "id": "file-1",
            "name": "report.txt",
            "size": 16,
            "extension": "txt",
            "url": "https://signed.example/file-1",
            "mime_type": "text/plain",
            "created_by": "eu-1",
            "created_at": 1704067200,
        }
        remote_files.upload_from_url.assert_called_once_with(url=url, user=end_user)

    def test_uses_complete_message_for_empty_file_size_error(self, app: Flask) -> None:
        remote_files = MagicMock()
        remote_files.upload_from_url.side_effect = ServiceFileTooLargeError()

        with (
            app.test_request_context(
                "/remote-files/upload",
                method="POST",
                json={"url": "https://example.com/report.txt"},
            ),
            _patch_application_services(remote_files),
            pytest.raises(FileTooLargeError) as error_info,
        ):
            remote_files_module.RemoteFileUploadApi().post(_app_model(), _end_user())

        assert error_info.value.description == "File size exceeded."

    @pytest.mark.parametrize(("service_error_type", "http_error", "error_code", "status"), REMOTE_FILE_ERROR_CASES)
    def test_translates_remote_file_errors(
        self,
        app: Flask,
        service_error_type: type[RemoteFileError],
        http_error: type[BaseHTTPException],
        error_code: str,
        status: int,
    ) -> None:
        service_error = service_error_type("sensitive upstream details")
        remote_files = MagicMock()
        remote_files.upload_from_url.side_effect = service_error

        with (
            app.test_request_context(
                "/remote-files/upload",
                method="POST",
                json={"url": "https://example.com/report.txt"},
            ),
            _patch_application_services(remote_files),
            pytest.raises(http_error) as error_info,
        ):
            remote_files_module.RemoteFileUploadApi().post(_app_model(), _end_user())

        assert error_info.value.__cause__ is service_error
        assert error_info.value.data is not None
        assert error_info.value.data["code"] == error_code
        assert error_info.value.data["status"] == status
        assert "sensitive upstream details" not in error_info.value.data["message"]

    @pytest.mark.parametrize(
        ("service_error", "http_error"),
        [
            (ServiceFileTooLargeError("size exceeded"), FileTooLargeError),
            (ServiceUnsupportedFileTypeError(), UnsupportedFileTypeError),
            (
                ServiceBlockedFileExtensionError("File extension '.exe' is not allowed"),
                BlockedFileExtensionError,
            ),
        ],
    )
    def test_translates_file_errors(self, app: Flask, service_error: Exception, http_error: type[Exception]) -> None:
        remote_files = MagicMock()
        remote_files.upload_from_url.side_effect = service_error

        with (
            app.test_request_context(
                "/remote-files/upload",
                method="POST",
                json={"url": "https://example.com/report.txt"},
            ),
            _patch_application_services(remote_files),
            pytest.raises(http_error) as error_info,
        ):
            remote_files_module.RemoteFileUploadApi().post(_app_model(), _end_user())

        assert error_info.value.__cause__ is service_error
