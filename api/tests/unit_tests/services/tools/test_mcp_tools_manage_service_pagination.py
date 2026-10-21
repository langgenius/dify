"""A failed paginated refresh must preserve the saved MCP tool directory."""

import json
from datetime import datetime
from unittest.mock import Mock, call

import pytest

from core.entities.mcp_provider import MCPProviderEntity
from core.mcp.auth_client import MCPClientWithAuthRetry
from core.mcp.error import MCPConnectionError
from core.mcp.types import ListToolsResult, Tool
from models.tools import MCPToolProvider
from services.tools.mcp_tools_manage_service import MCPToolManageService


@pytest.fixture
def provider() -> MCPToolProvider:
    provider = MCPToolProvider(
        name="Test server",
        server_identifier="test-server",
        server_url="https://example.com/mcp",
        server_url_hash="hash",
        icon="",
        tenant_id="tenant-id",
        user_id="user-id",
        authed=True,
        tools=json.dumps([{"name": "saved-tool", "inputSchema": {}}]),
    )
    provider.created_at = datetime(2024, 1, 1)
    provider.updated_at = datetime(2024, 1, 1)
    return provider


@pytest.fixture
def db_session(provider: MCPToolProvider) -> Mock:
    return Mock(scalar=Mock(return_value=provider))


@pytest.fixture
def remote_session() -> Mock:
    return Mock()


@pytest.fixture
def build_response() -> Mock:
    return Mock()


@pytest.fixture
def service(
    db_session: Mock, remote_session: Mock, build_response: Mock, monkeypatch: pytest.MonkeyPatch
) -> MCPToolManageService:
    service = MCPToolManageService(db_session)
    client = MCPClientWithAuthRetry(server_url="https://example.com/mcp")
    client._session = remote_session
    # Keep the real auth wrapper and pagination loop; only transport setup is stubbed.
    monkeypatch.setattr(client, "_initialize", Mock())
    monkeypatch.setattr("services.tools.mcp_tools_manage_service.MCPClientWithAuthRetry", Mock(return_value=client))
    monkeypatch.setattr(MCPProviderEntity, "decrypt_server_url", Mock(return_value="https://example.com/mcp"))
    monkeypatch.setattr(service, "_prepare_auth_headers", Mock(return_value={}))
    monkeypatch.setattr(service, "_build_tool_provider_response", build_response)
    return service


def _page(name: str, cursor: str | None) -> ListToolsResult:
    return ListToolsResult(tools=[Tool(name=name, inputSchema={})], nextCursor=cursor)


@pytest.mark.parametrize("cursor", ["next", ""])
def test_list_provider_tools_saves_all_pages(
    service: MCPToolManageService,
    provider: MCPToolProvider,
    db_session: Mock,
    remote_session: Mock,
    build_response: Mock,
    cursor: str,
) -> None:
    remote_session.list_tools.side_effect = [_page("alpha", cursor), _page("beta", None)]

    result = service.list_provider_tools(tenant_id=provider.tenant_id, provider_id=provider.id)

    assert result is build_response.return_value
    assert [tool["name"] for tool in json.loads(provider.tools)] == ["alpha", "beta"]
    assert all(tool["description"] == "" for tool in json.loads(provider.tools))
    assert provider.authed is True
    db_session.flush.assert_called_once_with()
    assert remote_session.list_tools.call_args_list == [call(), call(cursor=cursor)]


@pytest.mark.parametrize(
    "cursors",
    [["next", "next"], ["a", "b", "a"], ["", ""]],
    ids=["repeated", "cycle", "empty-repeated"],
)
def test_list_provider_tools_preserves_saved_tools_on_cursor_cycle(
    service: MCPToolManageService,
    provider: MCPToolProvider,
    db_session: Mock,
    remote_session: Mock,
    build_response: Mock,
    cursors: list[str],
) -> None:
    original_tools, original_updated_at = provider.tools, provider.updated_at
    remote_session.list_tools.side_effect = [_page(f"tool-{index}", cursor) for index, cursor in enumerate(cursors)]

    with pytest.raises(ValueError, match="Failed to connect to MCP server: .*repeated pagination cursor"):
        service.list_provider_tools(tenant_id=provider.tenant_id, provider_id=provider.id)

    assert provider.tools == original_tools
    assert provider.updated_at == original_updated_at
    assert provider.authed is True
    db_session.flush.assert_not_called()
    build_response.assert_not_called()
    assert remote_session.list_tools.call_args_list == [call(), *[call(cursor=cursor) for cursor in cursors[:-1]]]


def test_list_provider_tools_preserves_saved_tools_on_later_page_error(
    service: MCPToolManageService,
    provider: MCPToolProvider,
    db_session: Mock,
    remote_session: Mock,
    build_response: Mock,
) -> None:
    original_tools, original_updated_at = provider.tools, provider.updated_at
    remote_session.list_tools.side_effect = [_page("alpha", "next"), MCPConnectionError("later page failed")]

    with pytest.raises(ValueError, match="Failed to connect to MCP server: later page failed"):
        service.list_provider_tools(tenant_id=provider.tenant_id, provider_id=provider.id)

    assert provider.tools == original_tools
    assert provider.updated_at == original_updated_at
    assert provider.authed is True
    db_session.flush.assert_not_called()
    build_response.assert_not_called()
    assert remote_session.list_tools.call_args_list == [call(), call(cursor="next")]
