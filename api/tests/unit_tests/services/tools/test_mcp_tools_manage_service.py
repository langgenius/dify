from unittest.mock import MagicMock

from services.tools.mcp_tools_manage_service import MCPToolManageService


def _where_clause(session: MagicMock) -> str:
    statement = session.scalar.call_args.args[0]
    return str(statement.whereclause)


def test_get_provider_resolves_legacy_server_identifier() -> None:
    session = MagicMock()
    provider = MagicMock()
    session.scalar.return_value = provider

    result = MCPToolManageService(session).get_provider(provider_id="fast-mcp", tenant_id="tenant-id")

    assert result is provider
    assert "tool_mcp_providers.server_identifier" in _where_clause(session)
    assert "tool_mcp_providers.id" not in _where_clause(session)


def test_get_provider_queries_uuid_primary_key() -> None:
    session = MagicMock()
    provider = MagicMock()
    session.scalar.return_value = provider
    provider_id = "123e4567-e89b-12d3-a456-426614174000"

    result = MCPToolManageService(session).get_provider(provider_id=provider_id, tenant_id="tenant-id")

    assert result is provider
    assert "tool_mcp_providers.id" in _where_clause(session)
    assert "tool_mcp_providers.server_identifier" in _where_clause(session)
