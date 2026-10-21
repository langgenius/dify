"""A failed paginated refresh must preserve the saved MCP tool directory."""

import json
from datetime import datetime
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
from tests.unit_tests.core.mcp.test_mcp_tool_pagination import client_for_pages


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
