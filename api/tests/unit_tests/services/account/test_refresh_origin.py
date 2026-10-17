"""Refresh origin decisions are pure domain policy."""

import pytest

from services.account.refresh_origin import refresh_origin_requires_csrf


@pytest.mark.parametrize("origin", ["http://api.example", "http://API.example:80", "https://console.example:443"])
def test_exact_api_or_console_origin_needs_no_cookie_proof(origin: str) -> None:
    assert not refresh_origin_requires_csrf(
        origin, api_url="http://api.example/", console_web_url="https://console.example/path"
    )


@pytest.mark.parametrize("origin", ["https://api.example", "http://api.example:8080"])
def test_proxy_scheme_or_port_change_requires_cookie_proof(origin: str) -> None:
    assert refresh_origin_requires_csrf(origin, api_url="http://api.example/", console_web_url="")


@pytest.mark.parametrize(
    "origin",
    [
        "",
        "null",
        "https://untrusted.example",
        "https://api.example.untrusted.example",
        "https://api.example/",
        "https://api.example?query=1",
        "https://api.example#fragment",
        "https://user@api.example",
        "https://api.example:0",
        "https://api.example:65536",
        "https://api.example:bad",
        "https://api.example\n",
        "https://api.example https://console.example",
        "file://api.example",
        "https://[invalid",
    ],
)
def test_foreign_or_malformed_origin_is_rejected(origin: str) -> None:
    with pytest.raises(ValueError, match="trusted Origin"):
        refresh_origin_requires_csrf(origin, api_url="http://api.example/", console_web_url="https://console.example")


def test_invalid_configured_origin_does_not_authorize_a_request() -> None:
    with pytest.raises(ValueError, match="trusted Origin"):
        refresh_origin_requires_csrf("https://api.example", api_url="invalid", console_web_url="invalid")
