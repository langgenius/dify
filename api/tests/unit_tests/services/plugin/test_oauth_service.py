"""Tests for services.plugin.oauth_service.OAuthProxyService.

Covers: CSRF proxy context creation with Redis TTL, context consumption
with one-time use semantics, and validation error paths.
"""

from __future__ import annotations

import json
from unittest.mock import MagicMock, patch

import pytest

from services.plugin.oauth_service import OAuthProxyService


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
