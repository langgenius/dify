import pytest

from configs import dify_config
from services.oauth_resource import ACCEPTED_RESOURCE_PATHS, InvalidResourceError, openapi_issuer_url, resolve_resource

ISSUER = "https://dify.example.com/openapi/v1"


def test_issuer_prefers_console_api_url(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(dify_config, "CONSOLE_API_URL", "https://api.example.com/")

    assert openapi_issuer_url("https://request.example.com") == "https://api.example.com/openapi/v1"


def test_issuer_falls_back_to_request_origin(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(dify_config, "CONSOLE_API_URL", "")

    assert openapi_issuer_url("https://request.example.com/") == "https://request.example.com/openapi/v1"


def test_accepted_paths() -> None:
    assert ACCEPTED_RESOURCE_PATHS == ("/openapi/v1",)


@pytest.mark.parametrize("value", [None, ISSUER])
def test_resolves_to_issuer(value: str | None) -> None:
    assert resolve_resource(value, issuer=ISSUER) == ISSUER


@pytest.mark.parametrize(
    "value",
    [
        "https://dify.example.com",
        ISSUER + "/",
        ISSUER.upper(),
        "",
        "https://other.example.com/openapi/v1",
        ISSUER + "?a=1",
    ],
)
def test_rejects_everything_else(value: str) -> None:
    with pytest.raises(InvalidResourceError):
        resolve_resource(value, issuer=ISSUER)
