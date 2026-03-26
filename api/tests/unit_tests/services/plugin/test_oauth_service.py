"""Tests for services.plugin.oauth_service.OAuthProxyService.

Covers: CSRF proxy context creation with Redis TTL, context consumption
with one-time use semantics, and validation error paths.
"""

from __future__ import annotations

import json

import pytest

from services.plugin.oauth_service import OAuthProxyService


def _oauth_proxy_setex_calls(redis_client) -> list:
    return [call for call in redis_client.setex.call_args_list if call.args[0].startswith("oauth_proxy_context:")]


class TestCreateProxyContext:
    def test_stores_context_in_redis_with_ttl(self):
        context_id = OAuthProxyService.create_proxy_context(
            user_id="u1", tenant_id="t1", plugin_id="p1", provider="github"
        )

        assert context_id  # non-empty UUID string
        from extensions.ext_redis import redis_client

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

    def test_includes_credential_id_when_provided(self):
        OAuthProxyService.create_proxy_context(
            user_id="u1", tenant_id="t1", plugin_id="p1", provider="github", credential_id="cred-1"
        )

        from extensions.ext_redis import redis_client

        stored_data = json.loads(redis_client.setex.call_args[0][2])
        assert stored_data["credential_id"] == "cred-1"

    def test_excludes_credential_id_when_none(self):
        OAuthProxyService.create_proxy_context(user_id="u1", tenant_id="t1", plugin_id="p1", provider="github")

        from extensions.ext_redis import redis_client

        stored_data = json.loads(redis_client.setex.call_args[0][2])
        assert "credential_id" not in stored_data

    def test_includes_extra_data(self):
        OAuthProxyService.create_proxy_context(
            user_id="u1", tenant_id="t1", plugin_id="p1", provider="github", extra_data={"scope": "repo"}
        )

        from extensions.ext_redis import redis_client

        stored_data = json.loads(redis_client.setex.call_args[0][2])
        assert stored_data["scope"] == "repo"


class TestUseProxyContext:
    def test_raises_when_context_id_empty(self):
        with pytest.raises(ValueError, match="context_id is required"):
            OAuthProxyService.use_proxy_context("")

    def test_raises_when_context_not_found(self):
        from extensions.ext_redis import redis_client

        redis_client.get.return_value = None

        with pytest.raises(ValueError, match="context_id is invalid"):
            OAuthProxyService.use_proxy_context("nonexistent-id")

    def test_returns_data_and_deletes_key(self):
        from extensions.ext_redis import redis_client

        stored = {"user_id": "u1", "tenant_id": "t1", "plugin_id": "p1", "provider": "github"}
        redis_client.get.return_value = json.dumps(stored).encode()

        result = OAuthProxyService.use_proxy_context("valid-id")

        assert result == stored
        expected_key = "oauth_proxy_context:valid-id"
        redis_client.delete.assert_called_once_with(expected_key)
