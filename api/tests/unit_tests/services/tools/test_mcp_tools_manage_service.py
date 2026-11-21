"""Exercise tenant-scoped MCP provider lookups and paginated tool refreshes.

Primary keys and server identifiers are distinct, even when an identifier looks
like a UUID or collides with another provider's primary key.
"""

import json
from datetime import datetime
from typing import Literal
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
OTHER_PROVIDER_UUID = "00000000-0000-4000-8000-000000000002"
SERVER_IDENTIFIER = "monday_mcp"
TENANT_ID = "3f0a1c4e-1f3d-4a4e-9a1f-2a6f8c5d0b11"
OTHER_TENANT_ID = "00000000-0000-4000-8000-000000000003"


def _provider(
    *, provider_id: str = PROVIDER_UUID, server_identifier: str = SERVER_IDENTIFIER, tenant_id: str = TENANT_ID
) -> MCPToolProvider:
    provider = MCPToolProvider(
        name=f"MCP {provider_id}",
        server_identifier=server_identifier,
        server_url=f"https://example.com/mcp/{provider_id}",
        server_url_hash=provider_id,
        icon="icon",
        tenant_id=tenant_id,
        user_id="user-id",
    )
    provider.id = provider_id
    return provider


def _persist(session: Session, *providers: MCPToolProvider) -> None:
    session.add_all(providers)
    session.commit()
    session.expire_all()


@pytest.fixture
def service(sqlite_session: Session) -> MCPToolManageService:
    return MCPToolManageService(session=sqlite_session)


def test_get_provider_by_id_queries_primary_key(service: MCPToolManageService, sqlite_session: Session) -> None:
    provider = _provider()
    identifier_collision = _provider(provider_id=OTHER_PROVIDER_UUID, server_identifier=PROVIDER_UUID)
    _persist(sqlite_session, identifier_collision, provider)

    assert service.get_provider_by_id(provider_id=PROVIDER_UUID, tenant_id=TENANT_ID).id == provider.id


def test_get_provider_by_id_rejects_server_identifier(unbound_session: Session) -> None:
    """Invalid UUIDs must be rejected before any database access is attempted."""
    service = MCPToolManageService(session=unbound_session)
    with pytest.raises(ValueError, match="expected a valid UUID"):
        service.get_provider_by_id(provider_id=SERVER_IDENTIFIER, tenant_id=TENANT_ID)


def test_get_provider_by_id_not_found(service: MCPToolManageService) -> None:
    with pytest.raises(ValueError, match="MCP tool not found"):
        service.get_provider_by_id(provider_id=PROVIDER_UUID, tenant_id=TENANT_ID)


def test_get_provider_by_server_identifier_queries_identifier(
    service: MCPToolManageService, sqlite_session: Session
) -> None:
    primary_key_collision = _provider()
    provider = _provider(provider_id=OTHER_PROVIDER_UUID, server_identifier=PROVIDER_UUID)
    _persist(sqlite_session, primary_key_collision, provider)

    result = service.get_provider_by_server_identifier(server_identifier=PROVIDER_UUID, tenant_id=TENANT_ID)

    assert result.id == provider.id


def test_get_provider_by_server_identifier_not_found(service: MCPToolManageService) -> None:
    with pytest.raises(ValueError, match="MCP tool not found"):
        service.get_provider_by_server_identifier(server_identifier=SERVER_IDENTIFIER, tenant_id=TENANT_ID)


def test_persisted_reference_non_uuid_queries_identifier_only(
    service: MCPToolManageService, sqlite_session: Session
) -> None:
    provider = _provider()
    _persist(sqlite_session, provider)

    assert (
        service.get_provider_by_persisted_reference(id_or_server_identifier=SERVER_IDENTIFIER, tenant_id=TENANT_ID).id
        == provider.id
    )


def test_persisted_reference_uuid_prefers_primary_key(service: MCPToolManageService, sqlite_session: Session) -> None:
    """Legacy graph references prefer the primary key when both meanings resolve."""
    provider = _provider()
    identifier_collision = _provider(provider_id=OTHER_PROVIDER_UUID, server_identifier=PROVIDER_UUID)
    _persist(sqlite_session, identifier_collision, provider)

    assert (
        service.get_provider_by_persisted_reference(id_or_server_identifier=PROVIDER_UUID, tenant_id=TENANT_ID).id
        == provider.id
    )


def test_persisted_reference_uuid_falls_back_to_identifier(
    service: MCPToolManageService, sqlite_session: Session
) -> None:
    """A foreign primary-key match must not hide the tenant's UUID-shaped identifier."""
    foreign_primary_key = _provider(tenant_id=OTHER_TENANT_ID)
    provider = _provider(provider_id=OTHER_PROVIDER_UUID, server_identifier=PROVIDER_UUID)
    _persist(sqlite_session, foreign_primary_key, provider)

    assert (
        service.get_provider_by_persisted_reference(id_or_server_identifier=PROVIDER_UUID, tenant_id=TENANT_ID).id
        == provider.id
    )


@pytest.mark.parametrize("reference", [SERVER_IDENTIFIER, PROVIDER_UUID])
def test_persisted_reference_not_found(service: MCPToolManageService, reference: str) -> None:
    with pytest.raises(ValueError, match="MCP tool not found"):
        service.get_provider_by_persisted_reference(id_or_server_identifier=reference, tenant_id=TENANT_ID)


@pytest.mark.parametrize("lookup", ["id", "server_identifier", "persisted_id", "persisted_identifier"])
def test_provider_lookups_reject_foreign_tenants(
    service: MCPToolManageService,
    sqlite_session: Session,
    lookup: Literal["id", "server_identifier", "persisted_id", "persisted_identifier"],
) -> None:
    _persist(sqlite_session, _provider(tenant_id=OTHER_TENANT_ID))

    if lookup == "id":
        with pytest.raises(ValueError, match="MCP tool not found"):
            service.get_provider_by_id(provider_id=PROVIDER_UUID, tenant_id=TENANT_ID)
    elif lookup == "server_identifier":
        with pytest.raises(ValueError, match="MCP tool not found"):
            service.get_provider_by_server_identifier(server_identifier=SERVER_IDENTIFIER, tenant_id=TENANT_ID)
    else:
        with pytest.raises(ValueError, match="MCP tool not found"):
            service.get_provider_by_persisted_reference(
                id_or_server_identifier=PROVIDER_UUID if lookup == "persisted_id" else SERVER_IDENTIFIER,
                tenant_id=TENANT_ID,
            )


def test_server_identifier_can_be_reused_across_tenants(service: MCPToolManageService, sqlite_session: Session) -> None:
    foreign = _provider(tenant_id=OTHER_TENANT_ID)
    provider = _provider(provider_id=OTHER_PROVIDER_UUID)
    _persist(sqlite_session, foreign, provider)

    assert (
        service.get_provider_by_server_identifier(server_identifier=SERVER_IDENTIFIER, tenant_id=TENANT_ID).id
        == provider.id
    )


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
