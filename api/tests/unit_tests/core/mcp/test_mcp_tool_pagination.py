"""Offline regression using Dify's native client and session modules."""

from queue import Queue
from unittest.mock import Mock

import pytest

from core.mcp.auth_client import MCPClientWithAuthRetry
from core.mcp.error import MCPAuthError, MCPConnectionError
from core.mcp.mcp_client import MCPClient
from core.mcp.session.client_session import ClientSession
from core.mcp.types import ClientRequest, ListToolsRequest, ListToolsResult, Tool


def tool(name: str) -> Tool:
    return Tool(name=name, description=name, inputSchema={"type": "object", "properties": {}})


def make_client(pages: dict[str | None, ListToolsResult]) -> tuple[MCPClient, list[ListToolsRequest]]:
    session = ClientSession(Queue(), Queue())
    requests: list[ListToolsRequest] = []

    def respond(request: ClientRequest, _result_type: type[ListToolsResult]) -> ListToolsResult:
        payload = request.root
        assert isinstance(payload, ListToolsRequest)
        requests.append(payload)
        cursor = payload.params.cursor if payload.params is not None else None
        return pages[cursor]

    session.send_request = Mock(side_effect=respond)
    client = MCPClient("http://127.0.0.1:1/mcp")
    client._session = session
    return client, requests


def test_single_page_control() -> None:
    client, requests = make_client({None: ListToolsResult(tools=[tool("alpha")])})
    assert [x.name for x in client.list_tools()] == ["alpha"]
    assert len(requests) == 1


@pytest.mark.parametrize("first_page", [[tool("alpha")], []], ids=["populated-first-page", "empty-first-page"])
def test_all_pages_are_available(first_page: list[Tool]) -> None:
    cursor = "opaque:+/=?page2"
    client, requests = make_client(
        {
            None: ListToolsResult(tools=first_page, nextCursor=cursor),
            cursor: ListToolsResult(tools=[tool("beta")]),
        }
    )
    expected = [t.name for t in first_page] + ["beta"]
    assert [x.name for x in client.list_tools()] == expected
    assert requests[1].params is not None
    assert requests[1].params.cursor == cursor


def test_no_session_control() -> None:
    with pytest.raises(ValueError, match="Session not initialized"):
        MCPClient("http://127.0.0.1:1/mcp").list_tools()


@pytest.mark.parametrize("cursors", [("opaque-A", "opaque-A"), ("opaque-A", "opaque-B", "opaque-A")])
def test_repeated_cursor_is_a_bounded_error(cursors: tuple[str, ...]) -> None:
    client, _ = make_client({})
    responses: list[ListToolsResult | AssertionError] = [
        ListToolsResult(tools=[tool(f"page-{i}")], nextCursor=c) for i, c in enumerate(cursors)
    ]
    # The final exception bounds this test even if a future regression removes the guard.
    responses.append(AssertionError("An already-seen cursor was requested again"))
    session = client._session
    assert session is not None
    send_request = Mock(side_effect=responses)
    session.send_request = send_request
    with pytest.raises(MCPConnectionError, match="repeated pagination cursor"):
        client.list_tools()
    assert send_request.call_count == len(cursors)


def test_later_page_auth_error_restarts_clean_inventory() -> None:
    client = MCPClientWithAuthRetry("http://127.0.0.1:1/mcp")
    old_session = ClientSession(Queue(), Queue())
    new_session = ClientSession(Queue(), Queue())
    requests: list[tuple[str, str | None]] = []
    auth_error = MCPAuthError("controlled later-page authentication failure")

    def before_refresh(request: ClientRequest, _result_type: type[ListToolsResult]) -> ListToolsResult:
        payload = request.root
        assert isinstance(payload, ListToolsRequest)
        cursor = payload.params.cursor if payload.params is not None else None
        requests.append(("before-refresh", cursor))
        if cursor is not None:
            raise auth_error
        return ListToolsResult(tools=[tool("stale-alpha")], nextCursor="opaque-old")

    def after_refresh(request: ClientRequest, _result_type: type[ListToolsResult]) -> ListToolsResult:
        payload = request.root
        assert isinstance(payload, ListToolsRequest)
        cursor = payload.params.cursor if payload.params is not None else None
        requests.append(("after-refresh", cursor))
        if cursor == "opaque-new":
            return ListToolsResult(tools=[tool("beta")])
        return ListToolsResult(tools=[tool("fresh-alpha")], nextCursor="opaque-new")

    old_session.send_request = Mock(side_effect=before_refresh)
    new_session.send_request = Mock(side_effect=after_refresh)
    client._session = old_session
    client._initialized = True
    cleanup: list[str] = []
    client._exit_stack.callback(lambda: cleanup.append("closed"))
    client._handle_auth_error = Mock()  # No OAuth exchange, tokens, or database access.
    client._initialize = Mock(side_effect=lambda: setattr(client, "_session", new_session))
    result = client.list_tools()  # Native auth-retry wrapper and base pagination loop.
    assert [t.name for t in result] == ["fresh-alpha", "beta"]
    assert [label for label, _ in requests] == ["before-refresh", "before-refresh", "after-refresh", "after-refresh"]
    assert [cursor for _, cursor in requests] == [
        None,
        "opaque-old",
        None,
        "opaque-new",
    ]
    client._handle_auth_error.assert_called_once_with(auth_error)
    client._initialize.assert_called_once_with()
    assert cleanup == ["closed"]
    assert client._has_retried is False
