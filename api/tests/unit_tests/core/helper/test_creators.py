"""Tests for the Creators Platform helper module."""

from collections.abc import Callable
from io import BytesIO
from unittest.mock import patch
from zipfile import ZIP_DEFLATED, ZipFile

import httpx
import pytest

from core.helper import creators


class TestGetRedirectUrl:
    def test_without_oauth_code(self, config_overrides: Callable[..., None]) -> None:
        config_overrides(
            CREATORS_PLATFORM_API_URL="https://creators.example.com",
        )

        from core.helper.creators import get_redirect_url

        url = get_redirect_url("claim-abc")

        assert "dsl_claim_code=claim-abc" in url
        assert "oauth_code" not in url
        assert url.startswith("https://creators.example.com")

    def test_with_oauth_code(self, config_overrides: Callable[..., None]) -> None:
        config_overrides(
            CREATORS_PLATFORM_API_URL="https://creators.example.com",
        )

        from core.helper.creators import get_redirect_url

        url = get_redirect_url("claim-abc", oauth_code="oauth-code-123")

        assert "dsl_claim_code=claim-abc" in url
        assert "oauth_code=oauth-code-123" in url

    def test_strips_trailing_slash(self, config_overrides: Callable[..., None]) -> None:
        config_overrides(
            CREATORS_PLATFORM_API_URL="https://creators.example.com/",
        )

        from core.helper.creators import get_redirect_url

        url = get_redirect_url("claim-abc")

        assert url.startswith("https://creators.example.com?")
        assert "creators.example.com/?" not in url


@pytest.fixture(autouse=True)
def creators_url(config_overrides: Callable[..., None]) -> None:
    config_overrides(CREATORS_PLATFORM_API_URL="https://creators.example.com/")


def test_upload_sends_binary_package_as_multipart(monkeypatch: pytest.MonkeyPatch) -> None:
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
        assert creators.upload_package(source, filename="example.ifpkg") == "claim"
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
def test_upload_rejects_invalid_claim_code(data: object) -> None:
    response = httpx.Response(200, request=httpx.Request("POST", "https://creators.example.com"), json={"data": data})
    with (
        BytesIO(b"package") as source,
        patch("core.helper.creators.ssrf_proxy.post", return_value=response),
    ):
        with pytest.raises(ValueError, match="claim_code"):
            creators.upload_package(source, filename="example.ifpkg")
        assert not source.closed


@pytest.mark.parametrize("failure", ["http", "network"])
def test_upload_propagates_failure_without_retry(failure: str) -> None:
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
            creators.upload_package(source, filename="example.ifpkg")
        assert not source.closed
    assert attempts == 1
