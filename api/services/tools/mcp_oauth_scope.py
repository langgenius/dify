from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from core.mcp.types import OAuthMetadata, ProtectedResourceMetadata


class MCPConfiguredScopeError(ValueError):
    """The server requires scopes outside the configured client limit."""


def get_effective_scope(
    scope_from_www_auth: str | None,
    prm: ProtectedResourceMetadata | None,
    asm: OAuthMetadata | None,
    client_scope: str | None,
) -> str | None:
    """Select scopes without exceeding an explicit client configuration.

    A server challenge remains authoritative for the current request. Fail if
    it cannot be satisfied within the configured scope instead of expanding it.
    Without client configuration, retain the discovery precedence.
    """
    if scope_from_www_auth:
        if client_scope and not set(scope_from_www_auth.split()).issubset(client_scope.split()):
            raise MCPConfiguredScopeError("MCP server requires OAuth scopes outside the configured scope")
        return scope_from_www_auth

    if client_scope:
        return client_scope

    if prm and prm.scopes_supported:
        return " ".join(prm.scopes_supported)

    if asm and asm.scopes_supported:
        return " ".join(asm.scopes_supported)

    return client_scope
