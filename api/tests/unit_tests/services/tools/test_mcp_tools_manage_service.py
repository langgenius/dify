"""Unit tests for MCPToolManageService.get_provider dual-form dispatch.

The fix in https://github.com/langgenius/dify/issues/41512 lets callers pass
either a provider UUID or the human-readable `server_identifier` as
`provider_id`. PostgreSQL would otherwise reject a non-UUID path segment with
`invalid input syntax for type uuid` and surface as HTTP 500 from
`ToolMCPDetailApi` and sibling console routes.
"""

from __future__ import annotations

from uuid import uuid4

import pytest
from sqlalchemy.orm import Session

from models.tools import MCPToolProvider
from services.tools.mcp_tools_manage_service import MCPToolManageService


def _persist_provider(
    session: Session,
    *,
    server_identifier: str = "my-mcp-tools",
    name: str = "My MCP Tools",
    tenant_id: str = "tenant-1",
) -> MCPToolProvider:
    provider = MCPToolProvider(
        name=name,
        server_identifier=server_identifier,
        server_url="https://example.com",
        server_url_hash=f"hash-{server_identifier}",
        icon="icon",
        tenant_id=tenant_id,
        user_id="user-1",
    )
    session.add(provider)
    session.flush()
    return provider


def test_get_provider_resolves_uuid(sqlite_session: Session) -> None:
    provider = _persist_provider(sqlite_session, server_identifier="my-mcp-tools", name="MCP A")
    service = MCPToolManageService(session=sqlite_session)

    result = service.get_provider(provider_id=provider.id, tenant_id="tenant-1")

    assert result.id == provider.id
    assert result.server_identifier == "my-mcp-tools"


def test_get_provider_resolves_server_identifier_via_provider_id(sqlite_session: Session) -> None:
    """A non-UUID `provider_id` must dispatch to the server_identifier branch."""
    _persist_provider(sqlite_session, server_identifier="my-mcp-tools", name="MCP A")
    service = MCPToolManageService(session=sqlite_session)

    result = service.get_provider(provider_id="my-mcp-tools", tenant_id="tenant-1")

    assert result.server_identifier == "my-mcp-tools"


def test_get_provider_explicit_server_identifier_takes_precedence(sqlite_session: Session) -> None:
    """When both args are passed, the explicit `server_identifier` is honored."""
    provider_uuid = str(uuid4())
    other = _persist_provider(sqlite_session, server_identifier="real-identifier", name="MCP B")
    _persist_provider(
        sqlite_session,
        server_identifier="other-identifier",
        name="MCP C",
    )
    service = MCPToolManageService(session=sqlite_session)

    result = service.get_provider(
        provider_id=provider_uuid,
        server_identifier="real-identifier",
        tenant_id="tenant-1",
    )

    assert result.id == other.id
    assert result.server_identifier == "real-identifier"


def test_get_provider_missing_server_identifier_raises(sqlite_session: Session) -> None:
    service = MCPToolManageService(session=sqlite_session)

    with pytest.raises(ValueError, match="MCP tool not found"):
        service.get_provider(provider_id="does-not-exist", tenant_id="tenant-1")


def test_get_provider_missing_uuid_raises(sqlite_session: Session) -> None:
    service = MCPToolManageService(session=sqlite_session)

    with pytest.raises(ValueError, match="MCP tool not found"):
        service.get_provider(provider_id=str(uuid4()), tenant_id="tenant-1")


def test_get_provider_cross_tenant_isolation_on_server_identifier(sqlite_session: Session) -> None:
    """A server_identifier match in another tenant must not leak across tenants."""
    _persist_provider(
        sqlite_session,
        server_identifier="shared-id",
        tenant_id="tenant-a",
        name="Tenant A",
    )
    _persist_provider(
        sqlite_session,
        server_identifier="shared-id",
        tenant_id="tenant-b",
        name="Tenant B",
    )
    service = MCPToolManageService(session=sqlite_session)

    result_a = service.get_provider(provider_id="shared-id", tenant_id="tenant-a")
    result_b = service.get_provider(provider_id="shared-id", tenant_id="tenant-b")

    assert result_a.tenant_id == "tenant-a"
    assert result_b.tenant_id == "tenant-b"
    assert result_a.id != result_b.id
