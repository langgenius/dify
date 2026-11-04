from __future__ import annotations

import urllib.parse
from collections.abc import Generator
from contextlib import contextmanager
from datetime import UTC, datetime
from inspect import unwrap
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
from controllers.console import remote_files as remote_files_module
from libs.exception import BaseHTTPException
from machinery.context import RequestContext
from models import Account
from models.account import AccountStatus, TenantAccountRole
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


def _account() -> Account:
    account = Account(
        name="Test User",
        email="user@example.com",
        status=AccountStatus.ACTIVE,
    )
    account.id = "account-1"
    account.role = TenantAccountRole.OWNER
    return account


def _upload_result() -> RemoteFileUploadResult:
    return RemoteFileUploadResult(
        id="file-1",
        name="report.txt",
        size=16,
        extension="txt",
        url="https://signed.example/file-1",
        mime_type="text/plain",
        created_by="account-1",
        created_at=datetime(2024, 1, 1, tzinfo=UTC),
    )


def _request_context() -> RequestContext:
    return RequestContext(
        request_id="request-1",
        trace_id="trace-1",
        account_id="account-1",
        active_workspace_id="tenant-1",
    )


@contextmanager
def _patch_application_services(remote_files: MagicMock) -> Generator[None]:
    with patch.object(
        remote_files_module,
        "application_services",
        return_value=SimpleNamespace(remote_files=remote_files),
    ):
        yield


class TestGetRemoteFileInfo:
    def test_decodes_url_and_preserves_console_missing_length_default(self, app: Flask) -> None:
        api = remote_files_module.GetRemoteFileInfo()
        handler = unwrap(api.get)
        remote_files = MagicMock()
        remote_files.fetch_info.return_value = RemoteFileInfoResult(
            content_type="text/plain",
            content_length=None,
        )
        target_url = "https://example.com/file?name=report.txt"
        encoded_url = urllib.parse.quote(target_url, safe="")

        with (
            app.test_request_context(f"/remote-files/{encoded_url}", method="GET"),
            _patch_application_services(remote_files),
        ):
            response = handler(api, _request_context(), encoded_url)

        assert response == {"file_type": "text/plain", "file_length": 0}
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
        api = remote_files_module.GetRemoteFileInfo()
        handler = unwrap(api.get)
        service_error = service_error_type("sensitive upstream details")
        remote_files = MagicMock()
        remote_files.fetch_info.side_effect = service_error

        with (
            app.test_request_context("/remote-files/url", method="GET"),
            _patch_application_services(remote_files),
            pytest.raises(http_error) as error_info,
        ):
            handler(api, _request_context(), "url")

        assert error_info.value.__cause__ is service_error
        assert error_info.value.data is not None
        assert error_info.value.data["code"] == error_code
        assert error_info.value.data["status"] == status
        assert "sensitive upstream details" not in error_info.value.data["message"]


class TestRemoteFileUpload:
    def test_controller_delegates_with_validated_payload(self, app: Flask) -> None:
        api = remote_files_module.RemoteFileUpload()
        handler = unwrap(api.post)
        account = _account()
        remote_file = _upload_result()

        with (
            app.test_request_context("/remote-files/upload", method="POST"),
            patch.object(remote_files_module, "upload_remote_file", return_value=remote_file) as upload,
        ):
            response, status = handler(
                api,
                remote_files_module.RemoteFileUploadPayload(url="https://example.com/report.txt"),
                account,
            )

        assert status == 201
        assert response["created_at"] == 1704067200
        upload.assert_called_once_with(
            url="https://example.com/report.txt",
            current_user=account,
        )

    def test_helper_preserves_explicit_resource_tenant(self, app: Flask) -> None:
        account = _account()
        remote_files = MagicMock()
        remote_files.upload_from_url.return_value = _upload_result()

        with (
            app.test_request_context("/remote-files/upload", method="POST"),
            _patch_application_services(remote_files),
        ):
            result = remote_files_module.upload_remote_file(
                url="https://example.com/report.txt",
                current_user=account,
                resource_tenant_id="app-tenant-id",
            )

        assert result == _upload_result()
        remote_files.upload_from_url.assert_called_once_with(
            url="https://example.com/report.txt",
            user=account,
            tenant_id="app-tenant-id",
        )

    @pytest.mark.parametrize(("service_error_type", "http_error", "error_code", "status"), REMOTE_FILE_ERROR_CASES)
    def test_helper_translates_remote_file_errors(
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
            app.test_request_context("/remote-files/upload", method="POST"),
            _patch_application_services(remote_files),
            pytest.raises(http_error) as error_info,
        ):
            remote_files_module.upload_remote_file(
                url="https://example.com/report.txt",
                current_user=_account(),
            )

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
    def test_helper_translates_file_errors(
        self,
        app: Flask,
        service_error: Exception,
        http_error: type[Exception],
    ) -> None:
        remote_files = MagicMock()
        remote_files.upload_from_url.side_effect = service_error

        with (
            app.test_request_context("/remote-files/upload", method="POST"),
            _patch_application_services(remote_files),
            pytest.raises(http_error) as error_info,
        ):
            remote_files_module.upload_remote_file(
                url="https://example.com/report.txt",
                current_user=_account(),
            )

        assert error_info.value.__cause__ is service_error
