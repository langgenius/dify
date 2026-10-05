"""Test cases for MCP provider lookups.

The two lookups are deliberately separate: `provider_id` always means the
primary key and `server_identifier` always means the tenant-scoped identifier,
so a value can never silently resolve through the wrong column.
"""

from unittest.mock import Mock

import pytest

from models.tools import MCPToolProvider
from services.tools.mcp_tools_manage_service import MCPToolManageService

PROVIDER_UUID = "0b2bd1e4-3a7d-4a0b-9f2a-9b2d6f3c1e55"
SERVER_IDENTIFIER = "monday_mcp"
TENANT_ID = "3f0a1c4e-1f3d-4a4e-9a1f-2a6f8c5d0b11"


def _provider() -> MCPToolProvider:
    return MCPToolProvider(
        name="Monday",
        server_identifier=SERVER_IDENTIFIER,
        server_url="https://example.com/mcp",
        server_url_hash="hash",
        icon="icon",
        tenant_id=TENANT_ID,
        user_id="user-id",
    )


@pytest.fixture
def session() -> Mock:
    return Mock()


@pytest.fixture
def service(session: Mock) -> MCPToolManageService:
    return MCPToolManageService(session=session)


def test_get_provider_by_id_queries_primary_key(service: MCPToolManageService, session: Mock) -> None:
    provider = _provider()
    session.scalar.return_value = provider

    assert service.get_provider_by_id(provider_id=PROVIDER_UUID, tenant_id=TENANT_ID) is provider

    where = str(session.scalar.call_args.args[0].whereclause)
    assert "tool_mcp_providers.id = " in where
    assert "server_identifier" not in where


def test_get_provider_by_id_rejects_server_identifier(service: MCPToolManageService, session: Mock) -> None:
    """A server identifier in the provider_id slot must not reach the uuid column."""
    with pytest.raises(ValueError, match="expected a valid UUID"):
        service.get_provider_by_id(provider_id=SERVER_IDENTIFIER, tenant_id=TENANT_ID)

    session.scalar.assert_not_called()


def test_get_provider_by_id_not_found(service: MCPToolManageService, session: Mock) -> None:
    session.scalar.return_value = None

    with pytest.raises(ValueError, match="MCP tool not found"):
        service.get_provider_by_id(provider_id=PROVIDER_UUID, tenant_id=TENANT_ID)


def test_get_provider_by_server_identifier_queries_identifier(service: MCPToolManageService, session: Mock) -> None:
    provider = _provider()
    session.scalar.return_value = provider

    result = service.get_provider_by_server_identifier(server_identifier=SERVER_IDENTIFIER, tenant_id=TENANT_ID)

    assert result is provider
    assert "tool_mcp_providers.server_identifier = " in str(session.scalar.call_args.args[0].whereclause)


def test_get_provider_by_server_identifier_not_found(service: MCPToolManageService, session: Mock) -> None:
    session.scalar.return_value = None

    with pytest.raises(ValueError, match="MCP tool not found"):
        service.get_provider_by_server_identifier(server_identifier=SERVER_IDENTIFIER, tenant_id=TENANT_ID)


def test_persisted_reference_non_uuid_queries_identifier_only(service: MCPToolManageService, session: Mock) -> None:
    provider = _provider()
    session.scalar.return_value = provider

    assert (
        service.get_provider_by_persisted_reference(id_or_server_identifier=SERVER_IDENTIFIER, tenant_id=TENANT_ID)
        is provider
    )

    # A non-uuid reference can only be a server identifier, so the primary-key
    # lookup is never attempted.
    assert session.scalar.call_count == 1
    assert "tool_mcp_providers.server_identifier = " in str(session.scalar.call_args.args[0].whereclause)


def test_persisted_reference_uuid_prefers_primary_key(service: MCPToolManageService, session: Mock) -> None:
    """Graphs written before the server-identifier convention still carry the primary key."""
    provider = _provider()
    session.scalar.return_value = provider

    assert (
        service.get_provider_by_persisted_reference(id_or_server_identifier=PROVIDER_UUID, tenant_id=TENANT_ID)
        is provider
    )

    assert session.scalar.call_count == 1
    assert "tool_mcp_providers.id = " in str(session.scalar.call_args.args[0].whereclause)


def test_persisted_reference_uuid_falls_back_to_identifier(service: MCPToolManageService, session: Mock) -> None:
    """A server identifier is free text, so it may itself look like a uuid."""
    provider = _provider()
    session.scalar.side_effect = [None, provider]

    assert (
        service.get_provider_by_persisted_reference(id_or_server_identifier=PROVIDER_UUID, tenant_id=TENANT_ID)
        is provider
    )

    assert session.scalar.call_count == 2
    assert "tool_mcp_providers.server_identifier = " in str(session.scalar.call_args.args[0].whereclause)


def test_persisted_reference_not_found(service: MCPToolManageService, session: Mock) -> None:
    session.scalar.return_value = None

    # Never the primary-key lookup's "expected a valid UUID", which would
    # misdescribe a legitimate reference.
    with pytest.raises(ValueError, match="MCP tool not found"):
        service.get_provider_by_persisted_reference(id_or_server_identifier=SERVER_IDENTIFIER, tenant_id=TENANT_ID)


def test_persisted_reference_uuid_not_found(service: MCPToolManageService, session: Mock) -> None:
    session.scalar.return_value = None

    with pytest.raises(ValueError, match="MCP tool not found"):
        service.get_provider_by_persisted_reference(id_or_server_identifier=PROVIDER_UUID, tenant_id=TENANT_ID)
