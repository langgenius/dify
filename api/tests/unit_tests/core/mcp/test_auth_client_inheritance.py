from __future__ import annotations

import pytest

from core.mcp.auth_client import MCPClientWithAuthRetry
from core.mcp.error import MCPAuthError


class TestForwardIdentityShortCircuit:
    def test_forward_identity_active_reraises_without_retry(self):
        client = MCPClientWithAuthRetry(
            server_url="https://mcp.example.com",
            headers={"Authorization": "Bearer user-jwt"},
            forward_identity_active=True,
        )

        with pytest.raises(MCPAuthError):
            client._handle_auth_error(MCPAuthError("unauthorized"))

        assert client.headers["Authorization"] == "Bearer user-jwt"
        assert client._has_retried is False

    def test_forward_identity_active_takes_precedence_over_provider_entity(self):
        sentinel_entity = object()
        client = MCPClientWithAuthRetry(
            server_url="https://mcp.example.com",
            provider_entity=sentinel_entity,  # type: ignore[arg-type]
            forward_identity_active=True,
        )

        with pytest.raises(MCPAuthError, match="forwarded-id-401"):
            client._handle_auth_error(MCPAuthError("forwarded-id-401"))

    def test_default_path_unchanged_without_provider_entity(self):
        client = MCPClientWithAuthRetry(server_url="https://mcp.example.com")
        with pytest.raises(MCPAuthError, match="no-provider"):
            client._handle_auth_error(MCPAuthError("no-provider"))

    def test_default_constructor_defaults_forward_identity_to_false(self):
        client = MCPClientWithAuthRetry(server_url="https://mcp.example.com")
        assert client.forward_identity_active is False
