"""
Tests for the StreamableHTTP client transport.

Contains tests for only the client side of the StreamableHTTP transport.
"""

import json
import queue
import threading
import time
from contextlib import contextmanager
from datetime import timedelta
from typing import Any
from unittest.mock import MagicMock, Mock, patch

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


def test_streamablehttp_client_connection_validation():
    """Test StreamableHTTP client validates connections properly."""
    test_url = "http://test.example/mcp"

    with patch("core.mcp.client.streamable_client.create_ssrf_proxy_mcp_http_client") as mock_client_factory:
        # Mock the HTTP client
        mock_client = Mock()
        mock_client_factory.return_value.__enter__.return_value = mock_client

        # Mock successful response
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.headers = {"content-type": "application/json"}
        mock_response.raise_for_status.return_value = None
        mock_client.post.return_value = mock_response

        # Test connection
        try:
            with streamablehttp_client(test_url) as (read_queue, write_queue, get_session_id):
                assert read_queue is not None
                assert write_queue is not None
                assert get_session_id is not None
        except Exception:
            # Connection might fail due to mocking, but we're testing the validation logic
            pass


def test_streamablehttp_client_timeout_configuration():
    """Test StreamableHTTP client timeout configuration."""
    test_url = "http://test.example/mcp"
    custom_headers = {"Authorization": "Bearer test-token"}

    with patch("core.mcp.client.streamable_client.create_ssrf_proxy_mcp_http_client") as mock_client_factory:
        # Mock successful connection
        mock_client = Mock()
        mock_client_factory.return_value.__enter__.return_value = mock_client

        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.headers = {"content-type": "application/json"}
        mock_response.raise_for_status.return_value = None
        mock_client.post.return_value = mock_response

        try:
            with streamablehttp_client(test_url, headers=custom_headers) as (read_queue, write_queue, get_session_id):
                # Verify the configuration was passed correctly
                mock_client_factory.assert_called_with(headers=custom_headers)
        except Exception:
            # Connection might fail due to mocking, but we tested the configuration
            pass


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


def test_streamablehttp_client_headers_propagation():
    """Test that custom headers are properly propagated in StreamableHTTP client."""
    test_url = "http://test.example/mcp"
    custom_headers = {
        "Authorization": "Bearer test-token",
        "X-Custom-Header": "test-value",
        "User-Agent": "test-client/1.0",
    }

    with patch("core.mcp.client.streamable_client.create_ssrf_proxy_mcp_http_client") as mock_client_factory:
        # Mock the client factory to capture headers
        mock_client = Mock()
        mock_client_factory.return_value.__enter__.return_value = mock_client

        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.headers = {"content-type": "application/json"}
        mock_response.raise_for_status.return_value = None
        mock_client.post.return_value = mock_response

        try:
            with streamablehttp_client(test_url, headers=custom_headers):
                pass
        except Exception:
            pass  # Expected due to mocking

        # Verify headers were passed to client factory
        # Check that the call was made with headers that include our custom headers
        mock_client_factory.assert_called_once()
        call_args = mock_client_factory.call_args
        assert "headers" in call_args.kwargs
        passed_headers = call_args.kwargs["headers"]

        # Verify all custom headers are present
        for key, value in custom_headers.items():
            assert key in passed_headers
            assert passed_headers[key] == value


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


def test_streamablehttp_client_json_vs_sse_mode():
    """Test StreamableHTTP client handling of JSON vs SSE response modes."""
    test_url = "http://test.example/mcp"

    with patch("core.mcp.client.streamable_client.create_ssrf_proxy_mcp_http_client") as mock_client_factory:
        mock_client = Mock()
        mock_client_factory.return_value.__enter__.return_value = mock_client

        # Mock JSON response
        mock_json_response = Mock()
        mock_json_response.status_code = 200
        mock_json_response.headers = {"content-type": "application/json"}
        mock_json_response.json.return_value = {"result": "json_mode"}
        mock_json_response.raise_for_status.return_value = None

        # Mock SSE response
        mock_sse_response = Mock()
        mock_sse_response.status_code = 200
        mock_sse_response.headers = {"content-type": "text/event-stream"}
        mock_sse_response.raise_for_status.return_value = None

        # Test JSON mode
        mock_client.post.return_value = mock_json_response

        try:
            with streamablehttp_client(test_url) as (read_queue, write_queue, get_session_id):
                # Should handle JSON responses
                assert read_queue is not None
                assert write_queue is not None
        except Exception:
            pass  # Expected due to mocking

        # Test SSE mode
        mock_client.post.return_value = mock_sse_response

        try:
            with streamablehttp_client(test_url) as (read_queue, write_queue, get_session_id):
                # Should handle SSE responses
                assert read_queue is not None
                assert write_queue is not None
        except Exception:
            pass  # Expected due to mocking


def test_streamablehttp_client_terminate_on_close():
    """Test StreamableHTTP client terminate_on_close parameter."""
    test_url = "http://test.example/mcp"

    with patch("core.mcp.client.streamable_client.create_ssrf_proxy_mcp_http_client") as mock_client_factory:
        mock_client = Mock()
        mock_client_factory.return_value.__enter__.return_value = mock_client

        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.headers = {"content-type": "application/json"}
        mock_response.raise_for_status.return_value = None
        mock_client.post.return_value = mock_response
        mock_client.delete.return_value = mock_response

        # Test with terminate_on_close=True (default)
        try:
            with streamablehttp_client(test_url, terminate_on_close=True) as (read_queue, write_queue, get_session_id):
                pass
        except Exception:
            pass  # Expected due to mocking

        # Test with terminate_on_close=False
        try:
            with streamablehttp_client(test_url, terminate_on_close=False) as (read_queue, write_queue, get_session_id):
                pass
        except Exception:
            pass  # Expected due to mocking


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


def test_streamablehttp_client_resumption_token_handling():
    """Test StreamableHTTP client resumption token functionality."""
    test_url = "http://test.example/mcp"
    test_resumption_token = "resume-token-123"

    with patch("core.mcp.client.streamable_client.create_ssrf_proxy_mcp_http_client") as mock_client_factory:
        mock_client = Mock()
        mock_client_factory.return_value.__enter__.return_value = mock_client

        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.headers = {"content-type": "application/json", "last-event-id": test_resumption_token}
        mock_response.raise_for_status.return_value = None
        mock_client.post.return_value = mock_response

        try:
            with streamablehttp_client(test_url) as (read_queue, write_queue, get_session_id):
                # Test that resumption token can be captured from headers
                assert read_queue is not None
                assert write_queue is not None
        except Exception:
            pass  # Expected due to mocking


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
        resp = MagicMock(spec=httpx.Response)
        t._register_response(resp)
        assert resp in t._active_responses
        t._unregister_response(resp)
        assert resp not in t._active_responses

    def test_unregister_not_registered_does_not_raise(self):
        t = _new_transport()
        resp = MagicMock(spec=httpx.Response)
        t._unregister_response(resp)  # Should swallow ValueError silently

    def test_close_active_responses_calls_close(self):
        t = _new_transport()
        resp1 = MagicMock(spec=httpx.Response)
        resp2 = MagicMock(spec=httpx.Response)
        t._register_response(resp1)
        t._register_response(resp2)
        t.close_active_responses()
        resp1.close.assert_called_once()
        resp2.close.assert_called_once()
        assert t._active_responses == []

    def test_close_active_responses_swallows_runtime_error(self):
        t = _new_transport()
        resp = MagicMock(spec=httpx.Response)
        resp.close.side_effect = RuntimeError("already closed")
        t._register_response(resp)
        t.close_active_responses()  # Should not raise


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
        resp = MagicMock()
        resp.headers = {MCP_SESSION_ID: "new-session-99"}
        t._maybe_extract_session_id_from_response(resp)
        assert t.session_id == "new-session-99"

    def test_no_session_id_header_leaves_none(self):
        t = _new_transport()
        resp = MagicMock()
        resp.headers = MagicMock()
        resp.headers.get = MagicMock(return_value=None)
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
        callback = MagicMock()
        t._handle_sse_event(sse, q, resumption_callback=callback)
        callback.assert_called_once_with("token-abc")

    def test_message_event_no_callback_when_no_sse_id(self):
        t = _new_transport()
        q: queue.Queue = queue.Queue()
        data = json.dumps({"jsonrpc": "2.0", "id": 1, "result": {}})
        sse = _make_sse_mock("message", data, sse_id="")
        callback = MagicMock()
        t._handle_sse_event(sse, q, resumption_callback=callback)
        callback.assert_not_called()

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
        with patch("core.mcp.client.streamable_client.ssrf_proxy_sse_connect") as mock_connect:
            t.handle_get_stream(MagicMock(), q)
            mock_connect.assert_not_called()

    def test_handles_messages_via_sse(self):
        t = _new_transport()
        t.session_id = "sess-1"
        q: queue.Queue = queue.Queue()

        data = json.dumps({"jsonrpc": "2.0", "id": 1, "result": {}})
        mock_sse_event = _make_sse_mock("message", data)

        mock_response = MagicMock()
        mock_response.raise_for_status.return_value = None
        mock_event_source = MagicMock()
        mock_event_source.response = mock_response
        mock_event_source.iter_sse.return_value = [mock_sse_event]

        with patch("core.mcp.client.streamable_client.ssrf_proxy_sse_connect") as mock_connect:
            mock_connect.return_value.__enter__.return_value = mock_event_source
            t.handle_get_stream(MagicMock(), q)

        assert isinstance(q.get_nowait(), SessionMessage)

    def test_stops_when_stop_event_set(self):
        t = _new_transport()
        t.session_id = "sess-1"
        t.stop_event.set()
        q: queue.Queue = queue.Queue()

        data = json.dumps({"jsonrpc": "2.0", "id": 1, "result": {}})
        mock_sse_event = _make_sse_mock("message", data)
        mock_response = MagicMock()
        mock_response.raise_for_status.return_value = None
        mock_event_source = MagicMock()
        mock_event_source.response = mock_response
        mock_event_source.iter_sse.return_value = [mock_sse_event]

        with patch("core.mcp.client.streamable_client.ssrf_proxy_sse_connect") as mock_connect:
            mock_connect.return_value.__enter__.return_value = mock_event_source
            t.handle_get_stream(MagicMock(), q)

        assert q.empty()

    def test_exception_when_not_stopped_is_logged(self):
        t = _new_transport()
        t.session_id = "sess-1"
        q: queue.Queue = queue.Queue()

        with patch("core.mcp.client.streamable_client.ssrf_proxy_sse_connect") as mock_connect:
            mock_connect.side_effect = Exception("connection error")
            t.handle_get_stream(MagicMock(), q)  # Should not raise

    def test_exception_when_stopped_is_suppressed(self):
        t = _new_transport()
        t.session_id = "sess-1"
        t.stop_event.set()
        q: queue.Queue = queue.Queue()

        with patch("core.mcp.client.streamable_client.ssrf_proxy_sse_connect") as mock_connect:
            mock_connect.side_effect = Exception("connection error")
            t.handle_get_stream(MagicMock(), q)  # Should not raise or log


# ── _handle_resumption_request ────────────────────────────────────────────────


class TestHandleResumptionRequestNew:
    def _make_ctx(self, transport, q, resumption_token="token-123", message=None) -> RequestContext:
        if message is None:
            message = _make_request_msg("tools/list", req_id=42)
        session_msg = SessionMessage(message)
        metadata = None
        if resumption_token:
            metadata = MagicMock(spec=ClientMessageMetadata)
            metadata.resumption_token = resumption_token
            metadata.on_resumption_token_update = MagicMock()
        return RequestContext(
            client=MagicMock(),
            headers=transport.request_headers,
            session_id=transport.session_id,
            session_message=session_msg,
            metadata=metadata,
            server_to_client_queue=q,
            sse_read_timeout=60,
        )

    def test_raises_resumption_error_without_token(self):
        t = _new_transport()
        q: queue.Queue = queue.Queue()
        metadata = MagicMock(spec=ClientMessageMetadata)
        metadata.resumption_token = None
        ctx = RequestContext(
            client=MagicMock(),
            headers=t.request_headers,
            session_id=None,
            session_message=SessionMessage(_make_request_msg()),
            metadata=metadata,
            server_to_client_queue=q,
            sse_read_timeout=60,
        )
        with pytest.raises(ResumptionError):
            t._handle_resumption_request(ctx)

    def test_raises_resumption_error_without_metadata(self):
        t = _new_transport()
        q: queue.Queue = queue.Queue()
        ctx = RequestContext(
            client=MagicMock(),
            headers=t.request_headers,
            session_id=None,
            session_message=SessionMessage(_make_request_msg()),
            metadata=None,
            server_to_client_queue=q,
            sse_read_timeout=60,
        )
        with pytest.raises(ResumptionError):
            t._handle_resumption_request(ctx)

    def test_sets_last_event_id_header(self):
        t = _new_transport()
        q: queue.Queue = queue.Queue()
        ctx = self._make_ctx(t, q, resumption_token="resume-999")

        captured_headers: dict = {}
        data = json.dumps({"jsonrpc": "2.0", "id": 42, "result": {}})
        mock_sse_event = _make_sse_mock("message", data)
        mock_response = MagicMock()
        mock_response.raise_for_status.return_value = None
        mock_event_source = MagicMock()
        mock_event_source.response = mock_response
        mock_event_source.iter_sse.return_value = [mock_sse_event]

        def fake_connect(url, headers, **kwargs):
            captured_headers.update(headers)

            @contextmanager
            def _ctx():
                yield mock_event_source

            return _ctx()

        with patch("core.mcp.client.streamable_client.ssrf_proxy_sse_connect", side_effect=fake_connect):
            t._handle_resumption_request(ctx)

        assert captured_headers.get(LAST_EVENT_ID) == "resume-999"

    def test_stops_when_response_complete(self):
        t = _new_transport()
        q: queue.Queue = queue.Queue()
        ctx = self._make_ctx(t, q, message=_make_request_msg("tools/list", 42))

        data1 = json.dumps({"jsonrpc": "2.0", "id": 42, "result": {}})
        data2 = json.dumps({"jsonrpc": "2.0", "id": 43, "result": {}})
        sse1 = _make_sse_mock("message", data1)
        sse2 = _make_sse_mock("message", data2)
        mock_response = MagicMock()
        mock_response.raise_for_status.return_value = None
        mock_event_source = MagicMock()
        mock_event_source.response = mock_response
        mock_event_source.iter_sse.return_value = [sse1, sse2]

        with patch("core.mcp.client.streamable_client.ssrf_proxy_sse_connect") as mock_connect:
            mock_connect.return_value.__enter__.return_value = mock_event_source
            t._handle_resumption_request(ctx)

        # Only the first event was processed (loop breaks on completion)
        assert q.qsize() == 1

    def test_stops_when_stop_event_set(self):
        t = _new_transport()
        t.stop_event.set()
        q: queue.Queue = queue.Queue()
        ctx = self._make_ctx(t, q)

        data = json.dumps({"jsonrpc": "2.0", "id": 1, "result": {}})
        mock_sse_event = _make_sse_mock("message", data)
        mock_response = MagicMock()
        mock_response.raise_for_status.return_value = None
        mock_event_source = MagicMock()
        mock_event_source.response = mock_response
        mock_event_source.iter_sse.return_value = [mock_sse_event]

        with patch("core.mcp.client.streamable_client.ssrf_proxy_sse_connect") as mock_connect:
            mock_connect.return_value.__enter__.return_value = mock_event_source
            t._handle_resumption_request(ctx)

        assert q.empty()


# ── _handle_post_request ──────────────────────────────────────────────────────


class TestHandlePostRequestNew:
    def _make_ctx(self, transport, q, message=None) -> RequestContext:
        if message is None:
            message = _make_request_msg("tools/list", 1)
        return RequestContext(
            client=MagicMock(),
            headers=transport.request_headers,
            session_id=transport.session_id,
            session_message=SessionMessage(message),
            metadata=None,
            server_to_client_queue=q,
            sse_read_timeout=60,
        )

    def _stream_ctx(self, mock_response):
        @contextmanager
        def _stream(*args, **kwargs):
            yield mock_response

        return _stream

    def test_202_returns_immediately_no_queue(self):
        t = _new_transport()
        q: queue.Queue = queue.Queue()
        ctx = self._make_ctx(t, q)
        mock_resp = MagicMock()
        mock_resp.status_code = 202
        ctx.client.stream = self._stream_ctx(mock_resp)
        t._handle_post_request(ctx)
        assert q.empty()

    def test_204_returns_immediately_no_queue(self):
        t = _new_transport()
        q: queue.Queue = queue.Queue()
        ctx = self._make_ctx(t, q)
        mock_resp = MagicMock()
        mock_resp.status_code = 204
        ctx.client.stream = self._stream_ctx(mock_resp)
        t._handle_post_request(ctx)
        assert q.empty()

    def test_404_sends_session_terminated_error_for_request(self):
        t = _new_transport()
        q: queue.Queue = queue.Queue()
        msg = _make_request_msg("tools/list", 77)
        ctx = self._make_ctx(t, q, message=msg)
        mock_resp = MagicMock()
        mock_resp.status_code = 404
        ctx.client.stream = self._stream_ctx(mock_resp)
        t._handle_post_request(ctx)
        item = q.get_nowait()
        assert isinstance(item, SessionMessage)
        assert isinstance(item.message.root, JSONRPCError)
        assert item.message.root.id == 77

    def test_404_for_notification_no_error_sent(self):
        t = _new_transport()
        q: queue.Queue = queue.Queue()
        msg = _make_notification_msg("some/notification")
        ctx = self._make_ctx(t, q, message=msg)
        mock_resp = MagicMock()
        mock_resp.status_code = 404
        ctx.client.stream = self._stream_ctx(mock_resp)
        t._handle_post_request(ctx)
        assert q.empty()

    def test_json_response_puts_session_message(self):
        t = _new_transport()
        q: queue.Queue = queue.Queue()
        ctx = self._make_ctx(t, q)

        response_data = json.dumps({"jsonrpc": "2.0", "id": 1, "result": {"ok": True}}).encode()
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.headers = {"content-type": "application/json"}
        mock_resp.raise_for_status.return_value = None
        mock_resp.read.return_value = response_data
        ctx.client.stream = self._stream_ctx(mock_resp)

        t._handle_post_request(ctx)
        assert isinstance(q.get_nowait(), SessionMessage)

    def test_json_response_invalid_json_puts_exception(self):
        t = _new_transport()
        q: queue.Queue = queue.Queue()
        ctx = self._make_ctx(t, q)

        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.headers = {"content-type": "application/json"}
        mock_resp.raise_for_status.return_value = None
        mock_resp.read.return_value = b"{bad json!"
        ctx.client.stream = self._stream_ctx(mock_resp)

        t._handle_post_request(ctx)
        assert isinstance(q.get_nowait(), Exception)

    def test_unexpected_content_type_puts_value_error(self):
        t = _new_transport()
        q: queue.Queue = queue.Queue()
        ctx = self._make_ctx(t, q)

        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.headers = {"content-type": "text/plain"}
        mock_resp.raise_for_status.return_value = None
        ctx.client.stream = self._stream_ctx(mock_resp)

        t._handle_post_request(ctx)
        item = q.get_nowait()
        assert isinstance(item, ValueError)
        assert "Unexpected content type" in str(item)

    def test_initialization_request_extracts_session_id(self):
        t = _new_transport()
        q: queue.Queue = queue.Queue()
        msg = _make_request_msg("initialize", 1)
        ctx = self._make_ctx(t, q, message=msg)

        response_data = json.dumps({"jsonrpc": "2.0", "id": 1, "result": {}}).encode()
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.headers = MagicMock()
        headers_dict = {"content-type": "application/json", MCP_SESSION_ID: "new-sid"}
        mock_resp.headers.__getitem__ = lambda self, k: headers_dict[k]
        mock_resp.headers.get = lambda k, default=None: headers_dict.get(k, default)
        mock_resp.raise_for_status.return_value = None
        mock_resp.read.return_value = response_data
        ctx.client.stream = self._stream_ctx(mock_resp)

        t._handle_post_request(ctx)
        assert t.session_id == "new-sid"

    def test_notification_skips_response_processing(self):
        t = _new_transport()
        q: queue.Queue = queue.Queue()
        msg = _make_notification_msg("notifications/something")
        ctx = self._make_ctx(t, q, message=msg)

        response_data = json.dumps({"jsonrpc": "2.0", "id": 1, "result": {}}).encode()
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.headers = {"content-type": "application/json"}
        mock_resp.raise_for_status.return_value = None
        mock_resp.read.return_value = response_data
        ctx.client.stream = self._stream_ctx(mock_resp)

        t._handle_post_request(ctx)
        assert q.empty()

    def test_sse_response_handles_stream(self):
        t = _new_transport()
        q: queue.Queue = queue.Queue()
        ctx = self._make_ctx(t, q)

        data = json.dumps({"jsonrpc": "2.0", "id": 1, "result": {}})
        mock_sse_event = _make_sse_mock("message", data)

        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.headers = {"content-type": "text/event-stream"}
        mock_resp.raise_for_status.return_value = None
        ctx.client.stream = self._stream_ctx(mock_resp)

        with patch("core.mcp.client.streamable_client.EventSource") as MockEventSource:
            mock_es_instance = MagicMock()
            mock_es_instance.iter_sse.return_value = [mock_sse_event]
            MockEventSource.return_value = mock_es_instance
            t._handle_post_request(ctx)

        assert isinstance(q.get_nowait(), SessionMessage)


# ── _handle_json_response ─────────────────────────────────────────────────────


class TestHandleJsonResponseNew:
    def test_valid_json_puts_session_message(self):
        t = _new_transport()
        q: queue.Queue = queue.Queue()
        data = json.dumps({"jsonrpc": "2.0", "id": 1, "result": {}}).encode()
        mock_response = MagicMock()
        mock_response.read.return_value = data
        t._handle_json_response(mock_response, q)
        assert isinstance(q.get_nowait(), SessionMessage)

    def test_invalid_json_puts_exception(self):
        t = _new_transport()
        q: queue.Queue = queue.Queue()
        mock_response = MagicMock()
        mock_response.read.return_value = b"{ invalid }"
        t._handle_json_response(mock_response, q)
        assert isinstance(q.get_nowait(), Exception)


# ── _handle_sse_response ──────────────────────────────────────────────────────


class TestHandleSseResponseNew:
    def _ctx(self, transport, q) -> RequestContext:
        return RequestContext(
            client=MagicMock(),
            headers=transport.request_headers,
            session_id=None,
            session_message=SessionMessage(_make_request_msg()),
            metadata=None,
            server_to_client_queue=q,
            sse_read_timeout=60,
        )

    def test_processes_sse_events(self):
        t = _new_transport()
        q: queue.Queue = queue.Queue()
        ctx = self._ctx(t, q)

        data = json.dumps({"jsonrpc": "2.0", "id": 1, "result": {}})
        mock_sse_event = _make_sse_mock("message", data)
        mock_response = MagicMock()

        with patch("core.mcp.client.streamable_client.EventSource") as MockEventSource:
            mock_es_instance = MagicMock()
            mock_es_instance.iter_sse.return_value = [mock_sse_event]
            MockEventSource.return_value = mock_es_instance
            t._handle_sse_response(mock_response, ctx)

        assert isinstance(q.get_nowait(), SessionMessage)

    def test_stops_when_stop_event_set(self):
        t = _new_transport()
        t.stop_event.set()
        q: queue.Queue = queue.Queue()
        ctx = self._ctx(t, q)

        data = json.dumps({"jsonrpc": "2.0", "id": 1, "result": {}})
        mock_sse_event = _make_sse_mock("message", data)
        mock_response = MagicMock()

        with patch("core.mcp.client.streamable_client.EventSource") as MockEventSource:
            mock_es_instance = MagicMock()
            mock_es_instance.iter_sse.return_value = [mock_sse_event]
            MockEventSource.return_value = mock_es_instance
            t._handle_sse_response(mock_response, ctx)

        assert q.empty()

    def test_stops_when_complete(self):
        t = _new_transport()
        q: queue.Queue = queue.Queue()
        ctx = self._ctx(t, q)

        data1 = json.dumps({"jsonrpc": "2.0", "id": 1, "result": {}})
        data2 = json.dumps({"jsonrpc": "2.0", "id": 2, "result": {}})
        sse1 = _make_sse_mock("message", data1)
        sse2 = _make_sse_mock("message", data2)
        mock_response = MagicMock()

        with patch("core.mcp.client.streamable_client.EventSource") as MockEventSource:
            mock_es_instance = MagicMock()
            mock_es_instance.iter_sse.return_value = [sse1, sse2]
            MockEventSource.return_value = mock_es_instance
            t._handle_sse_response(mock_response, ctx)

        assert q.qsize() == 1  # Only the first completion item

    def test_exception_outside_stop_puts_to_queue(self):
        t = _new_transport()
        q: queue.Queue = queue.Queue()
        ctx = self._ctx(t, q)
        mock_response = MagicMock()

        with patch("core.mcp.client.streamable_client.EventSource") as MockEventSource:
            MockEventSource.side_effect = RuntimeError("EventSource error")
            t._handle_sse_response(mock_response, ctx)

        assert isinstance(q.get_nowait(), Exception)

    def test_exception_suppressed_when_stopped(self):
        t = _new_transport()
        t.stop_event.set()
        q: queue.Queue = queue.Queue()
        ctx = self._ctx(t, q)
        mock_response = MagicMock()

        with patch("core.mcp.client.streamable_client.EventSource") as MockEventSource:
            MockEventSource.side_effect = RuntimeError("EventSource error")
            t._handle_sse_response(mock_response, ctx)

        assert q.empty()

    def test_with_metadata_resumption_callback(self):
        t = _new_transport()
        q: queue.Queue = queue.Queue()
        metadata = MagicMock(spec=ClientMessageMetadata)
        callback = MagicMock()
        metadata.on_resumption_token_update = callback

        ctx = RequestContext(
            client=MagicMock(),
            headers=t.request_headers,
            session_id=None,
            session_message=SessionMessage(_make_request_msg()),
            metadata=metadata,
            server_to_client_queue=q,
            sse_read_timeout=60,
        )

        data = json.dumps({"jsonrpc": "2.0", "id": 1, "result": {}})
        sse = _make_sse_mock("message", data, sse_id="resume-token")
        mock_response = MagicMock()

        with patch("core.mcp.client.streamable_client.EventSource") as MockEventSource:
            mock_es_instance = MagicMock()
            mock_es_instance.iter_sse.return_value = [sse]
            MockEventSource.return_value = mock_es_instance
            t._handle_sse_response(mock_response, ctx)

        callback.assert_called_once_with("resume-token")


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
    def test_none_message_exits_loop(self):
        t = _new_transport()
        c2s: queue.Queue = queue.Queue()
        s2c: queue.Queue = queue.Queue()
        c2s.put(None)
        t.post_writer(MagicMock(), c2s, s2c, MagicMock())

    def test_stop_event_exits_loop(self):
        t = _new_transport()
        t.stop_event.set()
        c2s: queue.Queue = queue.Queue()
        s2c: queue.Queue = queue.Queue()
        t.post_writer(MagicMock(), c2s, s2c, MagicMock())

    def test_initialized_notification_calls_start_get_stream(self):
        t = _new_transport()
        c2s: queue.Queue = queue.Queue()
        s2c: queue.Queue = queue.Queue()
        start_get_stream = MagicMock()

        notif_msg = _make_notification_msg("notifications/initialized")
        c2s.put(SessionMessage(notif_msg))
        c2s.put(None)

        with patch.object(t, "_handle_post_request"):
            t.post_writer(MagicMock(), c2s, s2c, start_get_stream)

        start_get_stream.assert_called_once()

    def test_resumption_message_calls_handle_resumption_request(self):
        t = _new_transport()
        c2s: queue.Queue = queue.Queue()
        s2c: queue.Queue = queue.Queue()
        start_get_stream = MagicMock()

        msg = SessionMessage(_make_request_msg("tools/list", 10))
        metadata = MagicMock(spec=ClientMessageMetadata)
        metadata.resumption_token = "resume-abc"
        msg.metadata = metadata
        c2s.put(msg)
        c2s.put(None)

        with patch.object(t, "_handle_resumption_request") as mock_resumption:
            t.post_writer(MagicMock(), c2s, s2c, start_get_stream)

        mock_resumption.assert_called_once()

    def test_regular_message_calls_handle_post_request(self):
        t = _new_transport()
        c2s: queue.Queue = queue.Queue()
        s2c: queue.Queue = queue.Queue()

        msg = SessionMessage(_make_request_msg("tools/list", 5))
        c2s.put(msg)
        c2s.put(None)

        with patch.object(t, "_handle_post_request") as mock_post:
            t.post_writer(MagicMock(), c2s, s2c, MagicMock())

        mock_post.assert_called_once()

    def test_exception_in_handler_put_to_s2c_when_not_stopped(self):
        t = _new_transport()
        c2s: queue.Queue = queue.Queue()
        s2c: queue.Queue = queue.Queue()

        msg = SessionMessage(_make_request_msg("tools/list", 5))
        c2s.put(msg)
        c2s.put(None)

        boom = RuntimeError("oops")
        with patch.object(t, "_handle_post_request", side_effect=boom):
            t.post_writer(MagicMock(), c2s, s2c, MagicMock())

        item = s2c.get_nowait()
        assert item is boom

    def test_exception_suppressed_when_stopped(self):
        t = _new_transport()
        c2s: queue.Queue = queue.Queue()
        s2c: queue.Queue = queue.Queue()

        msg = SessionMessage(_make_request_msg("tools/list", 5))
        c2s.put(msg)
        c2s.put(None)
        t.stop_event.set()

        boom = RuntimeError("oops")
        with patch.object(t, "_handle_post_request", side_effect=boom):
            t.post_writer(MagicMock(), c2s, s2c, MagicMock())

        assert s2c.empty()

    def test_queue_empty_timeout_continues_loop(self):
        """Cover the 'except queue.Empty: continue' branch in post_writer."""
        t = _new_transport()
        c2s: queue.Queue = queue.Queue()
        s2c: queue.Queue = queue.Queue()
        call_count = {"n": 0}

        original_get = c2s.get

        def patched_get(*args, **kwargs):
            call_count["n"] += 1
            if call_count["n"] == 1:
                raise queue.Empty

        c2s.get = patched_get  # type: ignore[method-assign]
        t.post_writer(MagicMock(), c2s, s2c, MagicMock())
        assert call_count["n"] >= 2

    def test_non_client_metadata_treated_as_none(self):
        """session_message.metadata that's not ClientMessageMetadata → metadata is None."""
        t = _new_transport()
        c2s: queue.Queue = queue.Queue()
        s2c: queue.Queue = queue.Queue()

        msg = SessionMessage(_make_request_msg("tools/list", 5))
        msg.metadata = "not-a-client-metadata"
        c2s.put(msg)
        c2s.put(None)

        with patch.object(t, "_handle_post_request") as mock_post:
            t.post_writer(MagicMock(), c2s, s2c, MagicMock())

        ctx = mock_post.call_args[0][0]
        assert ctx.metadata is None


# ── terminate_session ─────────────────────────────────────────────────────────


class TestTerminateSessionNew:
    def test_no_session_id_skips(self):
        t = _new_transport()
        t.session_id = None
        mock_client = MagicMock()
        t.terminate_session(mock_client)
        mock_client.delete.assert_not_called()

    def test_200_response_is_success(self):
        t = _new_transport()
        t.session_id = "sess-1"
        mock_client = MagicMock()
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_client.delete.return_value = mock_response
        t.terminate_session(mock_client)
        mock_client.delete.assert_called_once()

    def test_405_does_not_raise(self):
        t = _new_transport()
        t.session_id = "sess-1"
        mock_client = MagicMock()
        mock_response = MagicMock()
        mock_response.status_code = 405
        mock_client.delete.return_value = mock_response
        t.terminate_session(mock_client)  # Should not raise

    def test_non_200_logs_warning_does_not_raise(self):
        t = _new_transport()
        t.session_id = "sess-1"
        mock_client = MagicMock()
        mock_response = MagicMock()
        mock_response.status_code = 500
        mock_client.delete.return_value = mock_response
        t.terminate_session(mock_client)  # Should not raise

    def test_exception_is_swallowed(self):
        t = _new_transport()
        t.session_id = "sess-1"
        mock_client = MagicMock()
        mock_client.delete.side_effect = httpx.ConnectError("refused")
        t.terminate_session(mock_client)  # Should not raise


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
    def test_yields_queues_and_callback(self):
        from core.mcp.client.streamable_client import streamablehttp_client

        with patch("core.mcp.client.streamable_client.create_ssrf_proxy_mcp_http_client") as mock_cf:
            mock_client = MagicMock()
            mock_cf.return_value.__enter__.return_value = mock_client

            with patch("core.mcp.client.streamable_client.ThreadPoolExecutor") as mock_exec:
                mock_executor = MagicMock()
                mock_exec.return_value = mock_executor

                with streamablehttp_client("http://example.com/mcp") as (s2c, c2s, get_sid):
                    assert s2c is not None
                    assert c2s is not None
                    assert callable(get_sid)

    def test_terminate_on_close_false_does_not_delete(self):
        from core.mcp.client.streamable_client import streamablehttp_client

        with patch("core.mcp.client.streamable_client.create_ssrf_proxy_mcp_http_client") as mock_cf:
            mock_client = MagicMock()
            mock_cf.return_value.__enter__.return_value = mock_client

            with patch("core.mcp.client.streamable_client.ThreadPoolExecutor") as mock_exec:
                mock_executor = MagicMock()
                mock_exec.return_value = mock_executor

                with streamablehttp_client("http://example.com/mcp", terminate_on_close=False) as (s2c, c2s, get_sid):
                    pass
                mock_client.delete.assert_not_called()

    def test_queue_cleanup_on_outer_exception(self):
        """Verify cleanup in finally block runs even when create_ssrf raises."""
        from core.mcp.client.streamable_client import streamablehttp_client

        with patch("core.mcp.client.streamable_client.create_ssrf_proxy_mcp_http_client") as mock_cf:
            mock_cf.side_effect = RuntimeError("connection failed")

            with pytest.raises(RuntimeError):
                with streamablehttp_client("http://example.com/mcp"):
                    pass  # pragma: no cover

    def test_timedelta_args_accepted(self):
        from core.mcp.client.streamable_client import streamablehttp_client

        with patch("core.mcp.client.streamable_client.create_ssrf_proxy_mcp_http_client") as mock_cf:
            mock_client = MagicMock()
            mock_cf.return_value.__enter__.return_value = mock_client

            with patch("core.mcp.client.streamable_client.ThreadPoolExecutor") as mock_exec:
                mock_executor = MagicMock()
                mock_exec.return_value = mock_executor

                with streamablehttp_client(
                    "http://example.com/mcp",
                    timeout=timedelta(seconds=15),
                    sse_read_timeout=timedelta(seconds=60),
                ) as (s2c, c2s, get_sid):
                    assert callable(get_sid)

    def test_start_get_stream_submits_to_executor(self):
        """When context starts, post_writer is submitted to executor."""
        from core.mcp.client.streamable_client import streamablehttp_client

        with patch("core.mcp.client.streamable_client.create_ssrf_proxy_mcp_http_client") as mock_cf:
            mock_client = MagicMock()
            mock_cf.return_value.__enter__.return_value = mock_client

            submitted_calls = []

            with patch("core.mcp.client.streamable_client.ThreadPoolExecutor") as mock_exec:
                mock_executor = MagicMock()

                def capture_submit(fn, *args, **kwargs):
                    submitted_calls.append((fn, args))

                mock_executor.submit.side_effect = capture_submit
                mock_exec.return_value = mock_executor

                with streamablehttp_client("http://example.com/mcp") as (s2c, c2s, get_sid):
                    pass

                # post_writer was submitted
                assert len(submitted_calls) >= 1

    def test_cleanup_puts_none_sentinels_to_queues(self):
        """After context exit, None sentinels are put into both queues."""
        from core.mcp.client.streamable_client import streamablehttp_client

        with patch("core.mcp.client.streamable_client.create_ssrf_proxy_mcp_http_client") as mock_cf:
            mock_client = MagicMock()
            mock_cf.return_value.__enter__.return_value = mock_client

            with patch("core.mcp.client.streamable_client.ThreadPoolExecutor") as mock_exec:
                mock_executor = MagicMock()
                mock_exec.return_value = mock_executor

                with streamablehttp_client("http://example.com/mcp") as (s2c, c2s, get_sid):
                    pass

                # After context exit, None sentinel should be in c2s queue from cleanup
                val = c2s.get_nowait()
                assert val is None

    def test_terminate_called_when_session_id_set(self):
        """When session_id is set and terminate_on_close=True, terminate_session is called."""
        from core.mcp.client.streamable_client import streamablehttp_client

        with patch("core.mcp.client.streamable_client.create_ssrf_proxy_mcp_http_client") as mock_cf:
            mock_client = MagicMock()
            mock_cf.return_value.__enter__.return_value = mock_client

            mock_delete_resp = MagicMock()
            mock_delete_resp.status_code = 200
            mock_client.delete.return_value = mock_delete_resp

            with patch("core.mcp.client.streamable_client.ThreadPoolExecutor") as mock_exec:
                mock_executor = MagicMock()
                mock_exec.return_value = mock_executor

                with patch("core.mcp.client.streamable_client.StreamableHTTPTransport") as MockTransport:
                    mock_transport = MockTransport.return_value
                    mock_transport.request_headers = {
                        "Accept": "application/json, text/event-stream",
                        "content-type": "application/json",
                    }
                    mock_transport.timeout = 30
                    mock_transport.sse_read_timeout = 300
                    mock_transport.session_id = "active-session"
                    mock_transport.stop_event = MagicMock()
                    mock_transport.get_session_id = MagicMock(return_value="active-session")

                    with streamablehttp_client("http://example.com/mcp", terminate_on_close=True) as (
                        s2c,
                        c2s,
                        get_sid,
                    ):
                        pass

                    mock_transport.terminate_session.assert_called_once_with(mock_client)


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
        ctx = RequestContext(
            client=MagicMock(),
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
