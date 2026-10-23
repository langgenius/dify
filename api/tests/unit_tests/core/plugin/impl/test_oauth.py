import json
from io import BytesIO
from types import SimpleNamespace

import pytest
from pytest_mock import MockerFixture
from werkzeug import Request
from werkzeug.datastructures import Headers
from werkzeug.test import EnvironBuilder

from core.plugin.impl.oauth import OAuthHandler


def _build_request(body: bytes = b"payload") -> Request:
    environ = {
        "REQUEST_METHOD": "POST",
        "PATH_INFO": "/oauth/callback",
        "QUERY_STRING": "code=123",
        "SERVER_NAME": "localhost",
        "SERVER_PORT": "80",
        "wsgi.input": BytesIO(body),
        "wsgi.url_scheme": "http",
        "CONTENT_LENGTH": str(len(body)),
        "HTTP_HOST": "localhost",
        "SERVER_PROTOCOL": "HTTP/1.1",
        "HTTP_X_TEST": "yes",
    }
    return Request(environ)


class TestOAuthHandler:
    def test_get_authorization_url(self, mocker: MockerFixture):
        handler = OAuthHandler()
        stream_mock = mocker.patch.object(
            handler,
            "_request_with_plugin_daemon_response_stream",
            return_value=iter([SimpleNamespace(authorization_url="https://auth.example.com")]),
        )

        response = handler.get_authorization_url(
            tenant_id="tenant-1",
            user_id="user-1",
            plugin_id="org/plugin",
            provider="provider",
            redirect_uri="https://dify.example.com/callback",
            system_credentials={"client_id": "id"},
        )

        assert response.authorization_url == "https://auth.example.com"
        assert stream_mock.call_count == 1

    def test_get_authorization_url_no_response_raises(self, mocker: MockerFixture):
        handler = OAuthHandler()
        mocker.patch.object(handler, "_request_with_plugin_daemon_response_stream", return_value=iter([]))

        with pytest.raises(ValueError, match="Error getting authorization URL"):
            handler.get_authorization_url(
                tenant_id="tenant-1",
                user_id="user-1",
                plugin_id="org/plugin",
                provider="provider",
                redirect_uri="https://dify.example.com/callback",
                system_credentials={},
            )

    def test_get_credentials(self, mocker: MockerFixture):
        handler = OAuthHandler()
        captured_data = {}

        def fake_stream[**P](*args: P.args, **kwargs: P.kwargs):
            captured_data.update(kwargs["data"])
            return iter([SimpleNamespace(credentials={"token": "abc"}, metadata={}, expires_at=1)])

        stream_mock = mocker.patch.object(
            handler, "_request_with_plugin_daemon_response_stream", side_effect=fake_stream
        )

        response = handler.get_credentials(
            tenant_id="tenant-1",
            user_id="user-1",
            plugin_id="org/plugin",
            provider="provider",
            redirect_uri="https://dify.example.com/callback",
            system_credentials={"client_id": "id"},
            request=_build_request(),
        )

        assert response.credentials == {"token": "abc"}
        assert "raw_http_request" in captured_data["data"]
        assert stream_mock.call_count == 1

    def test_get_credentials_no_response_raises(self, mocker: MockerFixture):
        handler = OAuthHandler()
        mocker.patch.object(handler, "_request_with_plugin_daemon_response_stream", return_value=iter([]))

        with pytest.raises(ValueError, match="Error getting credentials"):
            handler.get_credentials(
                tenant_id="tenant-1",
                user_id="user-1",
                plugin_id="org/plugin",
                provider="provider",
                redirect_uri="https://dify.example.com/callback",
                system_credentials={},
                request=_build_request(),
            )

    def test_refresh_credentials(self, mocker: MockerFixture):
        handler = OAuthHandler()
        stream_mock = mocker.patch.object(
            handler,
            "_request_with_plugin_daemon_response_stream",
            return_value=iter([SimpleNamespace(credentials={"token": "new"}, metadata={}, expires_at=1)]),
        )

        response = handler.refresh_credentials(
            tenant_id="tenant-1",
            user_id="user-1",
            plugin_id="org/plugin",
            provider="provider",
            redirect_uri="https://dify.example.com/callback",
            system_credentials={"client_id": "id"},
            credentials={"refresh_token": "r"},
        )

        assert response.credentials == {"token": "new"}
        assert stream_mock.call_count == 1

    def test_refresh_credentials_no_response_raises(self, mocker: MockerFixture):
        handler = OAuthHandler()
        mocker.patch.object(handler, "_request_with_plugin_daemon_response_stream", return_value=iter([]))

        with pytest.raises(ValueError, match="Error refreshing credentials"):
            handler.refresh_credentials(
                tenant_id="tenant-1",
                user_id="user-1",
                plugin_id="org/plugin",
                provider="provider",
                redirect_uri="https://dify.example.com/callback",
                system_credentials={},
                credentials={},
            )

    def test_convert_request_to_raw_data(self):
        handler = OAuthHandler()
        request = _build_request(b"body-data")

        raw = handler._convert_request_to_raw_data(request)

        assert raw.startswith(b"POST /oauth/callback?code=123 HTTP/1.1\r\n")
        assert b"X-Test: yes\r\n" in raw
        assert raw.endswith(b"body-data")


def test_oauth_convert_request_to_raw_data() -> None:
    oauth_handler = OAuthHandler()
    builder = EnvironBuilder(
        method="GET",
        path="/test",
        headers=Headers({"Content-Type": "application/json"}),
    )
    request = Request(builder.get_environ())
    raw_request_bytes = oauth_handler._convert_request_to_raw_data(request)

    assert b"GET /test? HTTP/1.1" in raw_request_bytes
    assert b"Content-Type: application/json" in raw_request_bytes
    assert b"\r\n\r\n" in raw_request_bytes


def test_oauth_convert_request_to_raw_data_with_query_params() -> None:
    oauth_handler = OAuthHandler()
    builder = EnvironBuilder(
        method="GET",
        path="/test",
        query_string="code=abc123&state=xyz789",
        headers=Headers({"Content-Type": "application/json"}),
    )
    request = Request(builder.get_environ())
    raw_request_bytes = oauth_handler._convert_request_to_raw_data(request)

    assert b"GET /test?code=abc123&state=xyz789 HTTP/1.1" in raw_request_bytes
    assert b"Content-Type: application/json" in raw_request_bytes
    assert b"\r\n\r\n" in raw_request_bytes


def test_oauth_convert_request_to_raw_data_with_post_body() -> None:
    oauth_handler = OAuthHandler()
    builder = EnvironBuilder(
        method="POST",
        path="/test",
        data="param1=value1&param2=value2",
        headers=Headers({"Content-Type": "application/x-www-form-urlencoded"}),
    )
    request = Request(builder.get_environ())
    raw_request_bytes = oauth_handler._convert_request_to_raw_data(request)

    assert b"POST /test? HTTP/1.1" in raw_request_bytes
    assert b"Content-Type: application/x-www-form-urlencoded" in raw_request_bytes
    assert b"\r\n\r\n" in raw_request_bytes
    assert b"param1=value1&param2=value2" in raw_request_bytes


def test_oauth_convert_request_to_raw_data_with_json_body() -> None:
    oauth_handler = OAuthHandler()
    json_data = {"code": "abc123", "state": "xyz789", "grant_type": "authorization_code"}
    builder = EnvironBuilder(
        method="POST",
        path="/test",
        data=json.dumps(json_data),
        headers=Headers({"Content-Type": "application/json"}),
    )
    request = Request(builder.get_environ())
    raw_request_bytes = oauth_handler._convert_request_to_raw_data(request)

    assert b"POST /test? HTTP/1.1" in raw_request_bytes
    assert b"Content-Type: application/json" in raw_request_bytes
    assert b"\r\n\r\n" in raw_request_bytes
    assert b'"code": "abc123"' in raw_request_bytes
    assert b'"state": "xyz789"' in raw_request_bytes
    assert b'"grant_type": "authorization_code"' in raw_request_bytes
