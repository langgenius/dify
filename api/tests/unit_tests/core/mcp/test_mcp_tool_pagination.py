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


@pytest.mark.parametrize("page_sizes", [(10_000,), (9_999, 1)], ids=["single-page", "two-pages"])
def test_exact_tool_limit_on_terminal_page(page_sizes: tuple[int, ...]) -> None:
    pages: dict[str | None, ListToolsResult] = {}
    expected: list[str] = []
    for index, size in enumerate(page_sizes):
        names = [f"page-{index}-tool-{number}" for number in range(size)]
        expected.extend(names)
        cursor = None if index == 0 else f"page-{index}"
        next_cursor = f"page-{index + 1}" if index + 1 < len(page_sizes) else None
        pages[cursor] = ListToolsResult(tools=[tool(name) for name in names], nextCursor=next_cursor)

    client, requests = make_client(pages)

    assert [result.name for result in client.list_tools()] == expected
    assert len(requests) == len(page_sizes)


@pytest.mark.parametrize("next_cursor", [None, "more"])
@pytest.mark.parametrize("page_sizes", [(10_001,), (9_999, 2)], ids=["oversized-page", "accumulated-overflow"])
def test_tool_limit_overflow_never_returns_partial_inventory(
    page_sizes: tuple[int, ...], next_cursor: str | None
) -> None:
    pages: dict[str | None, ListToolsResult] = {}
    for index, size in enumerate(page_sizes):
        cursor = None if index == 0 else f"page-{index}"
        continuation = f"page-{index + 1}" if index + 1 < len(page_sizes) else next_cursor
        pages[cursor] = ListToolsResult(
            tools=[tool(f"page-{index}-tool-{number}") for number in range(size)], nextCursor=continuation
        )

    client, requests = make_client(pages)

    with pytest.raises(MCPConnectionError, match="10,000-tool discovery limit"):
        client.list_tools()
    assert len(requests) == len(page_sizes)


@pytest.mark.parametrize("next_cursor", ["more", ""])
@pytest.mark.parametrize("first_page_size", [10_000, 9_999], ids=["single-page", "two-pages"])
def test_exact_tool_limit_with_continuation_fails_without_fetching_again(
    first_page_size: int, next_cursor: str
) -> None:
    pages: dict[str | None, ListToolsResult] = {
        None: ListToolsResult(
            tools=[tool(f"tool-{number}") for number in range(first_page_size)],
            nextCursor=next_cursor if first_page_size == 10_000 else "last-tool",
        )
    }
    if first_page_size < 10_000:
        pages["last-tool"] = ListToolsResult(tools=[tool("tool-9999")], nextCursor=next_cursor)
    client, requests = make_client(pages)

    with pytest.raises(MCPConnectionError, match="10,000-tool discovery limit"):
        client.list_tools()
    assert len(requests) == (1 if first_page_size == 10_000 else 2)


@pytest.mark.parametrize("auth_retry", [False, True], ids=["base-client", "auth-retry-client"])
def test_empty_pages_exhaust_request_budget_without_extra_request_or_auth_retry(auth_retry: bool) -> None:
    client, _ = make_client({})
    session = client._session
    assert session is not None
    if auth_retry:
        client = MCPClientWithAuthRetry("http://127.0.0.1:1/mcp")
        client._session = session
    handle_auth_error = Mock()
    if isinstance(client, MCPClientWithAuthRetry):
        client._handle_auth_error = handle_auth_error

    responses: list[ListToolsResult | AssertionError] = [
        ListToolsResult(tools=[], nextCursor=f"fresh-cursor-{index}") for index in range(100)
    ]
    responses.append(AssertionError("Request 101 must not be sent"))
    send_request = Mock(side_effect=responses)
    session.send_request = send_request

    with pytest.raises(MCPConnectionError, match="100-request discovery limit") as exc_info:
        client.list_tools()
    assert not isinstance(exc_info.value, MCPAuthError)
    assert send_request.call_count == 100
    handle_auth_error.assert_not_called()


@pytest.mark.parametrize(
    "last_page_tools", [[], [tool("last-page-tool")]], ids=["empty-terminal", "populated-terminal"]
)
def test_terminal_page_on_last_allowed_request_succeeds(last_page_tools: list[Tool]) -> None:
    client, _ = make_client({})
    session = client._session
    assert session is not None
    responses = [ListToolsResult(tools=[], nextCursor=f"fresh-cursor-{index}") for index in range(99)]
    responses.append(ListToolsResult(tools=last_page_tools))
    send_request = Mock(side_effect=responses)
    session.send_request = send_request

    assert client.list_tools() == last_page_tools
    assert send_request.call_count == 100


@pytest.mark.parametrize("error_on_first_page", [True, False], ids=["first-page", "later-page"])
def test_session_error_propagates_unchanged(error_on_first_page: bool) -> None:
    client, _ = make_client({})
    session = client._session
    assert session is not None
    error = RuntimeError("controlled session error")
    responses: list[ListToolsResult | RuntimeError] = []
    if not error_on_first_page:
        responses.append(ListToolsResult(tools=[tool("alpha")], nextCursor="more"))
    responses.append(error)
    send_request = Mock(side_effect=responses)
    session.send_request = send_request

    with pytest.raises(RuntimeError) as exc_info:
        client.list_tools()
    assert exc_info.value is error
    assert send_request.call_count == len(responses)


def test_empty_string_is_an_opaque_continuation_cursor() -> None:
    client, requests = make_client(
        {
            None: ListToolsResult(tools=[tool("alpha")], nextCursor=""),
            "": ListToolsResult(tools=[tool("beta")]),
        }
    )

    assert [result.name for result in client.list_tools()] == ["alpha", "beta"]
    assert len(requests) == 2
    assert requests[1].params is not None
    assert requests[1].params.cursor == ""
