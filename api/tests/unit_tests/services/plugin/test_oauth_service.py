from __future__ import annotations

import json
from unittest.mock import MagicMock, patch

import httpx
import pytest
from werkzeug import Request

from core.plugin.impl import base as client_module
from core.plugin.impl.datasource import PluginDatasourceManager
from core.plugin.impl.dynamic_select import DynamicSelectClient
from core.plugin.impl.oauth import OAuthHandler
from services.plugin.oauth_service import OAuthProxyService

"""OAuth and credential transports preserve the prepared plugin package."""


PLUGIN_ID = "langgenius/example"
IDENTIFIER = f"{PLUGIN_ID}:1.0.0@{'a' * 32}"


@pytest.mark.parametrize("operation", ["authorize", "callback", "refresh", "dynamic", "validate"])
def test_dispatch_transports_preserve_package_and_credentials(monkeypatch: pytest.MonkeyPatch, operation: str) -> None:
    requests: list[httpx.Request] = []
    credentials = {"client_secret": "test-secret"}

    def handle(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        assert request.method == "POST"
        data: dict[str, object]
        if operation == "authorize":
            data = {"authorization_url": "https://example.com/authorize"}
        elif operation == "dynamic":
            data = {"options": []}
        elif operation == "validate":
            data = {"result": True}
        else:
            data = {"credentials": {"access_token": "test-token"}, "expires_at": -1}
        return httpx.Response(200, text="data: " + json.dumps({"code": 0, "message": "", "data": data}))

    with httpx.Client(transport=httpx.MockTransport(handle)) as client:
        monkeypatch.setattr(client_module, "_httpx_client", client)
        handler = OAuthHandler()
        if operation == "authorize":
            handler.get_authorization_url(
                "tenant",
                "user",
                PLUGIN_ID,
                "example",
                "https://example.com/callback",
                credentials,
                plugin_unique_identifier=IDENTIFIER,
            )
        elif operation == "callback":
            handler.get_credentials(
                "tenant",
                "user",
                PLUGIN_ID,
                "example",
                "https://example.com/callback",
                credentials,
                Request.from_values("/callback?code=test-code"),
                plugin_unique_identifier=IDENTIFIER,
            )
        elif operation == "refresh":
            handler.refresh_credentials(
                "tenant",
                "user",
                PLUGIN_ID,
                "example",
                "https://example.com/callback",
                credentials,
                {"refresh_token": "test-refresh"},
                plugin_unique_identifier=IDENTIFIER,
            )
        elif operation == "dynamic":
            DynamicSelectClient().fetch_dynamic_select_options(
                "tenant",
                "user",
                PLUGIN_ID,
                f"{PLUGIN_ID}/example",
                "fetch",
                credentials,
                "api-key",
                "option",
                plugin_unique_identifier=IDENTIFIER,
            )
        else:
            assert PluginDatasourceManager().validate_provider_credentials(
                "tenant", "user", "example", PLUGIN_ID, credentials, plugin_unique_identifier=IDENTIFIER
            )

    assert len(requests) == 1
    assert requests[0].headers["X-Plugin-ID"] == PLUGIN_ID
    assert requests[0].headers["X-Plugin-Unique-Identifier"] == IDENTIFIER
    payload = json.loads(requests[0].content)["data"]
    key = "credentials" if operation in ("dynamic", "validate") else "system_credentials"
    assert payload[key] == credentials


@pytest.mark.parametrize("expected_identifier", [None, IDENTIFIER])
def test_oauth_context_accepts_matching_provider_and_legacy_context(expected_identifier: str | None) -> None:
    context = {"plugin_id": PLUGIN_ID, "provider": "example", "plugin_unique_identifier": expected_identifier}
    OAuthProxyService.validate_plugin_context(
        context, plugin_id=PLUGIN_ID, provider="example", plugin_unique_identifier=IDENTIFIER
    )


@pytest.mark.parametrize(
    ("plugin_id", "provider", "identifier"),
    [
        ("langgenius/other", "example", IDENTIFIER),
        (PLUGIN_ID, "other", IDENTIFIER),
        (PLUGIN_ID, "example", f"{PLUGIN_ID}:2.0.0@{'b' * 32}"),
    ],
)
def test_oauth_context_rejects_provider_or_package_changes(plugin_id: str, provider: str, identifier: str) -> None:
    with pytest.raises(ValueError, match="another provider|Plugin changed"):
        OAuthProxyService.validate_plugin_context(
            {"plugin_id": PLUGIN_ID, "provider": "example", "plugin_unique_identifier": IDENTIFIER},
            plugin_id=plugin_id,
            provider=provider,
            plugin_unique_identifier=identifier,
        )


"""Tests for services.plugin.oauth_service.OAuthProxyService.

Covers: CSRF proxy context creation with Redis TTL, context consumption
with one-time use semantics, and validation error paths.
"""


def _redis_mock() -> MagicMock:
    from extensions.ext_redis import redis_client

    assert isinstance(redis_client, MagicMock)
    return redis_client


def _oauth_proxy_setex_calls(redis_client: MagicMock) -> list[tuple[tuple[str, int, str], dict[str, object]]]:
    return [call for call in redis_client.setex.call_args_list if call.args[0].startswith("oauth_proxy_context:")]


class TestCreateProxyContext:
    def test_stores_context_in_redis_with_ttl(self) -> None:
        context_id = OAuthProxyService.create_proxy_context(
            user_id="u1", tenant_id="t1", plugin_id="p1", provider="github"
        )

        assert context_id  # non-empty UUID string
        redis_client = _redis_mock()

        oauth_calls = _oauth_proxy_setex_calls(redis_client)
        assert len(oauth_calls) == 1
        call_args = oauth_calls[0]
        key = call_args[0][0]
        ttl = call_args[0][1]
        stored_data = json.loads(call_args[0][2])

        assert key.startswith("oauth_proxy_context:")
        assert ttl == 5 * 60
        assert stored_data["user_id"] == "u1"
        assert stored_data["tenant_id"] == "t1"
        assert stored_data["plugin_id"] == "p1"
        assert stored_data["provider"] == "github"

    def test_includes_credential_id_when_provided(self) -> None:
        OAuthProxyService.create_proxy_context(
            user_id="u1", tenant_id="t1", plugin_id="p1", provider="github", credential_id="cred-1"
        )

        redis_client = _redis_mock()

        stored_data = json.loads(redis_client.setex.call_args[0][2])
        assert stored_data["credential_id"] == "cred-1"

    def test_excludes_credential_id_when_none(self) -> None:
        OAuthProxyService.create_proxy_context(user_id="u1", tenant_id="t1", plugin_id="p1", provider="github")

        redis_client = _redis_mock()

        stored_data = json.loads(redis_client.setex.call_args[0][2])
        assert "credential_id" not in stored_data

    def test_includes_extra_data(self) -> None:
        OAuthProxyService.create_proxy_context(
            user_id="u1", tenant_id="t1", plugin_id="p1", provider="github", extra_data={"scope": "repo"}
        )

        redis_client = _redis_mock()

        stored_data = json.loads(redis_client.setex.call_args[0][2])
        assert stored_data["scope"] == "repo"


class TestUseProxyContext:
    def test_raises_when_context_id_empty(self) -> None:
        with pytest.raises(ValueError, match="context_id is required"):
            OAuthProxyService.use_proxy_context("")

    def test_raises_when_context_not_found(self) -> None:
        redis_client = _redis_mock()

        redis_client.get.return_value = None

        with pytest.raises(ValueError, match="context_id is invalid"):
            OAuthProxyService.use_proxy_context("nonexistent-id")

    def test_returns_data_and_deletes_key(self) -> None:
        redis_client = _redis_mock()

        stored = {"user_id": "u1", "tenant_id": "t1", "plugin_id": "p1", "provider": "github"}
        redis_client.get.return_value = json.dumps(stored).encode()

        with patch("services.plugin.oauth_service.redis_client.delete") as delete:
            result = OAuthProxyService.use_proxy_context("valid-id")

        assert result == stored
        expected_key = "oauth_proxy_context:valid-id"
        delete.assert_called_once_with(expected_key)

    def test_returns_context_with_credential_id(self) -> None:
        redis_client = _redis_mock()

        stored = {
            "user_id": "u1",
            "tenant_id": "t1",
            "plugin_id": "p1",
            "provider": "github",
            "credential_id": "cred-42",
        }
        redis_client.get.return_value = json.dumps(stored).encode()

        result = OAuthProxyService.use_proxy_context("ctx-with-cred")

        assert result["credential_id"] == "cred-42"
        assert result["tenant_id"] == "t1"
