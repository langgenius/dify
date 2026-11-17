from __future__ import annotations

from unittest.mock import Mock, patch

import pytest

from core.mcp.auth_client import MCPClientWithAuthRetry
from core.mcp.error import MCPAuthError
from tests.helpers.unit.core.mcp.fixtures import make_provider


class TestForwardIdentityShortCircuit:
    def test_forward_identity_active_reraises_without_retry(self) -> None:
        client = MCPClientWithAuthRetry(
            server_url="https://mcp.example.com",
            headers={"Authorization": "Bearer user-jwt"},
            forward_identity_active=True,
        )

        with pytest.raises(MCPAuthError):
            client._handle_auth_error(MCPAuthError("unauthorized"))

        assert client.headers["Authorization"] == "Bearer user-jwt"
        assert client._has_retried is False

    def test_forward_identity_active_takes_precedence_over_provider_entity(self) -> None:
        sentinel_entity = object()
        client = MCPClientWithAuthRetry(
            server_url="https://mcp.example.com",
            provider_entity=sentinel_entity,  # type: ignore[arg-type]
            forward_identity_active=True,
        )

        with pytest.raises(MCPAuthError, match="forwarded-id-401"):
            client._handle_auth_error(MCPAuthError("forwarded-id-401"))

    def test_default_path_unchanged_without_provider_entity(self) -> None:
        client = MCPClientWithAuthRetry(server_url="https://mcp.example.com")
        with pytest.raises(MCPAuthError, match="no-provider"):
            client._handle_auth_error(MCPAuthError("no-provider"))

    def test_default_constructor_defaults_forward_identity_to_false(self) -> None:
        client = MCPClientWithAuthRetry(server_url="https://mcp.example.com")
        assert client.forward_identity_active is False

    def test_forwarded_401_does_not_resolve_or_refresh_workspace_oauth(self) -> None:
        client = MCPClientWithAuthRetry(
            server_url="https://mcp.example.com",
            headers={"Authorization": "Bearer workspace", "X-Dify-SSO-Token": "run-token"},
            provider_entity=make_provider({"access_token": "workspace", "refresh_token": "workspace-refresh"}),
            forward_identity_active=True,
        )
        operation = Mock(side_effect=MCPAuthError("forwarded-401"))
        with (
            patch("extensions.application_services.mcp.mcp_credential_service") as service,
            pytest.raises(MCPAuthError, match="forwarded-401"),
        ):
            client._execute_with_retry(operation)
        service.assert_not_called()
        operation.assert_called_once()
        assert client.headers == {"Authorization": "Bearer workspace", "X-Dify-SSO-Token": "run-token"}
