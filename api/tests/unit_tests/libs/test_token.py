from unittest.mock import MagicMock

from werkzeug.wrappers import Response

from constants import COOKIE_NAME_ACCESS_TOKEN, COOKIE_NAME_WEBAPP_ACCESS_TOKEN
from libs import token
from libs.token import extract_access_token, extract_webapp_access_token, set_csrf_token_to_cookie


class MockRequest:
    def __init__(self, headers: dict[str, str], cookies: dict[str, str], args: dict[str, str]):
        self.headers: dict[str, str] = headers
        self.cookies: dict[str, str] = cookies
        self.args: dict[str, str] = args


def test_extract_access_token():
    def _mock_request(headers: dict[str, str], cookies: dict[str, str], args: dict[str, str]):
        return MockRequest(headers, cookies, args)

    test_cases = [
        (_mock_request({"Authorization": "Bearer 123"}, {}, {}), "123", "123"),
        (_mock_request({}, {COOKIE_NAME_ACCESS_TOKEN: "123"}, {}), "123", None),
        (_mock_request({}, {}, {}), None, None),
        (_mock_request({"Authorization": "Bearer_aaa 123"}, {}, {}), None, None),
        (_mock_request({}, {COOKIE_NAME_WEBAPP_ACCESS_TOKEN: "123"}, {}), None, "123"),
    ]
    for request, expected_console, expected_webapp in test_cases:
        assert extract_access_token(request) == expected_console  # pyright: ignore[reportArgumentType]
        assert extract_webapp_access_token(request) == expected_webapp  # pyright: ignore[reportArgumentType]


def test_real_cookie_name_uses_host_prefix_without_domain(monkeypatch):
    monkeypatch.setattr(token.dify_config, "CONSOLE_WEB_URL", "https://console.example.com", raising=False)
    monkeypatch.setattr(token.dify_config, "CONSOLE_API_URL", "https://api.example.com", raising=False)
    monkeypatch.setattr(token.dify_config, "COOKIE_DOMAIN", "", raising=False)

    assert token._real_cookie_name("csrf_token") == "__Host-csrf_token"


def test_real_cookie_name_without_host_prefix_when_domain_present(monkeypatch):
    monkeypatch.setattr(token.dify_config, "CONSOLE_WEB_URL", "https://console.example.com", raising=False)
    monkeypatch.setattr(token.dify_config, "CONSOLE_API_URL", "https://api.example.com", raising=False)
    monkeypatch.setattr(token.dify_config, "COOKIE_DOMAIN", ".example.com", raising=False)

    assert token._real_cookie_name("csrf_token") == "csrf_token"


def test_set_csrf_cookie_includes_domain_when_configured(monkeypatch):
    monkeypatch.setattr(token.dify_config, "CONSOLE_WEB_URL", "https://console.example.com", raising=False)
    monkeypatch.setattr(token.dify_config, "CONSOLE_API_URL", "https://api.example.com", raising=False)
    monkeypatch.setattr(token.dify_config, "COOKIE_DOMAIN", ".example.com", raising=False)

    response = Response()
    request = MagicMock()

    set_csrf_token_to_cookie(request, response, "abc123")

    cookies = response.headers.getlist("Set-Cookie")
    assert any("csrf_token=abc123" in c for c in cookies)
    assert any("Domain=example.com" in c for c in cookies)
    assert all("__Host-" not in c for c in cookies)
