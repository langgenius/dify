"""Test cases for MCP provider lookups and paginated tool refreshes.

The two lookups are deliberately separate: `provider_id` always means the
primary key and `server_identifier` always means the tenant-scoped identifier,
so a value can never silently resolve through the wrong column.
"""

import json
from datetime import datetime
from unittest.mock import Mock
from uuid import uuid4

import pytest
from sqlalchemy import event
from sqlalchemy.orm import Session

from core.entities.mcp_provider import MCPProviderEntity
from core.mcp.auth_client import MCPClientWithAuthRetry
from core.mcp.types import ErrorData, ListToolsResult, Tool
from models.account import Account
from models.tools import MCPToolProvider
from services.tools.mcp_tools_manage_service import MCPToolManageService
from tests.unit_tests.core.mcp.test_mcp_client import client_for_pages

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


@pytest.fixture
def provider(sqlite_session: Session) -> MCPToolProvider:
    owner = Account(name="MCP owner", email="mcp-owner@example.com")
    sqlite_session.add(owner)
    provider = MCPToolProvider(
        name="Test server",
        server_identifier="test-server",
        server_url="https://example.com/mcp",
        server_url_hash="hash",
        icon="",
        tenant_id=str(uuid4()),
        user_id=owner.id,
        authed=True,
        tools=json.dumps([{"name": "saved-tool", "inputSchema": {}}]),
    )
    provider.created_at = datetime(2024, 1, 1)
    provider.updated_at = datetime(2024, 1, 1)
    sqlite_session.add(provider)
    sqlite_session.flush()
    return provider


@pytest.fixture
def flushes(sqlite_session: Session, provider: MCPToolProvider) -> list[None]:
    assert provider in sqlite_session
    flushes: list[None] = []
    event.listen(sqlite_session, "after_flush", lambda *_args: flushes.append(None))
    return flushes


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> MCPClientWithAuthRetry:
    client = MCPClientWithAuthRetry(server_url="https://example.com/mcp")
    # Keep the real auth wrapper and session; in-memory JSON-RPC replaces transport setup.
    monkeypatch.setattr(client, "_initialize", lambda: None)
    monkeypatch.setattr("services.tools.mcp_tools_manage_service.MCPClientWithAuthRetry", lambda **_kwargs: client)
    monkeypatch.setattr(MCPProviderEntity, "decrypt_server_url", lambda _self: "https://example.com/mcp")
    return client


def _page(name: str, cursor: str | None) -> ListToolsResult:
    return ListToolsResult(tools=[Tool(name=name, inputSchema={})], nextCursor=cursor)


@pytest.mark.parametrize("cursor", ["next", ""])
def test_list_provider_tools_saves_all_pages(
    sqlite_session: Session,
    provider: MCPToolProvider,
    flushes: list[None],
    client: MCPClientWithAuthRetry,
    cursor: str,
) -> None:
    service = MCPToolManageService(sqlite_session)
    with client_for_pages({None: _page("alpha", cursor), cursor: _page("beta", None)}, client) as (_, requests):
        service.list_provider_tools(tenant_id=provider.tenant_id, provider_id=provider.id)

    assert [tool["name"] for tool in json.loads(provider.tools)] == ["alpha", "beta"]
    assert all(tool["description"] == "" for tool in json.loads(provider.tools))
    assert provider.authed is True
    assert len(flushes) == 1
    assert [request.params.cursor if request.params is not None else None for request in requests] == [None, cursor]
    sqlite_session.expire(provider)
    assert [tool["name"] for tool in json.loads(provider.tools)] == ["alpha", "beta"]


@pytest.mark.parametrize(
    "cursors",
    [["next", "next"], ["a", "b", "a"], ["", ""]],
    ids=["repeated", "cycle", "empty-repeated"],
)
def test_list_provider_tools_preserves_saved_tools_on_cursor_cycle(
    sqlite_session: Session,
    provider: MCPToolProvider,
    flushes: list[None],
    client: MCPClientWithAuthRetry,
    cursors: list[str],
) -> None:
    original_tools, original_updated_at = provider.tools, provider.updated_at
    pages = {
        None if index == 0 else cursors[index - 1]: _page(f"tool-{index}", cursor)
        for index, cursor in enumerate(cursors)
    }
    service = MCPToolManageService(sqlite_session)
    with client_for_pages(pages, client) as (_, requests):
        with pytest.raises(ValueError, match="Failed to connect to MCP server: .*repeated pagination cursor"):
            service.list_provider_tools(tenant_id=provider.tenant_id, provider_id=provider.id)

    assert provider.tools == original_tools
    assert provider.updated_at == original_updated_at
    assert provider.authed is True
    assert not flushes
    assert [request.params.cursor if request.params is not None else None for request in requests] == [
        None,
        *cursors[:-1],
    ]
    sqlite_session.expire(provider)
    assert provider.tools == original_tools
    assert provider.updated_at == original_updated_at


def test_list_provider_tools_preserves_saved_tools_on_later_page_error(
    sqlite_session: Session,
    provider: MCPToolProvider,
    flushes: list[None],
    client: MCPClientWithAuthRetry,
) -> None:
    original_tools, original_updated_at = provider.tools, provider.updated_at
    pages = {None: _page("alpha", "next"), "next": ErrorData(code=500, message="later page failed")}
    service = MCPToolManageService(sqlite_session)
    with client_for_pages(pages, client) as (_, requests):
        with pytest.raises(ValueError, match="Failed to connect to MCP server: .*later page failed"):
            service.list_provider_tools(tenant_id=provider.tenant_id, provider_id=provider.id)

    assert provider.tools == original_tools
    assert provider.updated_at == original_updated_at
    assert provider.authed is True
    assert not flushes
    assert [request.params.cursor if request.params is not None else None for request in requests] == [None, "next"]
    sqlite_session.expire(provider)
    assert provider.tools == original_tools
    assert provider.updated_at == original_updated_at
