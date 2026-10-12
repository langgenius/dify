"""
Tests for the StreamableHTTP client transport.

Contains tests for only the client side of the StreamableHTTP transport.
"""

import json
import queue
import threading
import time
from concurrent.futures import Future, ThreadPoolExecutor
from datetime import timedelta
from typing import Any
from unittest.mock import patch

import httpx
import pytest
from httpx_sse import ServerSentEvent

from core.mcp import types
from core.mcp.client.streamable_client import (
    LAST_EVENT_ID,
    MCP_SESSION_ID,
    RequestContext,
    ResumptionError,
    StreamableHTTPError,
    StreamableHTTPTransport,
    streamablehttp_client,
)
from core.mcp.types import (
    ClientMessageMetadata,
    ErrorData,
    JSONRPCError,
    JSONRPCMessage,
    JSONRPCNotification,
    JSONRPCRequest,
    JSONRPCResponse,
    SessionMessage,
)

# Test constants
SERVER_NAME = "test_streamable_http_server"
TEST_SESSION_ID = "test-session-id-12345"
INIT_REQUEST = {
    "jsonrpc": "2.0",
    "method": "initialize",
    "params": {
        "clientInfo": {"name": "test-client", "version": "1.0"},
        "protocolVersion": "2025-03-26",
        "capabilities": {},
    },
    "id": "init-1",
}


class MockStreamableHTTPClient:
    """Mock StreamableHTTP client for testing."""

    def __init__(self, url: str, headers: dict[str, Any] | None = None):
        self.url = url
        self.headers = headers or {}
        self.connected = False
        self.read_queue: queue.Queue = queue.Queue()
        self.write_queue: queue.Queue = queue.Queue()
        self.session_id = TEST_SESSION_ID

    def connect(self):
        """Simulate connection establishment."""
        self.connected = True
        return self.read_queue, self.write_queue, lambda: self.session_id

    def send_initialize_response(self):
        """Send a mock initialize response."""
        session_message = types.SessionMessage(
            message=types.JSONRPCMessage(
                root=types.JSONRPCResponse(
                    jsonrpc="2.0",
                    id="init-1",
                    result={
                        "protocolVersion": types.LATEST_PROTOCOL_VERSION,
                        "capabilities": {
                            "logging": None,
                            "resources": None,
                            "tools": None,
                            "experimental": None,
                            "prompts": None,
                        },
                        "serverInfo": {"name": SERVER_NAME, "version": "0.1.0"},
                        "instructions": "Test server instructions.",
                    },
                )
            )
        )
        self.read_queue.put(session_message)

    def send_tools_response(self):
        """Send a mock tools list response."""
        session_message = types.SessionMessage(
            message=types.JSONRPCMessage(
                root=types.JSONRPCResponse(
                    jsonrpc="2.0",
                    id="tools-1",
                    result={
                        "tools": [
                            {
                                "name": "test_tool",
                                "description": "A test tool",
                                "inputSchema": {"type": "object", "properties": {}},
                            }
                        ],
                    },
                )
            )
        )
        self.read_queue.put(session_message)


def test_streamablehttp_client_message_id_handling():
    """Test StreamableHTTP client properly handles message ID coercion."""
    mock_client = MockStreamableHTTPClient("http://test.example/mcp")
    read_queue, write_queue, get_session_id = mock_client.connect()

    # Send a message with string ID that should be coerced to int
    response_message = types.SessionMessage(
        message=types.JSONRPCMessage(root=types.JSONRPCResponse(jsonrpc="2.0", id="789", result={"test": "data"}))
    )
    read_queue.put(response_message)

    # Get the message from queue
    message = read_queue.get(timeout=1.0)
    assert message is not None
    assert isinstance(message, types.SessionMessage)

    # Check that the ID was properly handled
    assert isinstance(message.message.root, types.JSONRPCResponse)
    assert message.message.root.id == 789  # ID should be coerced to int due to union_mode="left_to_right"


def test_streamablehttp_client_connection_validation(monkeypatch: pytest.MonkeyPatch):
    """Validate connection setup and cleanup with a real HTTP client."""
    client = httpx.Client(transport=httpx.MockTransport(lambda _request: httpx.Response(200)))
    monkeypatch.setattr("core.mcp.client.streamable_client.create_ssrf_proxy_mcp_http_client", lambda **_kwargs: client)
    with streamablehttp_client("http://test.example/mcp") as (read_queue, write_queue, get_session_id):
        assert isinstance(read_queue, queue.Queue)
        assert isinstance(write_queue, queue.Queue)
        assert get_session_id() is None
    assert client.is_closed


def test_streamablehttp_client_timeout_configuration(monkeypatch: pytest.MonkeyPatch):
    """Pass configured timeouts and authorization to the HTTP client factory."""
    custom_headers = {"Authorization": "Bearer test-token"}
    configurations: list[tuple[dict[str, str], httpx.Timeout]] = []

    def create_client(*, headers: dict[str, str], timeout: httpx.Timeout) -> httpx.Client:
        configurations.append((headers, timeout))
        return httpx.Client(
            headers=headers, timeout=timeout, transport=httpx.MockTransport(lambda _r: httpx.Response(200))
        )

    monkeypatch.setattr("core.mcp.client.streamable_client.create_ssrf_proxy_mcp_http_client", create_client)
    with streamablehttp_client("http://test.example/mcp", headers=custom_headers, timeout=12, sse_read_timeout=34):
        assert len(configurations) == 1
        headers, timeout = configurations[0]
        assert headers["Authorization"] == "Bearer test-token"
        assert timeout == httpx.Timeout(12, read=34)


def test_streamablehttp_client_session_id_handling():
    """Test StreamableHTTP client properly handles session IDs."""
    mock_client = MockStreamableHTTPClient("http://test.example/mcp")
    read_queue, write_queue, get_session_id = mock_client.connect()

    # Test that session ID is available
    session_id = get_session_id()
    assert session_id == TEST_SESSION_ID

    # Test that we can use the session ID in subsequent requests
    assert session_id is not None
    assert len(session_id) > 0


def test_streamablehttp_client_message_parsing():
    """Test StreamableHTTP client properly parses different message types."""
    mock_client = MockStreamableHTTPClient("http://test.example/mcp")
    read_queue, write_queue, get_session_id = mock_client.connect()

    # Test valid initialization response
    mock_client.send_initialize_response()

    # Should have a SessionMessage in the queue
    message = read_queue.get(timeout=1.0)
    assert message is not None
    assert isinstance(message, types.SessionMessage)
    assert isinstance(message.message.root, types.JSONRPCResponse)

    # Test tools response
    mock_client.send_tools_response()

    tools_message = read_queue.get(timeout=1.0)
    assert tools_message is not None
    assert isinstance(tools_message, types.SessionMessage)


def test_streamablehttp_client_queue_cleanup():
    """Test that StreamableHTTP client properly cleans up queues on exit."""
    test_url = "http://test.example/mcp"

    read_queue = None
    write_queue = None

    with patch("core.mcp.client.streamable_client.create_ssrf_proxy_mcp_http_client") as mock_client_factory:
        # Mock connection that raises an exception
        mock_client_factory.side_effect = Exception("Connection failed")

        try:
            with streamablehttp_client(test_url) as (rq, wq, get_session_id):
                read_queue = rq
                write_queue = wq
        except Exception:
            pass  # Expected to fail

        # Queues should be cleaned up even on exception
        # Note: In real implementation, cleanup should put None to signal shutdown


def test_streamablehttp_client_headers_propagation(monkeypatch: pytest.MonkeyPatch):
    """Send custom headers on an actual serialized HTTP request."""
    custom_headers = {
        "Authorization": "Bearer test-token",
        "X-Custom-Header": "test-value",
        "User-Agent": "test-client/1.0",
    }
    requests: list[httpx.Request] = []

    def respond(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200, json={"jsonrpc": "2.0", "id": 1, "result": {}})

    def create_client(*, headers: dict[str, str], timeout: httpx.Timeout) -> httpx.Client:
        return httpx.Client(headers=headers, timeout=timeout, transport=httpx.MockTransport(respond))

    monkeypatch.setattr("core.mcp.client.streamable_client.create_ssrf_proxy_mcp_http_client", create_client)
    with streamablehttp_client("http://test.example/mcp", headers=custom_headers) as (read_queue, write_queue, _):
        write_queue.put(SessionMessage(_make_request_msg()))
        assert isinstance(read_queue.get(timeout=2), SessionMessage)
    assert len(requests) == 1
    for key, value in custom_headers.items():
        assert requests[0].headers[key] == value


def test_streamablehttp_client_concurrent_access():
    """Test StreamableHTTP client behavior with concurrent queue access."""
    test_read_queue: queue.Queue = queue.Queue()
    test_write_queue: queue.Queue = queue.Queue()

    # Simulate concurrent producers and consumers
    def producer():
        for i in range(10):
            test_read_queue.put(f"message_{i}")
            time.sleep(0.01)  # Small delay to simulate real conditions

    def consumer():
        received = []
        for _ in range(10):
            try:
                msg = test_read_queue.get(timeout=2.0)
                received.append(msg)
            except queue.Empty:
                break
        return received

    # Start producer in separate thread
    producer_thread = threading.Thread(target=producer, daemon=True)
    producer_thread.start()

    # Consume messages
    received_messages = consumer()

    # Wait for producer to finish
    producer_thread.join(timeout=5.0)

    # Verify all messages were received
    assert len(received_messages) == 10
    for i in range(10):
        assert f"message_{i}" in received_messages


@pytest.mark.parametrize("content_type", ["application/json", "text/event-stream"])
def test_streamablehttp_client_json_vs_sse_mode(monkeypatch: pytest.MonkeyPatch, content_type: str):
    """Decode JSON and SSE responses through the real writer and HTTP client."""
    payload = {"jsonrpc": "2.0", "id": 1, "result": {"mode": content_type}}
    data = json.dumps(payload)
    response = httpx.Response(
        200,
        headers={"content-type": content_type},
        content=f"data: {data}\n\n" if content_type == "text/event-stream" else data,
    )
    client = httpx.Client(transport=httpx.MockTransport(lambda _request: response))
    monkeypatch.setattr("core.mcp.client.streamable_client.create_ssrf_proxy_mcp_http_client", lambda **_kwargs: client)
    with streamablehttp_client("http://test.example/mcp") as (read_queue, write_queue, _):
        write_queue.put(SessionMessage(_make_request_msg()))
        message = read_queue.get(timeout=2)
        assert isinstance(message, SessionMessage)
        assert isinstance(message.message.root, JSONRPCResponse)
        assert message.message.root.result == {"mode": content_type}


@pytest.mark.parametrize("terminate_on_close", [True, False])
def test_streamablehttp_client_terminate_on_close(monkeypatch: pytest.MonkeyPatch, terminate_on_close: bool):
    """Delete initialized sessions on close only when termination is enabled."""
    requests: list[httpx.Request] = []

    def respond(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(
            200, headers={MCP_SESSION_ID: TEST_SESSION_ID}, json={"jsonrpc": "2.0", "id": 1, "result": {}}
        )

    client = httpx.Client(transport=httpx.MockTransport(respond))
    monkeypatch.setattr("core.mcp.client.streamable_client.create_ssrf_proxy_mcp_http_client", lambda **_kwargs: client)
    with streamablehttp_client("http://test.example/mcp", terminate_on_close=terminate_on_close) as (
        rq,
        wq,
        session_id,
    ):
        wq.put(SessionMessage(_make_request_msg("initialize")))
        assert isinstance(rq.get(timeout=2), SessionMessage)
        assert session_id() == TEST_SESSION_ID
    assert [request.method for request in requests] == (["POST", "DELETE"] if terminate_on_close else ["POST"])
    if terminate_on_close:
        assert requests[-1].headers[MCP_SESSION_ID] == TEST_SESSION_ID


def test_streamablehttp_client_protocol_version_handling():
    """Test StreamableHTTP client protocol version handling."""
    mock_client = MockStreamableHTTPClient("http://test.example/mcp")
    read_queue, write_queue, get_session_id = mock_client.connect()

    # Send initialize response with specific protocol version

    session_message = types.SessionMessage(
        message=types.JSONRPCMessage(
            root=types.JSONRPCResponse(
                jsonrpc="2.0",
                id="init-1",
                result={
                    "protocolVersion": "2024-11-05",
                    "capabilities": {},
                    "serverInfo": {"name": SERVER_NAME, "version": "0.1.0"},
                },
            )
        )
    )
    read_queue.put(session_message)

    # Get the message and verify protocol version
    message = read_queue.get(timeout=1.0)
    assert message is not None
    assert isinstance(message.message.root, types.JSONRPCResponse)
    result = message.message.root.result
    assert result["protocolVersion"] == "2024-11-05"


def test_streamablehttp_client_error_response_handling():
    """Test StreamableHTTP client handling of error responses."""
    mock_client = MockStreamableHTTPClient("http://test.example/mcp")
    read_queue, write_queue, get_session_id = mock_client.connect()

    # Send an error response
    session_message = types.SessionMessage(
        message=types.JSONRPCMessage(
            root=types.JSONRPCError(
                jsonrpc="2.0",
                id="test-1",
                error=types.ErrorData(code=-32601, message="Method not found", data=None),
            )
        )
    )
    read_queue.put(session_message)

    # Get the error message
    message = read_queue.get(timeout=1.0)
    assert message is not None
    assert isinstance(message.message.root, types.JSONRPCError)
    assert message.message.root.error.code == -32601
    assert message.message.root.error.message == "Method not found"


def test_streamablehttp_client_resumption_token_handling(monkeypatch: pytest.MonkeyPatch):
    """Deliver SSE event IDs to the caller's resumption callback."""
    tokens: queue.Queue[str] = queue.Queue()
    response = httpx.Response(
        200,
        headers={"content-type": "text/event-stream"},
        content='id: resume-token-123\ndata: {"jsonrpc":"2.0","id":1,"result":{}}\n\n',
    )
    client = httpx.Client(transport=httpx.MockTransport(lambda _request: response))
    monkeypatch.setattr("core.mcp.client.streamable_client.create_ssrf_proxy_mcp_http_client", lambda **_kwargs: client)
    with streamablehttp_client("http://test.example/mcp") as (read_queue, write_queue, _):
        metadata = ClientMessageMetadata(on_resumption_token_update=tokens.put)
        write_queue.put(SessionMessage(_make_request_msg(), metadata=metadata))
        assert isinstance(read_queue.get(timeout=2), SessionMessage)
        assert tokens.get(timeout=2) == "resume-token-123"


# ── helpers ───────────────────────────────────────────────────────────────────


def _make_request_msg(method: str = "ping", req_id: int = 1) -> JSONRPCMessage:
    return JSONRPCMessage(root=JSONRPCRequest(jsonrpc="2.0", id=req_id, method=method))


def _make_response_msg(req_id: int = 1, result: dict | None = None) -> JSONRPCMessage:
    return JSONRPCMessage(root=JSONRPCResponse(jsonrpc="2.0", id=req_id, result=result or {}))


def _make_error_msg(req_id: int = 1, code: int = -32600) -> JSONRPCMessage:
    return JSONRPCMessage(root=JSONRPCError(jsonrpc="2.0", id=req_id, error=ErrorData(code=code, message="err")))


def _make_notification_msg(method: str = "notifications/initialized") -> JSONRPCMessage:
    return JSONRPCMessage(root=JSONRPCNotification(jsonrpc="2.0", method=method))


def _make_sse_mock(event: str = "message", data: str = "", sse_id: str = "") -> ServerSentEvent:
    # Use real ServerSentEvent since StreamableHTTPTransport requires its structure
    return ServerSentEvent(event=event, data=data, id=sse_id, retry=None)


def _new_transport(url: str = "http://example.com/mcp", **kwargs) -> StreamableHTTPTransport:
    return StreamableHTTPTransport(url, **kwargs)


# ── StreamableHTTPTransport.__init__ ─────────────────────────────────────────


class TestStreamableHTTPTransportInit:
    def test_defaults(self):
        t = _new_transport()
        assert t.url == "http://example.com/mcp"
        assert t.headers == {}
        assert t.timeout == 30
        assert t.sse_read_timeout == 300
        assert t.session_id is None
        assert t.stop_event is not None
        assert t._active_responses == []

    def test_timedelta_timeout_and_sse_read_timeout(self):
        t = _new_transport(timeout=timedelta(seconds=10), sse_read_timeout=timedelta(seconds=120))
        assert t.timeout == 10.0
        assert t.sse_read_timeout == 120.0

    def test_custom_headers_merged_into_request_headers(self):
        t = _new_transport(headers={"Authorization": "Bearer tok"})
        assert t.request_headers["Authorization"] == "Bearer tok"
        assert "Accept" in t.request_headers
        assert "content-type" in t.request_headers


# ── _update_headers_with_session ─────────────────────────────────────────────


class TestUpdateHeadersWithSession:
    def test_no_session_id_returns_copy_without_session_header(self):
        t = _new_transport()
        t.session_id = None
        result = t._update_headers_with_session({"X-Foo": "bar"})
        assert result == {"X-Foo": "bar"}
        assert MCP_SESSION_ID not in result

    def test_with_session_id_adds_header(self):
        t = _new_transport()
        t.session_id = "sess-abc"
        result = t._update_headers_with_session({"X-Foo": "bar"})
        assert result[MCP_SESSION_ID] == "sess-abc"
        assert result["X-Foo"] == "bar"


# ── _register_response / _unregister_response / close_active_responses ────────


class TestResponseRegistry:
    def test_register_and_unregister(self):
        t = _new_transport()
        resp = httpx.Response(200, stream=httpx.ByteStream(b""))
        t._register_response(resp)
        assert resp in t._active_responses
        t._unregister_response(resp)
        assert resp not in t._active_responses

    def test_unregister_not_registered_does_not_raise(self):
        t = _new_transport()
        resp = httpx.Response(200, stream=httpx.ByteStream(b""))
        t._unregister_response(resp)  # Should swallow ValueError silently

    def test_close_active_responses_calls_close(self):
        t = _new_transport()
        resp1 = httpx.Response(200, stream=httpx.ByteStream(b""))
        resp2 = httpx.Response(200, stream=httpx.ByteStream(b""))
        t._register_response(resp1)
        t._register_response(resp2)
        assert not resp1.is_closed
        assert not resp2.is_closed
        t.close_active_responses()
        assert resp1.is_closed
        assert resp2.is_closed
        assert t._active_responses == []

    def test_close_active_responses_swallows_runtime_error(self):
        t = _new_transport()
        resp = httpx.Response(200, stream=httpx.ByteStream(b""))
        t._register_response(resp)
        with patch.object(resp, "close", side_effect=RuntimeError("already closed")):
            t.close_active_responses()  # Should not raise
        resp.close()


# ── _is_initialization_request / _is_initialized_notification ────────────────


class TestMessageClassifiers:
    def test_is_initialization_request_true(self):
        t = _new_transport()
        assert t._is_initialization_request(_make_request_msg("initialize")) is True

    def test_is_initialization_request_false_other_method(self):
        t = _new_transport()
        assert t._is_initialization_request(_make_request_msg("tools/list")) is False

    def test_is_initialization_request_false_not_request(self):
        t = _new_transport()
        assert t._is_initialization_request(_make_response_msg()) is False

    def test_is_initialized_notification_true(self):
        t = _new_transport()
        assert t._is_initialized_notification(_make_notification_msg("notifications/initialized")) is True

    def test_is_initialized_notification_false_other_method(self):
        t = _new_transport()
        assert t._is_initialized_notification(_make_notification_msg("notifications/cancelled")) is False

    def test_is_initialized_notification_false_not_notification(self):
        t = _new_transport()
        assert t._is_initialized_notification(_make_request_msg("notifications/initialized")) is False


# ── _maybe_extract_session_id_from_response ───────────────────────────────────


class TestMaybeExtractSessionIdNew:
    def test_extracts_session_id_when_present(self):
        t = _new_transport()
        resp = httpx.Response(200, headers={MCP_SESSION_ID: "new-session-99"})
        t._maybe_extract_session_id_from_response(resp)
        assert t.session_id == "new-session-99"

    def test_no_session_id_header_leaves_none(self):
        t = _new_transport()
        resp = httpx.Response(200)
        t._maybe_extract_session_id_from_response(resp)
        assert t.session_id is None


# ── _handle_sse_event ─────────────────────────────────────────────────────────


class TestHandleSseEventNew:
    def test_message_event_response_returns_true(self):
        t = _new_transport()
        q: queue.Queue = queue.Queue()
        sse = _make_sse_mock("message", json.dumps({"jsonrpc": "2.0", "id": 1, "result": {}}))
        assert t._handle_sse_event(sse, q) is True
        assert isinstance(q.get_nowait(), SessionMessage)

    def test_message_event_error_returns_true(self):
        t = _new_transport()
        q: queue.Queue = queue.Queue()
        data = json.dumps({"jsonrpc": "2.0", "id": 1, "error": {"code": -32600, "message": "bad"}})
        sse = _make_sse_mock("message", data)
        assert t._handle_sse_event(sse, q) is True

    def test_message_event_notification_returns_false(self):
        t = _new_transport()
        q: queue.Queue = queue.Queue()
        data = json.dumps({"jsonrpc": "2.0", "method": "notifications/something"})
        sse = _make_sse_mock("message", data)
        assert t._handle_sse_event(sse, q) is False
        assert isinstance(q.get_nowait(), SessionMessage)

    def test_message_event_empty_data_returns_false(self):
        t = _new_transport()
        q: queue.Queue = queue.Queue()
        sse = _make_sse_mock("message", "   ")
        assert t._handle_sse_event(sse, q) is False
        assert q.empty()

    def test_message_event_invalid_json_puts_exception(self):
        t = _new_transport()
        q: queue.Queue = queue.Queue()
        sse = _make_sse_mock("message", "{bad json}")
        assert t._handle_sse_event(sse, q) is False
        assert isinstance(q.get_nowait(), Exception)

    def test_message_event_replaces_original_request_id(self):
        t = _new_transport()
        q: queue.Queue = queue.Queue()
        data = json.dumps({"jsonrpc": "2.0", "id": 1, "result": {}})
        sse = _make_sse_mock("message", data, sse_id="")
        t._handle_sse_event(sse, q, original_request_id=999)
        item = q.get_nowait()
        assert isinstance(item, SessionMessage)
        assert item.message.root.id == 999

    def test_message_event_calls_resumption_callback_when_sse_id_present(self):
        t = _new_transport()
        q: queue.Queue = queue.Queue()
        data = json.dumps({"jsonrpc": "2.0", "id": 1, "result": {}})
        sse = _make_sse_mock("message", data, sse_id="token-abc")
        tokens: list[str] = []
        t._handle_sse_event(sse, q, resumption_callback=tokens.append)
        assert tokens == ["token-abc"]

    def test_message_event_no_callback_when_no_sse_id(self):
        t = _new_transport()
        q: queue.Queue = queue.Queue()
        data = json.dumps({"jsonrpc": "2.0", "id": 1, "result": {}})
        sse = _make_sse_mock("message", data, sse_id="")
        tokens: list[str] = []
        t._handle_sse_event(sse, q, resumption_callback=tokens.append)
        assert tokens == []

    def test_ping_event_returns_false(self):
        t = _new_transport()
        q: queue.Queue = queue.Queue()
        sse = _make_sse_mock("ping", "")
        assert t._handle_sse_event(sse, q) is False
        assert q.empty()

    def test_unknown_event_returns_false(self):
        t = _new_transport()
        q: queue.Queue = queue.Queue()
        sse = _make_sse_mock("custom_event", "{}")
        assert t._handle_sse_event(sse, q) is False
        assert q.empty()


# ── handle_get_stream ─────────────────────────────────────────────────────────


class TestHandleGetStreamNew:
    def test_skips_when_no_session_id(self):
        t = _new_transport()
        t.session_id = None
        q: queue.Queue = queue.Queue()
        requests: list[httpx.Request] = []

        def respond(request: httpx.Request) -> httpx.Response:
            requests.append(request)
            return httpx.Response(200)

        with httpx.Client(transport=httpx.MockTransport(respond)) as client:
            t.handle_get_stream(client, q)
        assert requests == []

    @pytest.mark.parametrize("stopped", [False, True])
    def test_handles_messages_unless_stopped(self, stopped: bool):
        t = _new_transport()
        t.session_id = "sess-1"
        if stopped:
            t.stop_event.set()
        q: queue.Queue = queue.Queue()
        data = json.dumps({"jsonrpc": "2.0", "id": 1, "result": {}})

        def respond(request: httpx.Request) -> httpx.Response:
            assert request.method == "GET"
            assert request.headers[MCP_SESSION_ID] == "sess-1"
            return httpx.Response(200, headers={"content-type": "text/event-stream"}, content=f"data: {data}\n\n")

        with httpx.Client(transport=httpx.MockTransport(respond)) as client:
            t.handle_get_stream(client, q)

        if stopped:
            assert q.empty()
        else:
            assert isinstance(q.get_nowait(), SessionMessage)

    @pytest.mark.parametrize("stopped", [False, True])
    def test_connection_exception_does_not_raise(self, stopped: bool):
        t = _new_transport()
        t.session_id = "sess-1"
        if stopped:
            t.stop_event.set()
        q: queue.Queue = queue.Queue()

        def refuse(request: httpx.Request) -> httpx.Response:
            raise httpx.ConnectError("connection error", request=request)

        with httpx.Client(transport=httpx.MockTransport(refuse)) as client:
            t.handle_get_stream(client, q)
        assert q.empty()


# ── _handle_resumption_request ────────────────────────────────────────────────


class TestHandleResumptionRequestNew:
    def _make_ctx(
        self, transport, q, client: httpx.Client, resumption_token="token-123", message=None
    ) -> RequestContext:
        if message is None:
            message = _make_request_msg("tools/list", req_id=42)
        metadata = ClientMessageMetadata(resumption_token=resumption_token) if resumption_token else None
        return RequestContext(
            client=client,
            headers=transport.request_headers,
            session_id=transport.session_id,
            session_message=SessionMessage(message),
            metadata=metadata,
            server_to_client_queue=q,
            sse_read_timeout=60,
        )

    @pytest.mark.parametrize("metadata", [None, ClientMessageMetadata(resumption_token=None)])
    def test_raises_resumption_error_without_token(self, metadata: ClientMessageMetadata | None):
        t = _new_transport()
        q: queue.Queue = queue.Queue()

        def unexpected_request(request: httpx.Request) -> httpx.Response:
            pytest.fail(f"Unexpected request without resumption token: {request.url}")

        with httpx.Client(transport=httpx.MockTransport(unexpected_request)) as client:
            ctx = self._make_ctx(t, q, client)
            ctx.metadata = metadata
            with pytest.raises(ResumptionError):
                t._handle_resumption_request(ctx)

    def test_sets_last_event_id_header(self):
        t = _new_transport()
        q: queue.Queue = queue.Queue()
        requests: list[httpx.Request] = []
        tokens: list[str] = []
        data = json.dumps({"jsonrpc": "2.0", "id": 42, "result": {}})

        def respond(request: httpx.Request) -> httpx.Response:
            requests.append(request)
            return httpx.Response(
                200, headers={"content-type": "text/event-stream"}, content=f"id: resume-next\ndata: {data}\n\n"
            )

        with httpx.Client(transport=httpx.MockTransport(respond)) as client:
            ctx = self._make_ctx(t, q, client, resumption_token="resume-999")
            assert ctx.metadata is not None
            ctx.metadata.on_resumption_token_update = tokens.append
            t._handle_resumption_request(ctx)

        assert len(requests) == 1
        assert requests[0].method == "GET"
        assert requests[0].headers[LAST_EVENT_ID] == "resume-999"
        assert tokens == ["resume-next"]

    def test_stops_when_response_complete(self):
        t = _new_transport()
        q: queue.Queue = queue.Queue()
        data1 = json.dumps({"jsonrpc": "2.0", "id": 42, "result": {}})
        data2 = json.dumps({"jsonrpc": "2.0", "id": 43, "result": {}})
        response = httpx.Response(
            200, headers={"content-type": "text/event-stream"}, content=f"data: {data1}\n\ndata: {data2}\n\n"
        )

        with httpx.Client(transport=httpx.MockTransport(lambda _request: response)) as client:
            ctx = self._make_ctx(t, q, client, message=_make_request_msg("tools/list", 42))
            t._handle_resumption_request(ctx)

        # Only the first event was processed (loop breaks on completion)
        assert q.qsize() == 1

    def test_stops_when_stop_event_set(self):
        t = _new_transport()
        t.stop_event.set()
        q: queue.Queue = queue.Queue()
        data = json.dumps({"jsonrpc": "2.0", "id": 1, "result": {}})
        response = httpx.Response(200, headers={"content-type": "text/event-stream"}, content=f"data: {data}\n\n")

        with httpx.Client(transport=httpx.MockTransport(lambda _request: response)) as client:
            ctx = self._make_ctx(t, q, client)
            t._handle_resumption_request(ctx)

        assert q.empty()


# ── _handle_post_request ──────────────────────────────────────────────────────


class TestHandlePostRequestNew:
    def _make_ctx(self, transport, q, response: httpx.Response, message=None) -> RequestContext:
        if message is None:
            message = _make_request_msg("tools/list", 1)
        return RequestContext(
            client=httpx.Client(transport=httpx.MockTransport(lambda _request: response)),
            headers=transport.request_headers,
            session_id=transport.session_id,
            session_message=SessionMessage(message),
            metadata=None,
            server_to_client_queue=q,
            sse_read_timeout=60,
        )

    def test_202_returns_immediately_no_queue(self):
        t = _new_transport()
        q: queue.Queue = queue.Queue()
        response = httpx.Response(202)
        ctx = self._make_ctx(t, q, response)
        with ctx.client:
            t._handle_post_request(ctx)
        assert q.empty()

    def test_204_returns_immediately_no_queue(self):
        t = _new_transport()
        q: queue.Queue = queue.Queue()
        response = httpx.Response(204)
        ctx = self._make_ctx(t, q, response)
        with ctx.client:
            t._handle_post_request(ctx)
        assert q.empty()

    def test_404_sends_session_terminated_error_for_request(self):
        t = _new_transport()
        q: queue.Queue = queue.Queue()
        msg = _make_request_msg("tools/list", 77)
        response = httpx.Response(404)
        ctx = self._make_ctx(t, q, response, message=msg)
        with ctx.client:
            t._handle_post_request(ctx)
        item = q.get_nowait()
        assert isinstance(item, SessionMessage)
        assert isinstance(item.message.root, JSONRPCError)
        assert item.message.root.id == 77
        assert item.message.root.error.message == "Session terminated by server"

    def test_404_on_initialization_includes_url_in_error(self):
        t = _new_transport(url="http://example.com/mcp/server/abc123/mcp")
        q: queue.Queue = queue.Queue()
        msg = _make_request_msg("initialize", 1)
        response = httpx.Response(404)
        ctx = self._make_ctx(t, q, response, message=msg)
        with ctx.client:
            t._handle_post_request(ctx)
        item = q.get_nowait()
        assert isinstance(item, SessionMessage)
        assert isinstance(item.message.root, JSONRPCError)
        assert item.message.root.error.code == 32600
        assert "404 Not Found" in item.message.root.error.message
        assert "http://example.com/mcp/server/abc123/mcp" in item.message.root.error.message

    def test_404_for_notification_no_error_sent(self):
        t = _new_transport()
        q: queue.Queue = queue.Queue()
        msg = _make_notification_msg("some/notification")
        response = httpx.Response(404)
        ctx = self._make_ctx(t, q, response, message=msg)
        with ctx.client:
            t._handle_post_request(ctx)
        assert q.empty()

    def test_json_response_puts_session_message(self):
        t = _new_transport()
        q: queue.Queue = queue.Queue()

        response_data = json.dumps({"jsonrpc": "2.0", "id": 1, "result": {"ok": True}}).encode()
        response = httpx.Response(200, headers={"content-type": "application/json"}, content=response_data)
        ctx = self._make_ctx(t, q, response)

        with ctx.client:
            t._handle_post_request(ctx)
        assert isinstance(q.get_nowait(), SessionMessage)

    def test_json_response_invalid_json_puts_exception(self):
        t = _new_transport()
        q: queue.Queue = queue.Queue()

        response = httpx.Response(200, headers={"content-type": "application/json"}, content=b"{bad json!")
        ctx = self._make_ctx(t, q, response)

        with ctx.client:
            t._handle_post_request(ctx)
        assert isinstance(q.get_nowait(), Exception)

    def test_unexpected_content_type_puts_value_error(self):
        t = _new_transport()
        q: queue.Queue = queue.Queue()

        response = httpx.Response(200, headers={"content-type": "text/plain"})
        ctx = self._make_ctx(t, q, response)

        with ctx.client:
            t._handle_post_request(ctx)
        item = q.get_nowait()
        assert isinstance(item, ValueError)
        assert "Unexpected content type" in str(item)

    def test_initialization_request_extracts_session_id(self):
        t = _new_transport()
        q: queue.Queue = queue.Queue()
        msg = _make_request_msg("initialize", 1)

        response_data = json.dumps({"jsonrpc": "2.0", "id": 1, "result": {}}).encode()
        response = httpx.Response(
            200,
            headers={"content-type": "application/json", MCP_SESSION_ID: "new-sid"},
            content=response_data,
        )
        ctx = self._make_ctx(t, q, response, message=msg)

        with ctx.client:
            t._handle_post_request(ctx)
        assert t.session_id == "new-sid"

    def test_notification_skips_response_processing(self):
        t = _new_transport()
        q: queue.Queue = queue.Queue()
        msg = _make_notification_msg("notifications/something")

        response_data = json.dumps({"jsonrpc": "2.0", "id": 1, "result": {}}).encode()
        response = httpx.Response(200, headers={"content-type": "application/json"}, content=response_data)
        ctx = self._make_ctx(t, q, response, message=msg)

        with ctx.client:
            t._handle_post_request(ctx)
        assert q.empty()

    def test_sse_response_handles_stream(self):
        t = _new_transport()
        q: queue.Queue = queue.Queue()

        data = json.dumps({"jsonrpc": "2.0", "id": 1, "result": {}})
        response = httpx.Response(
            200, headers={"content-type": "text/event-stream"}, content=f"event: message\ndata: {data}\n\n"
        )
        ctx = self._make_ctx(t, q, response)

        with ctx.client:
            t._handle_post_request(ctx)

        assert isinstance(q.get_nowait(), SessionMessage)


# ── _handle_json_response ─────────────────────────────────────────────────────


class TestHandleJsonResponseNew:
    def test_valid_json_puts_session_message(self):
        t = _new_transport()
        q: queue.Queue = queue.Queue()
        data = json.dumps({"jsonrpc": "2.0", "id": 1, "result": {}}).encode()
        response = httpx.Response(200, content=data)
        t._handle_json_response(response, q)
        assert isinstance(q.get_nowait(), SessionMessage)

    def test_invalid_json_puts_exception(self):
        t = _new_transport()
        q: queue.Queue = queue.Queue()
        response = httpx.Response(200, content=b"{ invalid }")
        t._handle_json_response(response, q)
        assert isinstance(q.get_nowait(), Exception)


# ── _handle_sse_response ──────────────────────────────────────────────────────


class TestHandleSseResponseNew:
    @pytest.fixture
    def client(self):
        with httpx.Client(transport=httpx.MockTransport(lambda _request: httpx.Response(500))) as client:
            yield client

    def _ctx(self, transport, q, client: httpx.Client) -> RequestContext:
        return RequestContext(
            client=client,
            headers=transport.request_headers,
            session_id=None,
            session_message=SessionMessage(_make_request_msg()),
            metadata=None,
            server_to_client_queue=q,
            sse_read_timeout=60,
        )

    def test_processes_sse_events(self, client: httpx.Client):
        t = _new_transport()
        q: queue.Queue = queue.Queue()
        ctx = self._ctx(t, q, client)

        data = json.dumps({"jsonrpc": "2.0", "id": 1, "result": {}})
        response = httpx.Response(200, headers={"content-type": "text/event-stream"}, content=f"data: {data}\n\n")
        t._handle_sse_response(response, ctx)

        assert isinstance(q.get_nowait(), SessionMessage)

    def test_stops_when_stop_event_set(self, client: httpx.Client):
        t = _new_transport()
        t.stop_event.set()
        q: queue.Queue = queue.Queue()
        ctx = self._ctx(t, q, client)

        data = json.dumps({"jsonrpc": "2.0", "id": 1, "result": {}})
        response = httpx.Response(200, headers={"content-type": "text/event-stream"}, content=f"data: {data}\n\n")
        t._handle_sse_response(response, ctx)

        assert q.empty()

    def test_stops_when_complete(self, client: httpx.Client):
        t = _new_transport()
        q: queue.Queue = queue.Queue()
        ctx = self._ctx(t, q, client)

        data1 = json.dumps({"jsonrpc": "2.0", "id": 1, "result": {}})
        data2 = json.dumps({"jsonrpc": "2.0", "id": 2, "result": {}})
        response = httpx.Response(
            200, headers={"content-type": "text/event-stream"}, content=f"data: {data1}\n\ndata: {data2}\n\n"
        )
        t._handle_sse_response(response, ctx)

        assert q.qsize() == 1  # Only the first completion item

    def test_exception_outside_stop_puts_to_queue(self, client: httpx.Client):
        t = _new_transport()
        q: queue.Queue = queue.Queue()
        ctx = self._ctx(t, q, client)
        response = httpx.Response(200, headers={"content-type": "application/json"}, content="{}")
        t._handle_sse_response(response, ctx)

        assert isinstance(q.get_nowait(), Exception)

    def test_exception_suppressed_when_stopped(self, client: httpx.Client):
        t = _new_transport()
        t.stop_event.set()
        q: queue.Queue = queue.Queue()
        ctx = self._ctx(t, q, client)
        response = httpx.Response(200, headers={"content-type": "application/json"}, content="{}")
        t._handle_sse_response(response, ctx)

        assert q.empty()

    def test_with_metadata_resumption_callback(self, client: httpx.Client):
        t = _new_transport()
        q: queue.Queue = queue.Queue()
        metadata = ClientMessageMetadata()
        tokens: list[str] = []
        metadata.on_resumption_token_update = tokens.append

        ctx = RequestContext(
            client=client,
            headers=t.request_headers,
            session_id=None,
            session_message=SessionMessage(_make_request_msg()),
            metadata=metadata,
            server_to_client_queue=q,
            sse_read_timeout=60,
        )

        data = json.dumps({"jsonrpc": "2.0", "id": 1, "result": {}})
        response = httpx.Response(
            200, headers={"content-type": "text/event-stream"}, content=f"id: resume-token\ndata: {data}\n\n"
        )
        t._handle_sse_response(response, ctx)

        assert tokens == ["resume-token"]


# ── _handle_unexpected_content_type ──────────────────────────────────────────


class TestHandleUnexpectedContentTypeNew:
    def test_puts_value_error_with_message(self):
        t = _new_transport()
        q: queue.Queue = queue.Queue()
        t._handle_unexpected_content_type("text/html", q)
        item = q.get_nowait()
        assert isinstance(item, ValueError)
        assert "text/html" in str(item)


# ── _send_session_terminated_error ────────────────────────────────────────────


class TestSendSessionTerminatedErrorNew:
    def test_puts_jsonrpc_error(self):
        t = _new_transport()
        q: queue.Queue = queue.Queue()
        t._send_session_terminated_error(q, 42)
        item = q.get_nowait()
        assert isinstance(item, SessionMessage)
        assert isinstance(item.message.root, JSONRPCError)
        assert item.message.root.id == 42
        assert item.message.root.error.code == 32600
        assert "terminated" in item.message.root.error.message.lower()


# ── post_writer ───────────────────────────────────────────────────────────────


class TestPostWriterNew:
    @pytest.fixture
    def requests(self) -> list[httpx.Request]:
        return []

    @pytest.fixture
    def client(self, requests: list[httpx.Request]):
        def respond(request: httpx.Request) -> httpx.Response:
            requests.append(request)
            payload = {"jsonrpc": "2.0", "id": 5, "result": {}}
            if request.method == "GET":
                return httpx.Response(
                    200, headers={"content-type": "text/event-stream"}, content=f"data: {json.dumps(payload)}\n\n"
                )
            return httpx.Response(200, json=payload)

        with httpx.Client(transport=httpx.MockTransport(respond)) as client:
            yield client

    def test_none_message_exits_loop(self, client: httpx.Client):
        t = _new_transport()
        c2s: queue.Queue = queue.Queue()
        s2c: queue.Queue = queue.Queue()
        c2s.put(None)
        t.post_writer(client, c2s, s2c, lambda: None)

    def test_stop_event_exits_loop(self, client: httpx.Client):
        t = _new_transport()
        t.stop_event.set()
        c2s: queue.Queue = queue.Queue()
        s2c: queue.Queue = queue.Queue()
        t.post_writer(client, c2s, s2c, lambda: None)

    def test_initialized_notification_calls_start_get_stream(self, client: httpx.Client, requests: list[httpx.Request]):
        t = _new_transport()
        c2s: queue.Queue = queue.Queue()
        s2c: queue.Queue = queue.Queue()
        started: list[bool] = []

        notif_msg = _make_notification_msg("notifications/initialized")
        c2s.put(SessionMessage(notif_msg))
        c2s.put(None)

        t.post_writer(client, c2s, s2c, lambda: started.append(True))

        assert started == [True]
        assert len(requests) == 1

    def test_resumption_message_calls_handle_resumption_request(
        self, client: httpx.Client, requests: list[httpx.Request]
    ):
        t = _new_transport()
        c2s: queue.Queue = queue.Queue()
        s2c: queue.Queue = queue.Queue()
        started: list[bool] = []

        msg = SessionMessage(_make_request_msg("tools/list", 10))
        metadata = ClientMessageMetadata()
        metadata.resumption_token = "resume-abc"
        msg.metadata = metadata
        c2s.put(msg)
        c2s.put(None)

        t.post_writer(client, c2s, s2c, lambda: started.append(True))

        assert len(requests) == 1
        assert requests[0].method == "GET"
        assert requests[0].headers[LAST_EVENT_ID] == "resume-abc"
        assert started == []
        response = s2c.get_nowait()
        assert isinstance(response, SessionMessage)
        assert response.message.root.id == 10

    def test_regular_message_calls_handle_post_request(self, client: httpx.Client, requests: list[httpx.Request]):
        t = _new_transport()
        c2s: queue.Queue = queue.Queue()
        s2c: queue.Queue = queue.Queue()

        msg = SessionMessage(_make_request_msg("tools/list", 5))
        c2s.put(msg)
        c2s.put(None)

        t.post_writer(client, c2s, s2c, lambda: None)

        assert len(requests) == 1
        assert requests[0].method == "POST"
        assert json.loads(requests[0].content)["id"] == 5
        assert isinstance(s2c.get_nowait(), SessionMessage)

    def test_exception_in_handler_put_to_s2c_when_not_stopped(self, requests: list[httpx.Request]):
        t = _new_transport()
        c2s: queue.Queue = queue.Queue()
        s2c: queue.Queue = queue.Queue()

        msg = SessionMessage(_make_request_msg("tools/list", 5))
        c2s.put(msg)
        c2s.put(None)

        boom = RuntimeError("oops")

        def fail(request: httpx.Request) -> httpx.Response:
            requests.append(request)
            raise boom

        with httpx.Client(transport=httpx.MockTransport(fail)) as failing_client:
            t.post_writer(failing_client, c2s, s2c, lambda: None)

        item = s2c.get_nowait()
        assert item is boom

    def test_exception_suppressed_when_stopped(self, requests: list[httpx.Request]):
        t = _new_transport()
        c2s: queue.Queue = queue.Queue()
        s2c: queue.Queue = queue.Queue()

        msg = SessionMessage(_make_request_msg("tools/list", 5))
        c2s.put(msg)
        c2s.put(None)
        t.stop_event.set()

        boom = RuntimeError("oops")

        def fail(request: httpx.Request) -> httpx.Response:
            requests.append(request)
            raise boom

        with httpx.Client(transport=httpx.MockTransport(fail)) as failing_client:
            t.post_writer(failing_client, c2s, s2c, lambda: None)

        assert s2c.empty()

    def test_queue_empty_timeout_continues_loop(self, client: httpx.Client):
        """Cover the 'except queue.Empty: continue' branch in post_writer."""
        t = _new_transport()
        c2s: queue.Queue = queue.Queue()
        s2c: queue.Queue = queue.Queue()
        call_count = {"n": 0}

        def patched_get[**P](*args: P.args, **kwargs: P.kwargs):
            call_count["n"] += 1
            if call_count["n"] == 1:
                raise queue.Empty

        c2s.get = patched_get  # type: ignore[method-assign]
        t.post_writer(client, c2s, s2c, lambda: None)
        assert call_count["n"] >= 2

    def test_non_client_metadata_treated_as_none(self, client: httpx.Client):
        """session_message.metadata that's not ClientMessageMetadata → metadata is None."""
        t = _new_transport()
        c2s: queue.Queue = queue.Queue()
        s2c: queue.Queue = queue.Queue()

        msg = SessionMessage(_make_request_msg("tools/list", 5))
        msg.metadata = "not-a-client-metadata"
        c2s.put(msg)
        c2s.put(None)

        contexts: list[RequestContext] = []
        with patch.object(t, "_handle_post_request", new=contexts.append):
            t.post_writer(client, c2s, s2c, lambda: None)

        assert len(contexts) == 1
        assert contexts[0].metadata is None


# ── terminate_session ─────────────────────────────────────────────────────────


class TestTerminateSessionNew:
    def test_no_session_id_skips(self):
        t = _new_transport()
        t.session_id = None
        requests: list[httpx.Request] = []

        def respond(request: httpx.Request) -> httpx.Response:
            requests.append(request)
            return httpx.Response(200)

        with httpx.Client(transport=httpx.MockTransport(respond)) as client:
            t.terminate_session(client)
        assert requests == []

    @pytest.mark.parametrize("status_code", [200, 405, 500])
    def test_server_response_does_not_raise(self, status_code: int):
        t = _new_transport()
        t.session_id = "sess-1"
        requests: list[httpx.Request] = []

        def respond(request: httpx.Request) -> httpx.Response:
            requests.append(request)
            return httpx.Response(status_code)

        with httpx.Client(transport=httpx.MockTransport(respond)) as client:
            t.terminate_session(client)
        assert len(requests) == 1
        assert requests[0].method == "DELETE"
        assert requests[0].headers[MCP_SESSION_ID] == "sess-1"

    def test_exception_is_swallowed(self):
        t = _new_transport()
        t.session_id = "sess-1"

        def refuse(request: httpx.Request) -> httpx.Response:
            raise httpx.ConnectError("refused", request=request)

        with httpx.Client(transport=httpx.MockTransport(refuse)) as client:
            t.terminate_session(client)


# ── get_session_id ────────────────────────────────────────────────────────────


class TestGetSessionIdNew:
    def test_returns_none_when_no_session(self):
        t = _new_transport()
        assert t.get_session_id() is None

    def test_returns_session_id_when_set(self):
        t = _new_transport()
        t.session_id = "my-session"
        assert t.get_session_id() == "my-session"


# ── streamablehttp_client context manager ─────────────────────────────────────


class TestStreamablehttpClientContextManagerNew:
    @pytest.fixture
    def requests(self) -> list[httpx.Request]:
        return []

    @pytest.fixture
    def client(self, monkeypatch: pytest.MonkeyPatch, requests: list[httpx.Request]):
        def respond(request: httpx.Request) -> httpx.Response:
            requests.append(request)
            return httpx.Response(
                200, headers={MCP_SESSION_ID: "active-session"}, json={"jsonrpc": "2.0", "id": 1, "result": {}}
            )

        client = httpx.Client(transport=httpx.MockTransport(respond))

        def create_client(*, headers: dict[str, str], timeout: httpx.Timeout) -> httpx.Client:
            client.headers.update(headers)
            client.timeout = timeout
            return client

        monkeypatch.setattr("core.mcp.client.streamable_client.create_ssrf_proxy_mcp_http_client", create_client)
        yield client
        client.close()

    @pytest.fixture(autouse=True)
    def submissions(self, monkeypatch: pytest.MonkeyPatch):
        futures: list[Future] = []
        with ThreadPoolExecutor(max_workers=2) as executor:
            original_submit = executor.submit

            def submit(fn, *args, **kwargs):
                future = original_submit(fn, *args, **kwargs)
                futures.append(future)
                return future

            def create_executor(*, max_workers: int) -> ThreadPoolExecutor:
                assert max_workers == 2
                return executor

            monkeypatch.setattr(executor, "submit", submit)
            monkeypatch.setattr("core.mcp.client.streamable_client.ThreadPoolExecutor", create_executor)
            yield futures

    def test_yields_queues_and_get_session_id(self, client: httpx.Client):
        with streamablehttp_client("http://example.com/mcp") as (s2c, c2s, get_sid):
            assert isinstance(s2c, queue.Queue)
            assert isinstance(c2s, queue.Queue)
            assert get_sid() is None
        assert client.is_closed

    def test_terminate_on_close_false_does_not_delete(self, client: httpx.Client, requests: list[httpx.Request]):
        with streamablehttp_client("http://example.com/mcp", terminate_on_close=False) as (s2c, c2s, get_sid):
            c2s.put(SessionMessage(_make_request_msg("initialize")))
            assert isinstance(s2c.get(timeout=2), SessionMessage)
            assert get_sid() == "active-session"
        assert client.is_closed
        assert [request.method for request in requests] == ["POST"]

    def test_queue_cleanup_on_outer_exception(self, monkeypatch: pytest.MonkeyPatch):
        """Cleanup still runs when the client factory raises."""

        def fail(**_kwargs):
            raise RuntimeError("connection failed")

        monkeypatch.setattr("core.mcp.client.streamable_client.create_ssrf_proxy_mcp_http_client", fail)
        with pytest.raises(RuntimeError, match="connection failed"):
            with streamablehttp_client("http://example.com/mcp"):
                pytest.fail("Client factory failure must prevent context entry")

    def test_timedelta_args_accepted(self, client: httpx.Client):
        with streamablehttp_client(
            "http://example.com/mcp",
            timeout=timedelta(seconds=15),
            sse_read_timeout=timedelta(seconds=60),
        ) as (_, _, get_sid):
            assert callable(get_sid)
            assert client.timeout == httpx.Timeout(15, read=60)

    def test_start_get_stream_submits_to_executor(self, client: httpx.Client, submissions: list[Future]):
        """The submitted writer processes a message on the real executor."""
        with streamablehttp_client("http://example.com/mcp") as (s2c, c2s, _):
            c2s.put(SessionMessage(_make_request_msg()))
            assert isinstance(s2c.get(timeout=2), SessionMessage)
            assert len(submissions) == 1
        assert client.is_closed
        submissions[0].result(timeout=2)

    def test_cleanup_puts_none_sentinels_to_queues(self, client: httpx.Client, submissions: list[Future]):
        """After the writer exits, context cleanup leaves sentinels in both queues."""
        with streamablehttp_client("http://example.com/mcp") as (s2c, c2s, _):
            c2s.put(None)
            submissions[0].result(timeout=2)
        assert client.is_closed
        assert c2s.get_nowait() is None
        assert s2c.get_nowait() is None

    def test_terminate_called_when_session_id_set(self, client: httpx.Client, requests: list[httpx.Request]):
        with streamablehttp_client("http://example.com/mcp", terminate_on_close=True) as (s2c, c2s, get_sid):
            c2s.put(SessionMessage(_make_request_msg("initialize")))
            assert isinstance(s2c.get(timeout=2), SessionMessage)
            assert get_sid() == "active-session"
        assert client.is_closed
        assert [request.method for request in requests] == ["POST", "DELETE"]
        assert requests[-1].headers[MCP_SESSION_ID] == "active-session"


# ── Exception hierarchy ───────────────────────────────────────────────────────


class TestExceptionHierarchyNew:
    def test_streamable_http_error_is_exception(self):
        err = StreamableHTTPError("test")
        assert isinstance(err, Exception)

    def test_resumption_error_is_streamable_http_error(self):
        err = ResumptionError("test")
        assert isinstance(err, StreamableHTTPError)
        assert isinstance(err, Exception)


# ── RequestContext dataclass ──────────────────────────────────────────────────


class TestRequestContextNew:
    def test_creation(self):
        import queue

        q: queue.Queue = queue.Queue()
        with httpx.Client(transport=httpx.MockTransport(lambda _request: httpx.Response(200))) as client:
            ctx = RequestContext(
                client=client,
                headers={"X-Test": "val"},
                session_id="sid",
                session_message=SessionMessage(_make_request_msg()),
                metadata=None,
                server_to_client_queue=q,
                sse_read_timeout=30.0,
            )
            assert ctx.session_id == "sid"
            assert ctx.sse_read_timeout == 30.0
            assert ctx.metadata is None
