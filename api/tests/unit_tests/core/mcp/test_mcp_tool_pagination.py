"""Offline pagination regressions using the real client and in-memory JSON-RPC."""

from collections.abc import Generator, Mapping
from contextlib import contextmanager
from datetime import timedelta
from queue import Queue
from threading import Thread

import pytest

from core.mcp.auth_client import MCPClientWithAuthRetry
from core.mcp.error import MCPAuthError, MCPConnectionError
from core.mcp.mcp_client import MCPClient
from core.mcp.session.client_session import ClientSession
from core.mcp.types import (
    ErrorData,
    JSONRPCError,
    JSONRPCMessage,
    JSONRPCRequest,
    JSONRPCResponse,
    ListToolsRequest,
    ListToolsResult,
    SessionMessage,
    Tool,
)


def tool(name: str) -> Tool:
    return Tool(name=name, description=name, inputSchema={"type": "object", "properties": {}})


@contextmanager
def client_for_pages(
    pages: Mapping[str | None, ListToolsResult | ErrorData], client: MCPClient | None = None
) -> Generator[tuple[MCPClient, list[ListToolsRequest]]]:
    incoming: Queue[SessionMessage | Exception | None] = Queue()
    outgoing: Queue[SessionMessage | None] = Queue()
    requests: list[ListToolsRequest] = []
    errors: list[Exception] = []

    def serve_pages() -> None:
        while (message := outgoing.get()) is not None:
            request = message.message.root
            assert isinstance(request, JSONRPCRequest)
            try:
                payload = ListToolsRequest.model_validate({"method": request.method, "params": request.params})
                requests.append(payload)
                cursor = payload.params.cursor if payload.params is not None else None
                page = pages[cursor]
                response: JSONRPCResponse | JSONRPCError
                if isinstance(page, ErrorData):
                    response = JSONRPCError(jsonrpc="2.0", id=request.id, error=page)
                else:
                    response = JSONRPCResponse(
                        jsonrpc="2.0",
                        id=request.id,
                        result=page.model_dump(mode="json", by_alias=True, exclude_none=True),
                    )
            except Exception as error:
                errors.append(error)
                response = JSONRPCError(
                    jsonrpc="2.0", id=request.id, error=ErrorData(code=500, message="Unexpected pagination request")
                )
            incoming.put(SessionMessage(message=JSONRPCMessage(response)))

    thread = Thread(target=serve_pages, daemon=True)
    thread.start()
    client = client if client is not None else MCPClient("http://127.0.0.1:1/mcp")
    try:
        with client._exit_stack:
            client._session = client._exit_stack.enter_context(
                ClientSession(incoming, outgoing, read_timeout_seconds=timedelta(seconds=2))
            )
            yield client, requests
    finally:
        outgoing.put(None)
        thread.join(timeout=2)
        assert not thread.is_alive()
        assert not errors, errors


def test_single_page_control() -> None:
    with client_for_pages({None: ListToolsResult(tools=[tool("alpha")])}) as (client, requests):
        assert [x.name for x in client.list_tools()] == ["alpha"]
        assert len(requests) == 1


@pytest.mark.parametrize("first_page", [[tool("alpha")], []], ids=["populated-first-page", "empty-first-page"])
def test_all_pages_are_available(first_page: list[Tool]) -> None:
    cursor = "opaque:+/=?page2"
    with client_for_pages(
        {
            None: ListToolsResult(tools=first_page, nextCursor=cursor),
            cursor: ListToolsResult(tools=[tool("beta")]),
        }
    ) as (client, requests):
        expected = [t.name for t in first_page] + ["beta"]
        assert [x.name for x in client.list_tools()] == expected
        assert requests[1].params is not None
        assert requests[1].params.cursor == cursor


def test_no_session_control() -> None:
    with pytest.raises(ValueError, match="Session not initialized"):
        MCPClient("http://127.0.0.1:1/mcp").list_tools()


@pytest.mark.parametrize("cursors", [("opaque-A", "opaque-A"), ("opaque-A", "opaque-B", "opaque-A")])
def test_repeated_cursor_is_a_bounded_error(cursors: tuple[str, ...]) -> None:
    pages = {
        None if index == 0 else cursors[index - 1]: ListToolsResult(tools=[tool(f"page-{index}")], nextCursor=cursor)
        for index, cursor in enumerate(cursors)
    }
    with client_for_pages(pages) as (client, requests):
        with pytest.raises(MCPConnectionError, match="repeated pagination cursor"):
            client.list_tools()
        assert len(requests) == len(cursors)


def test_later_page_auth_error_restarts_clean_inventory(monkeypatch: pytest.MonkeyPatch) -> None:
    client = MCPClientWithAuthRetry("http://127.0.0.1:1/mcp")
    old_pages = {
        None: ListToolsResult(tools=[tool("stale-alpha")], nextCursor="opaque-old"),
        "opaque-old": ErrorData(code=401, message="controlled later-page authentication failure"),
    }
    new_pages = {
        None: ListToolsResult(tools=[tool("fresh-alpha")], nextCursor="opaque-new"),
        "opaque-new": ListToolsResult(tools=[tool("beta")]),
    }
    auth_errors: list[MCPAuthError] = []
    cleanup: list[str] = []
    reconnects: list[str] = []
    with (
        client_for_pages(old_pages, client) as (_, old_requests),
        client_for_pages(new_pages) as (
            reconnected_client,
            new_requests,
        ),
    ):
        old_session = client._session
        assert old_session is not None
        client._initialized = True
        client._exit_stack.callback(lambda: cleanup.append("closed"))

        def reconnect() -> None:
            reconnects.append("reconnected")
            client._session = reconnected_client._session

        # Patch only the OAuth exchange and transport reconnect, not session requests.
        monkeypatch.setattr(client, "_handle_auth_error", auth_errors.append)
        monkeypatch.setattr(client, "_initialize", reconnect)
        assert [t.name for t in client.list_tools()] == ["fresh-alpha", "beta"]
        assert [p.params.cursor if p.params is not None else None for p in old_requests] == [None, "opaque-old"]
        assert [p.params.cursor if p.params is not None else None for p in new_requests] == [None, "opaque-new"]
        assert len(auth_errors) == 1
        assert str(auth_errors[0]) == "controlled later-page authentication failure"
        assert cleanup == ["closed"]
        assert reconnects == ["reconnected"]
        assert old_session._receiver_future is not None
        assert old_session._receiver_future.done()
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
    with client_for_pages(pages) as (client, requests):
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
    with client_for_pages(pages) as (client, requests):
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
    with client_for_pages(pages) as (client, requests):
        with pytest.raises(MCPConnectionError, match="10,000-tool discovery limit"):
            client.list_tools()
        assert len(requests) == (1 if first_page_size == 10_000 else 2)


@pytest.mark.parametrize("auth_retry", [False, True], ids=["base-client", "auth-retry-client"])
def test_empty_pages_exhaust_request_budget_without_extra_request_or_auth_retry(auth_retry: bool) -> None:
    client = MCPClientWithAuthRetry("http://127.0.0.1:1/mcp") if auth_retry else MCPClient("http://127.0.0.1:1/mcp")
    pages = {
        None if index == 0 else f"fresh-cursor-{index - 1}": ListToolsResult(
            tools=[], nextCursor=f"fresh-cursor-{index}"
        )
        for index in range(100)
    }
    with client_for_pages(pages, client) as (_, requests):
        with pytest.raises(MCPConnectionError, match="100-request discovery limit") as exc_info:
            client.list_tools()
        assert not isinstance(exc_info.value, MCPAuthError)
        assert len(requests) == 100


@pytest.mark.parametrize(
    "last_page_tools", [[], [tool("last-page-tool")]], ids=["empty-terminal", "populated-terminal"]
)
def test_terminal_page_on_last_allowed_request_succeeds(last_page_tools: list[Tool]) -> None:
    pages = {
        None if index == 0 else f"fresh-cursor-{index - 1}": ListToolsResult(
            tools=[], nextCursor=f"fresh-cursor-{index}"
        )
        for index in range(99)
    }
    pages["fresh-cursor-98"] = ListToolsResult(tools=last_page_tools)
    with client_for_pages(pages) as (client, requests):
        assert client.list_tools() == last_page_tools
        assert len(requests) == 100


@pytest.mark.parametrize("error_on_first_page", [True, False], ids=["first-page", "later-page"])
def test_session_error_propagates_unchanged(error_on_first_page: bool, monkeypatch: pytest.MonkeyPatch) -> None:
    error = RuntimeError("controlled session error")
    calls: list[str | None] = []
    with client_for_pages({None: ListToolsResult(tools=[tool("alpha")], nextCursor="more")}) as (client, _):
        session = client._session
        assert session is not None
        list_tools = session.list_tools

        def fail_on_page(cursor: str | None = None) -> ListToolsResult:
            calls.append(cursor)
            if error_on_first_page or cursor is not None:
                raise error
            return list_tools(cursor=cursor)

        monkeypatch.setattr(session, "list_tools", fail_on_page)
        with pytest.raises(RuntimeError) as exc_info:
            client.list_tools()
        assert exc_info.value is error
        assert calls == ([None] if error_on_first_page else [None, "more"])


def test_empty_string_is_an_opaque_continuation_cursor() -> None:
    with client_for_pages(
        {
            None: ListToolsResult(tools=[tool("alpha")], nextCursor=""),
            "": ListToolsResult(tools=[tool("beta")]),
        }
    ) as (client, requests):
        assert [result.name for result in client.list_tools()] == ["alpha", "beta"]
        assert len(requests) == 2
        assert requests[1].params is not None
        assert requests[1].params.cursor == ""
