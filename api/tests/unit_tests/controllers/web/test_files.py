"""Unit tests for controllers.web.files endpoints."""

from __future__ import annotations

from datetime import datetime
from io import BytesIO
from unittest.mock import MagicMock, patch

import pytest
from flask import Flask

from controllers.common.errors import (
    BlockedFileExtensionError,
    FilenameNotExistsError,
    FileTooLargeError,
    NoFileUploadedError,
    TooManyFilesError,
    UnsupportedFileTypeError,
)
from controllers.web.files import FileApi
from core.file.uploads import FileUploadActor, FileUploadResult
from extensions.storage.storage_type import StorageType
from libs.exception import BaseHTTPException
from models.enums import CreatorUserRole
from models.model import App, AppMode, EndUser
from services.errors import file as file_errors
from tests.unit_tests.model_factories import make_end_user


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
    return make_end_user(end_user_id="eu-1", app_id="app-1")


def _upload_file() -> FileUploadResult:
    return FileUploadResult(
        id="file-1",
        tenant_id="tenant-1",
        storage_type=StorageType.LOCAL,
        key="upload/test.txt",
        name="test.txt",
        size=100,
        extension="txt",
        mime_type="text/plain",
        created_by_role=CreatorUserRole.END_USER,
        created_by="eu-1",
        created_at=datetime(2024, 1, 1),
        used=False,
        used_by=None,
        used_at=None,
        hash=None,
        source_url="",
    )


class TestFileApi:
    def test_no_file_uploaded(self, app: Flask) -> None:
        with app.test_request_context("/files/upload", method="POST", content_type="multipart/form-data"):
            with pytest.raises(NoFileUploadedError):
                FileApi().post(_app_model(), _end_user())

    def test_too_many_files(self, app: Flask) -> None:
        data = {
            "file": (BytesIO(b"a"), "a.txt"),
            "file2": (BytesIO(b"b"), "b.txt"),
        }
        with app.test_request_context("/files/upload", method="POST", data=data, content_type="multipart/form-data"):
            # Now has "file" key but len(request.files) > 1
            with pytest.raises(TooManyFilesError):
                FileApi().post(_app_model(), _end_user())

    def test_filename_missing(self, app: Flask) -> None:
        data = {"file": (BytesIO(b"content"), "")}
        with app.test_request_context("/files/upload", method="POST", data=data, content_type="multipart/form-data"):
            with pytest.raises(FilenameNotExistsError):
                FileApi().post(_app_model(), _end_user())

    @pytest.mark.parametrize(
        ("path", "form_source", "expected_source"),
        [
            ("/files/upload", None, None),
            ("/files/upload", "datasets", "datasets"),
            ("/files/upload", "invalid", None),
            ("/files/upload?source=datasets", None, None),
        ],
    )
    @patch("controllers.web.files.application_services")
    def test_upload_success(
        self,
        mock_application_services: MagicMock,
        app: Flask,
        path: str,
        form_source: str | None,
        expected_source: str | None,
    ) -> None:
        file_uploads = mock_application_services.return_value.file_uploads
        file_uploads.upload_file_for_actor.return_value = _upload_file()
        app_model = _app_model()
        end_user = _end_user()

        data: dict[str, object] = {"file": (BytesIO(b"content"), "test.txt", "text/plain")}
        if form_source is not None:
            data["source"] = form_source
        with app.test_request_context(path, method="POST", data=data, content_type="multipart/form-data"):
            result, status = FileApi().post(app_model, end_user)

        assert status == 201
        assert result["id"] == "file-1"
        assert result["name"] == "test.txt"
        assert result["tenant_id"] == app_model.tenant_id
        file_uploads.upload_file_for_actor.assert_called_once_with(
            filename="test.txt",
            content=b"content",
            mimetype="text/plain",
            actor=FileUploadActor(id=end_user.id, creator_role=CreatorUserRole.END_USER),
            resource_tenant_id=end_user.tenant_id,
            source=expected_source,
        )

    @pytest.mark.parametrize(
        ("service_error", "expected_error", "expected_status", "expected_code", "expected_message"),
        [
            (file_errors.FileTooLargeError("max 10MB"), FileTooLargeError, 413, "file_too_large", "max 10MB"),
            (
                file_errors.UnsupportedFileTypeError(),
                UnsupportedFileTypeError,
                415,
                "unsupported_file_type",
                "File type not allowed.",
            ),
            (
                file_errors.BlockedFileExtensionError("File extension '.exe' is blocked"),
                BlockedFileExtensionError,
                400,
                "file_extension_blocked",
                "The file extension is blocked for security reasons.",
            ),
        ],
    )
    @patch("controllers.web.files.application_services")
    def test_service_error_mapping(
        self,
        mock_application_services: MagicMock,
        app: Flask,
        service_error: Exception,
        expected_error: type[BaseHTTPException],
        expected_status: int,
        expected_code: str,
        expected_message: str,
    ) -> None:
        mock_application_services.return_value.file_uploads.upload_file_for_actor.side_effect = service_error

        data = {"file": (BytesIO(b"big"), "big.txt")}
        with app.test_request_context("/files/upload", method="POST", data=data, content_type="multipart/form-data"):
            with pytest.raises(expected_error) as raised:
                FileApi().post(_app_model(), _end_user())

        assert raised.value.code == expected_status
        assert raised.value.error_code == expected_code
        assert raised.value.data == {
            "code": expected_code,
            "message": expected_message,
            "status": expected_status,
        }
        assert raised.value.__cause__ is service_error
