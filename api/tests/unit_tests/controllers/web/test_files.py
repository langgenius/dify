"""Unit tests for controllers.web.files endpoints."""

from __future__ import annotations

from io import BytesIO
from unittest.mock import MagicMock, patch

import pytest
from flask import Flask
from sqlalchemy import Engine

from controllers.common.errors import (
    FilenameNotExistsError,
    FileTooLargeError,
    NoFileUploadedError,
    TooManyFilesError,
)
from controllers.web.files import FileApi
from models.enums import CreatorUserRole
from models.model import App, AppMode, EndUser, UploadFile
from tests.unit_tests.model_factories import make_end_user, make_upload_file


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


def _upload_file() -> UploadFile:
    return make_upload_file(
        file_id="file-1",
        key="upload/test.txt",
        size=100,
        created_by_role=CreatorUserRole.END_USER,
        created_by="eu-1",
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

    @patch("controllers.web.files.FileService")
    @patch("controllers.web.files.db")
    def test_upload_success(
        self, mock_db: MagicMock, mock_file_svc_cls: MagicMock, app: Flask, sqlite_engine: Engine
    ) -> None:
        mock_db.engine = sqlite_engine
        mock_file_svc_cls.return_value.upload_file.return_value = _upload_file()

        data = {"file": (BytesIO(b"content"), "test.txt")}
        with app.test_request_context("/files/upload", method="POST", data=data, content_type="multipart/form-data"):
            result, status = FileApi().post(_app_model(), _end_user())

        assert status == 201
        assert result["id"] == "file-1"
        assert result["name"] == "test.txt"

    @patch("controllers.web.files.FileService")
    @patch("controllers.web.files.db")
    def test_file_too_large_from_service(
        self, mock_db: MagicMock, mock_file_svc_cls: MagicMock, app: Flask, sqlite_engine: Engine
    ) -> None:
        import services.errors.file

        mock_db.engine = sqlite_engine
        mock_file_svc_cls.return_value.upload_file.side_effect = services.errors.file.FileTooLargeError(
            description="max 10MB"
        )

        data = {"file": (BytesIO(b"big"), "big.txt")}
        with app.test_request_context("/files/upload", method="POST", data=data, content_type="multipart/form-data"):
            with pytest.raises(FileTooLargeError):
                FileApi().post(_app_model(), _end_user())
