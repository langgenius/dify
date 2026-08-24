from typing import cast
from unittest.mock import MagicMock

import pytest
from flask import Request
from werkzeug.exceptions import Unauthorized
from werkzeug.wrappers import Response

from constants import COOKIE_NAME_ACCESS_TOKEN, COOKIE_NAME_WEBAPP_ACCESS_TOKEN
from libs import token
from libs.token import extract_access_token, extract_webapp_access_token, set_csrf_token_to_cookie


class MockRequest:
    def __init__(
        self,
        headers: dict[str, str],
        cookies: dict[str, str],
        args: dict[str, str],
        path: str = "/console/api/test",
    ):
        self.headers: dict[str, str] = headers
        self.cookies: dict[str, str] = cookies
        self.args: dict[str, str] = args
        self.path = path


def test_extract_access_token():
    def _mock_request(headers: dict[str, str], cookies: dict[str, str], args: dict[str, str]) -> Request:
        return cast(Request, MockRequest(headers, cookies, args))

    test_cases = [
        (_mock_request({"Authorization": "Bearer 123"}, {}, {}), "123", "123"),
        (_mock_request({}, {COOKIE_NAME_ACCESS_TOKEN: "123"}, {}), "123", None),
        (_mock_request({}, {}, {}), None, None),
        (_mock_request({"Authorization": "Bearer_aaa 123"}, {}, {}), None, None),
        (_mock_request({}, {COOKIE_NAME_WEBAPP_ACCESS_TOKEN: "123"}, {}), None, "123"),
    ]
    for request, expected_console, expected_webapp in test_cases:
        assert extract_access_token(request) == expected_console
        assert extract_webapp_access_token(request) == expected_webapp


def test_real_cookie_name_uses_host_prefix_without_domain(config_overrides):
    config_overrides(
        CONSOLE_WEB_URL="https://console.example.com",
        CONSOLE_API_URL="https://api.example.com",
        COOKIE_DOMAIN="",
    )

    assert token._real_cookie_name("csrf_token") == "__Host-csrf_token"


def test_real_cookie_name_without_host_prefix_when_domain_present(config_overrides):
    config_overrides(
        CONSOLE_WEB_URL="https://console.example.com",
        CONSOLE_API_URL="https://api.example.com",
        COOKIE_DOMAIN=".example.com",
    )

    assert token._real_cookie_name("csrf_token") == "csrf_token"


def test_set_csrf_cookie_includes_domain_when_configured(config_overrides):
    config_overrides(
        CONSOLE_WEB_URL="https://console.example.com",
        CONSOLE_API_URL="https://api.example.com",
        COOKIE_DOMAIN=".example.com",
    )

    response = Response()
    request = MagicMock()

    set_csrf_token_to_cookie(request, response, "abc123")

    cookies = response.headers.getlist("Set-Cookie")
    assert any("csrf_token=abc123" in c for c in cookies)
    assert any("Domain=example.com" in c for c in cookies)
    assert all("__Host-" not in c for c in cookies)


def test_workflow_run_archive_download_file_bypasses_csrf():
    request = cast(
        Request,
        MockRequest(
            headers={},
            cookies={},
            args={},
            path="/console/api/workflow-run-archives/downloads/5923ce20291444af45f0580fb49f1cc9/file",
        ),
    )

    token.check_csrf_token(request, "account-1")


def test_non_whitelisted_path_requires_csrf():
    request = cast(Request, MockRequest(headers={}, cookies={}, args={}, path="/console/api/test"))

    with pytest.raises(Unauthorized):
        token.check_csrf_token(request, "account-1")


def test_admin_api_key_header_bypasses_csrf_when_console_cookie_is_present(config_overrides):
    config_overrides(
        ADMIN_API_KEY_ENABLE=True,
        ADMIN_API_KEY="admin-key",
        CONSOLE_WEB_URL="http://console.example.com",
        CONSOLE_API_URL="http://api.example.com",
        COOKIE_DOMAIN="",
    )
    request = cast(
        Request,
        MockRequest(
            headers={"Authorization": "Bearer admin-key"},
            cookies={COOKIE_NAME_ACCESS_TOKEN: "console-session"},
            args={},
        ),
    )

    token.check_csrf_token(request, "account-1")
