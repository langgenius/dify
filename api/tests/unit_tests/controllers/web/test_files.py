"""Unit tests for controllers.web.files endpoints."""

from __future__ import annotations

from io import BytesIO
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from flask import Flask

from controllers.common.errors import (
    FilenameNotExistsError,
    FileTooLargeError,
    NoFileUploadedError,
    TooManyFilesError,
)
from controllers.web.files import FileApi


def _app_model() -> SimpleNamespace:
    return SimpleNamespace(id="app-1")


def _end_user() -> SimpleNamespace:
    return SimpleNamespace(id="eu-1")


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
    def test_upload_success(self, mock_db: MagicMock, mock_file_svc_cls: MagicMock, app: Flask) -> None:
        mock_db.engine = "engine"
        from datetime import datetime

        upload_file = SimpleNamespace(
            id="file-1",
            name="test.txt",
            size=100,
            extension="txt",
            mime_type="text/plain",
            created_by="eu-1",
            created_at=datetime(2024, 1, 1),
        )
        mock_file_svc_cls.return_value.upload_file.return_value = upload_file

        data = {"file": (BytesIO(b"content"), "test.txt")}
        with app.test_request_context("/files/upload", method="POST", data=data, content_type="multipart/form-data"):
            result, status = FileApi().post(_app_model(), _end_user())

        assert status == 201
        assert result["id"] == "file-1"
        assert result["name"] == "test.txt"

    @patch("controllers.web.files.FileService")
    @patch("controllers.web.files.db")
    def test_file_too_large_from_service(self, mock_db: MagicMock, mock_file_svc_cls: MagicMock, app: Flask) -> None:
        import services.errors.file

        mock_db.engine = "engine"
        mock_file_svc_cls.return_value.upload_file.side_effect = services.errors.file.FileTooLargeError(
            description="max 10MB"
        )

        data = {"file": (BytesIO(b"big"), "big.txt")}
        with app.test_request_context("/files/upload", method="POST", data=data, content_type="multipart/form-data"):
            with pytest.raises(FileTooLargeError):
                FileApi().post(_app_model(), _end_user())
