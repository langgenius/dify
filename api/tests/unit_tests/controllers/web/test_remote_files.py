"""Unit tests for controllers.web.remote_files endpoints."""

from __future__ import annotations

import urllib.parse
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from flask import Flask
from sqlalchemy import Engine

from controllers.common.errors import FileTooLargeError, RemoteFileUploadError
from controllers.web.remote_files import RemoteFileInfoApi, RemoteFileUploadApi
from extensions.storage.storage_type import StorageType
from models.enums import CreatorUserRole
from models.model import App, AppMode, EndUser, UploadFile
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


def _upload_file() -> UploadFile:
    upload_file = UploadFile(
        tenant_id="tenant-1",
        storage_type=StorageType.LOCAL,
        key="upload/file.pdf",
        name="file.pdf",
        size=100,
        extension="pdf",
        mime_type="application/pdf",
        created_by_role=CreatorUserRole.END_USER,
        created_by="eu-1",
        created_at=datetime(2024, 1, 1),
        used=False,
    )
    upload_file.id = "f-1"
    return upload_file


# ---------------------------------------------------------------------------
# RemoteFileInfoApi
# ---------------------------------------------------------------------------
class TestRemoteFileInfoApi:
    @patch("controllers.web.remote_files.remote_fetcher")
    def test_head_success(self, mock_proxy: MagicMock, app: Flask) -> None:
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.headers = {"Content-Type": "application/pdf", "Content-Length": "1024"}
        mock_proxy.make_request.return_value = mock_resp

        with app.test_request_context("/remote-files/https%3A%2F%2Fexample.com%2Ffile.pdf"):
            result = RemoteFileInfoApi().get(_app_model(), _end_user(), "https%3A%2F%2Fexample.com%2Ffile.pdf")

        assert result["file_type"] == "application/pdf"
        assert result["file_length"] == 1024
        mock_proxy.make_request.assert_called_once_with("HEAD", "https://example.com/file.pdf")

    @patch("controllers.web.remote_files.remote_fetcher")
    def test_preserves_unencoded_target_query(self, mock_proxy: MagicMock, app: Flask) -> None:
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.headers = {"Content-Type": "text/plain", "Content-Length": "128"}
        mock_proxy.make_request.return_value = mock_resp

        target_url = "http://example.com/api/aiagent/httpview/txt"
        query = "fileNameKey=cankao1_ce4305bc-be20-4c5d-8732-de1741d28e27"

        with app.test_request_context(f"/remote-files/{target_url}?{query}"):
            result = RemoteFileInfoApi().get(_app_model(), _end_user(), target_url)

        assert result["file_type"] == "text/plain"
        mock_proxy.make_request.assert_called_once_with("HEAD", f"{target_url}?{query}")

    @patch("controllers.web.remote_files.remote_fetcher")
    def test_preserves_encoded_target_query(self, mock_proxy: MagicMock, app: Flask) -> None:
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.headers = {"Content-Type": "text/plain", "Content-Length": "128"}
        mock_proxy.make_request.return_value = mock_resp

        target_url = "http://example.com/api/aiagent/httpview/txt?fileNameKey=cankao1"
        encoded_url = urllib.parse.quote(target_url, safe="")

        with app.test_request_context(f"/remote-files/{encoded_url}"):
            result = RemoteFileInfoApi().get(_app_model(), _end_user(), encoded_url)

        assert result["file_type"] == "text/plain"
        mock_proxy.make_request.assert_called_once_with("HEAD", target_url)

    @patch("controllers.web.remote_files.remote_fetcher")
    def test_fallback_to_get(self, mock_proxy: MagicMock, app: Flask) -> None:
        head_resp = MagicMock()
        head_resp.status_code = 405  # Method not allowed
        get_resp = MagicMock()
        get_resp.status_code = 200
        get_resp.headers = {"Content-Type": "text/plain", "Content-Length": "42"}
        get_resp.raise_for_status = MagicMock()
        mock_proxy.make_request.side_effect = [head_resp, get_resp]

        with app.test_request_context("/remote-files/https%3A%2F%2Fexample.com%2Ffile.txt"):
            result = RemoteFileInfoApi().get(_app_model(), _end_user(), "https%3A%2F%2Fexample.com%2Ffile.txt")

        assert result["file_type"] == "text/plain"
        assert mock_proxy.make_request.call_args_list[1].args == ("GET", "https://example.com/file.txt")


# ---------------------------------------------------------------------------
# RemoteFileUploadApi
# ---------------------------------------------------------------------------
class TestRemoteFileUploadApi:
    @patch("controllers.web.remote_files.file_helpers.get_signed_file_url", return_value="https://signed-url")
    @patch("controllers.web.remote_files.FileService")
    @patch("controllers.web.remote_files.helpers.guess_file_info_from_response")
    @patch("controllers.web.remote_files.remote_fetcher")
    @patch("controllers.web.remote_files.db")
    def test_upload_success(
        self,
        mock_db: MagicMock,
        mock_proxy: MagicMock,
        mock_guess: MagicMock,
        mock_file_svc_cls: MagicMock,
        mock_signed: MagicMock,
        app: Flask,
        sqlite_engine: Engine,
    ) -> None:
        mock_db.engine = sqlite_engine
        head_resp = MagicMock()
        head_resp.status_code = 200
        head_resp.content = b"pdf-content"
        head_resp.request.method = "HEAD"
        get_resp = MagicMock()
        get_resp.content = b"pdf-content"
        mock_proxy.make_request.side_effect = [head_resp, get_resp]

        mock_guess.return_value = SimpleNamespace(
            filename="file.pdf", extension="pdf", mimetype="application/pdf", size=100
        )
        mock_file_svc_cls.is_file_size_within_limit.return_value = True

        mock_file_svc_cls.return_value.upload_file.return_value = _upload_file()

        with app.test_request_context(
            "/remote-files/upload", method="POST", json={"url": "https://example.com/file.pdf"}
        ):
            result, status = RemoteFileUploadApi().post(_app_model(), _end_user())

        assert status == 201
        assert result["id"] == "f-1"

    @patch("controllers.web.remote_files.FileService.is_file_size_within_limit", return_value=False)
    @patch("controllers.web.remote_files.helpers.guess_file_info_from_response")
    @patch("controllers.web.remote_files.remote_fetcher")
    def test_file_too_large(
        self,
        mock_proxy: MagicMock,
        mock_guess: MagicMock,
        mock_size_check: MagicMock,
        app: Flask,
    ) -> None:
        head_resp = MagicMock()
        head_resp.status_code = 200
        mock_proxy.make_request.return_value = head_resp
        mock_guess.return_value = SimpleNamespace(
            filename="big.zip", extension="zip", mimetype="application/zip", size=999999999
        )

        with app.test_request_context(
            "/remote-files/upload", method="POST", json={"url": "https://example.com/big.zip"}
        ):
            with pytest.raises(FileTooLargeError):
                RemoteFileUploadApi().post(_app_model(), _end_user())

    @patch("controllers.web.remote_files.remote_fetcher")
    def test_fetch_failure_raises(self, mock_proxy: MagicMock, app: Flask) -> None:
        import httpx

        mock_proxy.make_request.side_effect = httpx.RequestError("connection failed")

        with app.test_request_context("/remote-files/upload", method="POST", json={"url": "https://example.com/bad"}):
            with pytest.raises(RemoteFileUploadError):
                RemoteFileUploadApi().post(_app_model(), _end_user())
