"""Creators admission and OAuth use the configured client and explicit account identity."""

from collections.abc import Callable
from dataclasses import dataclass, field
from io import BytesIO
from typing import cast
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit
from zipfile import ZIP_DEFLATED, ZipFile

import httpx
import pytest

from services.app import creators_platform_gateway as gateway_module
from services.app.console_service import CreatorsPlatformDisabledError
from services.app.creators_platform_gateway import CreatorsPlatformGateway
from services.entities.oauth_server_entities import OAuthAuthorizationCode
from services.oauth_server_service import OAuthServerService


@pytest.fixture(autouse=True)
def creators_url(config_overrides: Callable[..., None]) -> None:
    config_overrides(CREATORS_PLATFORM_API_URL="https://creators.example.com/")


@dataclass
class OAuth:
    calls: list[tuple[str, str]] = field(default_factory=list)

    def issue_authorization_code(self, *, client_id: str, account_id: str) -> OAuthAuthorizationCode:
        self.calls.append((client_id, account_id))
        return OAuthAuthorizationCode(code="code + &")


@pytest.mark.parametrize("client_id", ["", "client"])
def test_gateway_uses_configured_oauth_client_and_encodes_redirect(
    config_overrides: Callable[..., None],
    client_id: str,
) -> None:
    config_overrides(CREATORS_PLATFORM_FEATURES_ENABLED=True, CREATORS_PLATFORM_OAUTH_CLIENT_ID=client_id)
    oauth = OAuth()
    gateway = gateway_module.CreatorsPlatformGateway(oauth=cast(OAuthServerService, oauth))
    gateway.require_enabled()
    code = gateway.authorize("actor")
    assert oauth.calls == ([("client", "actor")] if client_id else [])
    url = urlsplit(gateway.redirect_url("claim + &", code))
    assert url.path == ""
    assert parse_qs(url.query) == {
        "dsl_claim_code": ["claim + &"],
        **({"oauth_code": ["code + &"]} if client_id else {}),
    }


def test_gateway_rejects_disabled_feature(config_overrides: Callable[..., None]) -> None:
    config_overrides(CREATORS_PLATFORM_FEATURES_ENABLED=False)
    gateway = gateway_module.CreatorsPlatformGateway(oauth=cast(OAuthServerService, OAuth()))
    with pytest.raises(CreatorsPlatformDisabledError):
        gateway.require_enabled()


@pytest.fixture
def gateway() -> CreatorsPlatformGateway:
    return CreatorsPlatformGateway(oauth=cast(OAuthServerService, OAuth()))


def test_upload_sends_binary_package_as_multipart(
    gateway: CreatorsPlatformGateway, monkeypatch: pytest.MonkeyPatch
) -> None:
    source = BytesIO()
    with ZipFile(source, "w", compression=ZIP_DEFLATED) as archive:
        archive.writestr("manifest.yaml", "format: dify.app\nformat_version: 1\n")
        archive.writestr("app.yaml", "app:\n  mode: workflow\n")
    payload = source.getvalue()
    source.seek(0)
    requests: list[httpx.Request] = []

    def respond(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200, json={"data": {"claim_code": "claim"}})

    with source, httpx.Client(transport=httpx.MockTransport(respond)) as client:
        monkeypatch.setattr("core.helper.ssrf_proxy._get_ssrf_client", lambda _: client)
        assert gateway.upload(source, filename="example.ifpkg") == "claim"
        assert not source.closed

    assert len(requests) == 1
    request = requests[0]
    assert request.method == "POST"
    assert str(request.url) == "https://creators.example.com/api/v1/templates/anonymous-upload"
    assert request.headers["content-type"].startswith("multipart/form-data; boundary=")
    assert b'name="file"; filename="example.ifpkg"' in request.content
    assert b"Content-Type: application/octet-stream" in request.content
    assert payload in request.content
    assert request.extensions["timeout"] == {"connect": 5.0, "read": 30.0, "write": 30.0, "pool": 30.0}


@pytest.mark.parametrize("data", [None, {}, {"claim_code": ""}, {"claim_code": 123}])
def test_upload_rejects_invalid_claim_code(gateway: CreatorsPlatformGateway, data: object) -> None:
    response = httpx.Response(200, request=httpx.Request("POST", "https://creators.example.com"), json={"data": data})
    with (
        BytesIO(b"package") as source,
        patch("services.app.creators_platform_gateway.ssrf_proxy.post", return_value=response),
    ):
        with pytest.raises(ValueError, match="claim_code"):
            gateway.upload(source, filename="example.ifpkg")
        assert not source.closed


@pytest.mark.parametrize("failure", ["http", "network"])
def test_upload_propagates_failure_without_retry(gateway: CreatorsPlatformGateway, failure: str) -> None:
    attempts = 0

    def respond(request: httpx.Request) -> httpx.Response:
        nonlocal attempts
        attempts += 1
        if failure == "network":
            raise httpx.ConnectError("Connection failed", request=request)
        return httpx.Response(500)

    with (
        BytesIO(b"package") as source,
        httpx.Client(transport=httpx.MockTransport(respond)) as client,
        patch("core.helper.ssrf_proxy._get_ssrf_client", return_value=client),
    ):
        expected_error = httpx.ConnectError if failure == "network" else httpx.HTTPStatusError
        with pytest.raises(expected_error):
            gateway.upload(source, filename="example.ifpkg")
        assert not source.closed
    assert attempts == 1
