"""Tests for remote file upload API endpoints using Flask-RESTX."""

import contextlib
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import Mock, patch

import httpx
import pytest
from flask import Flask, g


@pytest.fixture
def app() -> Flask:
    """Create Flask app for testing."""
    app = Flask(__name__)
    app.config["TESTING"] = True
    app.config["SECRET_KEY"] = "test-secret-key"
    return app


@pytest.fixture
def client(app):
    """Create test client with console blueprint registered."""
    from controllers.console import bp

    app.register_blueprint(bp)
    return app.test_client()


@pytest.fixture
def mock_account():
    """Create a mock account for testing."""
    from models import Account

    account = Mock(spec=Account)
    account.id = "test-account-id"
    account.current_tenant_id = "test-tenant-id"
    return account


@pytest.fixture
def auth_ctx(app, mock_account):
    """Context manager to set auth/tenant context in flask.g for a request."""

    @contextlib.contextmanager
    def _ctx():
        with app.test_request_context():
            g._login_user = mock_account
            g._current_tenant = mock_account.current_tenant_id
            yield

    return _ctx


class TestGetRemoteFileInfo:
    """Test GET /console/api/remote-files/<path:url> endpoint."""

    def test_get_remote_file_info_success(self, app, client, mock_account):
        """Test successful retrieval of remote file info."""
        response = httpx.Response(
            200,
            request=httpx.Request("HEAD", "http://example.com/file.txt"),
            headers={"Content-Type": "text/plain", "Content-Length": "1024"},
        )

        with (
            patch(
                "controllers.console.remote_files.current_account_with_tenant",
                return_value=(mock_account, "test-tenant-id"),
            ),
            patch("controllers.console.remote_files.ssrf_proxy.head", return_value=response),
            patch("libs.login.check_csrf_token", return_value=None),
        ):
            with app.test_request_context():
                g._login_user = mock_account
                g._current_tenant = mock_account.current_tenant_id
                encoded_url = "http%3A%2F%2Fexample.com%2Ffile.txt"
                resp = client.get(f"/console/api/remote-files/{encoded_url}")

        assert resp.status_code == 200
        data = resp.get_json()
        assert data["file_type"] == "text/plain"
        assert data["file_length"] == 1024

    def test_get_remote_file_info_fallback_to_get_on_head_failure(self, app, client, mock_account):
        """Test fallback to GET when HEAD returns non-200 status."""
        head_response = httpx.Response(
            404,
            request=httpx.Request("HEAD", "http://example.com/file.pdf"),
        )
        get_response = httpx.Response(
            200,
            request=httpx.Request("GET", "http://example.com/file.pdf"),
            headers={"Content-Type": "application/pdf", "Content-Length": "2048"},
        )

        with (
            patch(
                "controllers.console.remote_files.current_account_with_tenant",
                return_value=(mock_account, "test-tenant-id"),
            ),
            patch("controllers.console.remote_files.ssrf_proxy.head", return_value=head_response),
            patch("controllers.console.remote_files.ssrf_proxy.get", return_value=get_response),
            patch("libs.login.check_csrf_token", return_value=None),
        ):
            with app.test_request_context():
                g._login_user = mock_account
                g._current_tenant = mock_account.current_tenant_id
                encoded_url = "http%3A%2F%2Fexample.com%2Ffile.pdf"
                resp = client.get(f"/console/api/remote-files/{encoded_url}")

        assert resp.status_code == 200
        data = resp.get_json()
        assert data["file_type"] == "application/pdf"
        assert data["file_length"] == 2048


class TestRemoteFileUpload:
    """Test POST /console/api/remote-files/upload endpoint."""

    @pytest.mark.parametrize(
        ("head_status", "use_get"),
        [
            (200, False),  # HEAD succeeds
            (405, True),  # HEAD fails -> fallback GET
        ],
    )
    def test_upload_remote_file_success_paths(self, client, mock_account, auth_ctx, head_status, use_get):
        url = "http://example.com/file.pdf"
        head_resp = httpx.Response(
            head_status,
            request=httpx.Request("HEAD", url),
            headers={"Content-Type": "application/pdf", "Content-Length": "1024"},
        )
        get_resp = httpx.Response(
            200,
            request=httpx.Request("GET", url),
            headers={"Content-Type": "application/pdf", "Content-Length": "1024"},
            content=b"file content",
        )

        file_info = SimpleNamespace(
            extension="pdf",
            size=1024,
            filename="file.pdf",
            mimetype="application/pdf",
        )
        uploaded_file = SimpleNamespace(
            id="uploaded-file-id",
            name="file.pdf",
            size=1024,
            extension="pdf",
            mime_type="application/pdf",
            created_by="test-account-id",
            created_at=datetime(2024, 1, 1, 12, 0, 0),
        )

        with (
            patch(
                "controllers.console.remote_files.current_account_with_tenant",
                return_value=(mock_account, "test-tenant-id"),
            ),
            patch("controllers.console.remote_files.ssrf_proxy.head", return_value=head_resp) as p_head,
            patch("controllers.console.remote_files.ssrf_proxy.get", return_value=get_resp) as p_get,
            patch(
                "controllers.console.remote_files.helpers.guess_file_info_from_response",
                return_value=file_info,
            ),
            patch(
                "controllers.console.remote_files.FileService.is_file_size_within_limit",
                return_value=True,
            ),
            patch("controllers.console.remote_files.db", spec=["engine"]),
            patch("controllers.console.remote_files.FileService") as mock_file_service,
            patch(
                "controllers.console.remote_files.file_helpers.get_signed_file_url",
                return_value="http://example.com/signed-url",
            ),
            patch("libs.login.check_csrf_token", return_value=None),
        ):
            mock_file_service.return_value.upload_file.return_value = uploaded_file

            with auth_ctx():
                resp = client.post(
                    "/console/api/remote-files/upload",
                    json={"url": url},
                )

        assert resp.status_code == 201
        p_head.assert_called_once()
        # GET is used either for fallback (HEAD fails) or to fetch content after HEAD succeeds
        p_get.assert_called_once()
        mock_file_service.return_value.upload_file.assert_called_once()

        data = resp.get_json()
        assert data["id"] == "uploaded-file-id"
        assert data["name"] == "file.pdf"
        assert data["size"] == 1024
        assert data["extension"] == "pdf"
        assert data["url"] == "http://example.com/signed-url"
        assert data["mime_type"] == "application/pdf"
        assert data["created_by"] == "test-account-id"

    @pytest.mark.parametrize(
        ("size_ok", "raises", "expected_status", "expected_msg"),
        [
            # When size check fails in controller, API returns 413 with message "File size exceeded..."
            (False, None, 413, "file size exceeded"),
            # When service raises unsupported type, controller maps to 415 with message "File type not allowed."
            (True, "unsupported", 415, "file type not allowed"),
        ],
    )
    def test_upload_remote_file_errors(
        self, client, mock_account, auth_ctx, size_ok, raises, expected_status, expected_msg
    ):
        url = "http://example.com/x.pdf"
        head_resp = httpx.Response(
            200,
            request=httpx.Request("HEAD", url),
            headers={"Content-Type": "application/pdf", "Content-Length": "9"},
        )
        file_info = SimpleNamespace(extension="pdf", size=9, filename="x.pdf", mimetype="application/pdf")

        with (
            patch(
                "controllers.console.remote_files.current_account_with_tenant",
                return_value=(mock_account, "test-tenant-id"),
            ),
            patch("controllers.console.remote_files.ssrf_proxy.head", return_value=head_resp),
            patch(
                "controllers.console.remote_files.helpers.guess_file_info_from_response",
                return_value=file_info,
            ),
            patch(
                "controllers.console.remote_files.FileService.is_file_size_within_limit",
                return_value=size_ok,
            ),
            patch("controllers.console.remote_files.db", spec=["engine"]),
            patch("libs.login.check_csrf_token", return_value=None),
        ):
            if raises == "unsupported":
                from services.errors.file import UnsupportedFileTypeError

                with patch("controllers.console.remote_files.FileService") as mock_file_service:
                    mock_file_service.return_value.upload_file.side_effect = UnsupportedFileTypeError("bad")
                    with auth_ctx():
                        resp = client.post(
                            "/console/api/remote-files/upload",
                            json={"url": url},
                        )
            else:
                with auth_ctx():
                    resp = client.post(
                        "/console/api/remote-files/upload",
                        json={"url": url},
                    )

        assert resp.status_code == expected_status
        data = resp.get_json()
        msg = (data.get("error") or {}).get("message") or data.get("message", "")
        assert expected_msg in msg.lower()

    def test_upload_remote_file_fetch_failure(self, client, mock_account, auth_ctx):
        """Test upload when fetching of remote file fails."""
        with (
            patch(
                "controllers.console.remote_files.current_account_with_tenant",
                return_value=(mock_account, "test-tenant-id"),
            ),
            patch(
                "controllers.console.remote_files.ssrf_proxy.head",
                side_effect=httpx.RequestError("Connection failed"),
            ),
            patch("libs.login.check_csrf_token", return_value=None),
        ):
            with auth_ctx():
                resp = client.post(
                    "/console/api/remote-files/upload",
                    json={"url": "http://unreachable.com/file.pdf"},
                )

        assert resp.status_code == 400
        data = resp.get_json()
        msg = (data.get("error") or {}).get("message") or data.get("message", "")
        assert "failed to fetch" in msg.lower()
