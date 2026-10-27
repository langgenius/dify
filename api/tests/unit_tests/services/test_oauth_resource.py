import pytest

from configs import dify_config
from services.oauth_resource import InvalidResourceError, openapi_issuer_url, resolve_resource

ISSUER = "https://dify.example.com/openapi/v1"


@pytest.mark.parametrize(
    ("console_api_url", "expected"),
    [
        ("https://api.example.com/", "https://api.example.com/openapi/v1"),
        ("", "https://request.example.com/openapi/v1"),
    ],
)
def test_issuer_prefers_console_api_url_over_request_origin(
    monkeypatch: pytest.MonkeyPatch, console_api_url: str, expected: str
) -> None:
    monkeypatch.setattr(dify_config, "CONSOLE_API_URL", console_api_url)

    assert openapi_issuer_url("https://request.example.com/") == expected


@pytest.mark.parametrize("value", [None, ISSUER])
def test_resolves_to_issuer(value: str | None) -> None:
    assert resolve_resource(value, issuer=ISSUER) == ISSUER


@pytest.mark.parametrize("value", ["https://dify.example.com", ISSUER + "/", "https://other.example.com/openapi/v1"])
def test_rejects_everything_else(value: str) -> None:
    with pytest.raises(InvalidResourceError):
        resolve_resource(value, issuer=ISSUER)
