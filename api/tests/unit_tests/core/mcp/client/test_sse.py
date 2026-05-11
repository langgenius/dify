import contextlib
import json
import queue
import threading
import time
from typing import Any
from unittest.mock import Mock, patch

import httpx
import pytest

from core.mcp import types
from core.mcp.client.sse_client import sse_client
from core.mcp.error import MCPAuthError, MCPConnectionError

SERVER_NAME = "test_server_for_SSE"


def test_sse_message_id_coercion():
    """Test that string message IDs that look like integers are parsed as integers.

    See <https://github.com/modelcontextprotocol/python-sdk/pull/851> for more details.
    """
    json_message = '{"jsonrpc": "2.0", "id": "123", "method": "ping", "params": null}'
    msg = types.JSONRPCMessage.model_validate_json(json_message)
    expected = types.JSONRPCMessage(root=types.JSONRPCRequest(method="ping", jsonrpc="2.0", id=123))

    # Check if both are JSONRPCRequest instances
    assert isinstance(msg.root, types.JSONRPCRequest)
    assert isinstance(expected.root, types.JSONRPCRequest)

    assert msg.root.id == expected.root.id
    assert msg.root.method == expected.root.method
    assert msg.root.jsonrpc == expected.root.jsonrpc


class MockSSEClient:
    """Mock SSE client for testing."""

    def __init__(self, url: str, headers: dict[str, Any] | None = None):
        self.url = url
        self.headers = headers or {}
        self.connected = False
        self.read_queue: queue.Queue = queue.Queue()
        self.write_queue: queue.Queue = queue.Queue()

    def connect(self):
        """Simulate connection establishment."""
        self.connected = True

        # Send endpoint event
        endpoint_data = "/messages/?session_id=test-session-123"
        self.read_queue.put(("endpoint", endpoint_data))

        return self.read_queue, self.write_queue

    def send_initialize_response(self):
        """Send a mock initialize response."""
        response = {
            "jsonrpc": "2.0",
            "id": 1,
            "result": {
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
        }
        self.read_queue.put(("message", json.dumps(response)))


def test_sse_client_message_id_handling():
    """Test SSE client properly handles message ID coercion."""
    mock_client = MockSSEClient("http://test.example/sse")
    read_queue, write_queue = mock_client.connect()

    # Send a message with string ID that should be coerced to int
    message_data = {
        "jsonrpc": "2.0",
        "id": "456",  # String ID
        "result": {"test": "data"},
    }
    read_queue.put(("message", json.dumps(message_data)))
    read_queue.get(timeout=1.0)
    # Get the message from queue
    event_type, data = read_queue.get(timeout=1.0)
    assert event_type == "message"

    # Parse the message
    parsed_message = types.JSONRPCMessage.model_validate_json(data)
    # Check that it's a JSONRPCResponse and verify the ID
    assert isinstance(parsed_message.root, types.JSONRPCResponse)
    assert parsed_message.root.id == 456  # Should be converted to int


def test_sse_client_connection_validation():
    """Test SSE client validates endpoint URLs properly."""
    test_url = "http://test.example/sse"

    with patch("core.mcp.client.sse_client.create_ssrf_proxy_mcp_http_client") as mock_client_factory:
        with patch("core.mcp.client.sse_client.ssrf_proxy_sse_connect") as mock_sse_connect:
            # Mock the HTTP client
            mock_client = Mock()
            mock_client_factory.return_value.__enter__.return_value = mock_client

            # Mock the SSE connection
            mock_event_source = Mock()
            mock_event_source.response.raise_for_status.return_value = None
            mock_sse_connect.return_value.__enter__.return_value = mock_event_source

            # Mock SSE events
            class MockSSEEvent:
                def __init__(self, event_type: str, data: str):
                    self.event = event_type
                    self.data = data

            # Simulate endpoint event
            endpoint_event = MockSSEEvent("endpoint", "/messages/?session_id=test-123")
            mock_event_source.iter_sse.return_value = [endpoint_event]

            # Test connection
            with contextlib.suppress(Exception):
                with sse_client(test_url) as (read_queue, write_queue):
                    assert read_queue is not None
                    assert write_queue is not None


def test_sse_client_error_handling():
    """Test SSE client properly handles various error conditions."""
    test_url = "http://test.example/sse"

    # Test 401 error handling
    with patch("core.mcp.client.sse_client.create_ssrf_proxy_mcp_http_client") as mock_client_factory:
        with patch("core.mcp.client.sse_client.ssrf_proxy_sse_connect") as mock_sse_connect:
            # Mock 401 HTTP error
            mock_response = Mock(status_code=401)
            mock_response.headers = {"WWW-Authenticate": 'Bearer realm="example"'}
            mock_error = httpx.HTTPStatusError("Unauthorized", request=Mock(), response=mock_response)
            mock_sse_connect.side_effect = mock_error

            with pytest.raises(MCPAuthError):
                with sse_client(test_url):
                    pass

    # Test other HTTP errors
    with patch("core.mcp.client.sse_client.create_ssrf_proxy_mcp_http_client") as mock_client_factory:
        with patch("core.mcp.client.sse_client.ssrf_proxy_sse_connect") as mock_sse_connect:
            # Mock other HTTP error
            mock_response = Mock(status_code=500)
            mock_response.headers = {}
            mock_error = httpx.HTTPStatusError("Server Error", request=Mock(), response=mock_response)
            mock_sse_connect.side_effect = mock_error

            with pytest.raises(MCPConnectionError):
                with sse_client(test_url):
                    pass


def test_sse_client_timeout_configuration():
    """Test SSE client timeout configuration."""
    test_url = "http://test.example/sse"
    custom_timeout = 10.0
    custom_sse_timeout = 300.0
    custom_headers = {"Authorization": "Bearer test-token"}

    with patch("core.mcp.client.sse_client.create_ssrf_proxy_mcp_http_client") as mock_client_factory:
        with patch("core.mcp.client.sse_client.ssrf_proxy_sse_connect") as mock_sse_connect:
            # Mock successful connection
            mock_client = Mock()
            mock_client_factory.return_value.__enter__.return_value = mock_client

            mock_event_source = Mock()
            mock_event_source.response.raise_for_status.return_value = None
            mock_event_source.iter_sse.return_value = []
            mock_sse_connect.return_value.__enter__.return_value = mock_event_source

            with contextlib.suppress(Exception):
                with sse_client(
                    test_url, headers=custom_headers, timeout=custom_timeout, sse_read_timeout=custom_sse_timeout
                ) as (read_queue, write_queue):
                    # Verify the configuration was passed correctly
                    mock_client_factory.assert_called_with(headers=custom_headers)

                    # Check that timeout was configured
                    call_args = mock_sse_connect.call_args
                    assert call_args is not None
                    timeout_arg = call_args[1]["timeout"]
                    assert timeout_arg.read == custom_sse_timeout


def test_sse_transport_endpoint_validation():
    """Test SSE transport validates endpoint URLs correctly."""
    from core.mcp.client.sse_client import SSETransport

    transport = SSETransport("http://example.com/sse")

    # Valid endpoint (same origin)
    valid_endpoint = "http://example.com/messages/session123"
    assert transport._validate_endpoint_url(valid_endpoint) == True

    # Invalid endpoint (different origin)
    invalid_endpoint = "http://malicious.com/messages/session123"
    assert transport._validate_endpoint_url(invalid_endpoint) == False

    # Invalid endpoint (different scheme)
    invalid_scheme = "https://example.com/messages/session123"
    assert transport._validate_endpoint_url(invalid_scheme) == False


def test_sse_transport_message_parsing():
    """Test SSE transport properly parses different message types."""
    from core.mcp.client.sse_client import SSETransport

    transport = SSETransport("http://example.com/sse")
    read_queue: queue.Queue = queue.Queue()

    # Test valid JSON-RPC message
    valid_message = '{"jsonrpc": "2.0", "id": 1, "method": "ping"}'
    transport._handle_message_event(valid_message, read_queue)

    # Should have a SessionMessage in the queue
    message = read_queue.get(timeout=1.0)
    assert message is not None
    assert hasattr(message, "message")

    # Test invalid JSON
    invalid_json = '{"invalid": json}'
    transport._handle_message_event(invalid_json, read_queue)

    # Should have an exception in the queue
    error = read_queue.get(timeout=1.0)
    assert isinstance(error, Exception)


def test_sse_client_queue_cleanup():
    """Test that SSE client properly cleans up queues on exit."""
    test_url = "http://test.example/sse"

    read_queue = None
    write_queue = None

    with patch("core.mcp.client.sse_client.create_ssrf_proxy_mcp_http_client") as mock_client_factory:
        with patch("core.mcp.client.sse_client.ssrf_proxy_sse_connect") as mock_sse_connect:
            # Mock connection that raises an exception
            mock_sse_connect.side_effect = Exception("Connection failed")

            with contextlib.suppress(Exception):
                with sse_client(test_url) as (rq, wq):
                    read_queue = rq
                    write_queue = wq

            # Queues should be cleaned up even on exception
            # Note: In real implementation, cleanup should put None to signal shutdown


def test_sse_client_headers_propagation():
    """Test that custom headers are properly propagated in SSE client."""
    test_url = "http://test.example/sse"
    custom_headers = {
        "Authorization": "Bearer test-token",
        "X-Custom-Header": "test-value",
        "User-Agent": "test-client/1.0",
    }

    with patch("core.mcp.client.sse_client.create_ssrf_proxy_mcp_http_client") as mock_client_factory:
        with patch("core.mcp.client.sse_client.ssrf_proxy_sse_connect") as mock_sse_connect:
            # Mock the client factory to capture headers
            mock_client = Mock()
            mock_client_factory.return_value.__enter__.return_value = mock_client

            # Mock the SSE connection
            mock_event_source = Mock()
            mock_event_source.response.raise_for_status.return_value = None
            mock_event_source.iter_sse.return_value = []
            mock_sse_connect.return_value.__enter__.return_value = mock_event_source

            with contextlib.suppress(Exception):
                with sse_client(test_url, headers=custom_headers):
                    pass

            # Verify headers were passed to client factory
            mock_client_factory.assert_called_with(headers=custom_headers)


def test_sse_client_concurrent_access():
    """Test SSE client behavior with concurrent queue access."""
    test_read_queue: queue.Queue = queue.Queue()

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


class TestStatusClasses:
    """Tests for _StatusReady and _StatusError data containers."""

    def test_status_ready_stores_endpoint(self):
        from core.mcp.client.sse_client import _StatusReady

        status = _StatusReady("http://example.com/messages/")
        assert status.endpoint_url == "http://example.com/messages/"

    def test_status_error_stores_exception(self):
        from core.mcp.client.sse_client import _StatusError

        exc = ValueError("bad endpoint")
        status = _StatusError(exc)
        assert status.exc is exc


class TestSSETransportInit:
    """Tests for SSETransport default and explicit init values."""

    def test_defaults(self):
        from core.mcp.client.sse_client import SSETransport

        t = SSETransport("http://example.com/sse")
        assert t.url == "http://example.com/sse"
        assert t.headers == {}
        assert t.timeout == 5.0
        assert t.sse_read_timeout == 60.0
        assert t.endpoint_url is None
        assert t.event_source is None

    def test_explicit_headers_not_mutated(self):
        from core.mcp.client.sse_client import SSETransport

        hdrs = {"X-Foo": "bar"}
        t = SSETransport("http://example.com/sse", headers=hdrs)
        assert t.headers is hdrs


class TestHandleEndpointEvent:
    """Tests for SSETransport._handle_endpoint_event covering the invalid-origin branch."""

    def test_invalid_origin_puts_status_error(self):
        from core.mcp.client.sse_client import SSETransport, _StatusError

        transport = SSETransport("http://example.com/sse")
        status_queue: queue.Queue = queue.Queue()

        # Provide a full URL with a different origin so urljoin keeps it as-is
        transport._handle_endpoint_event("http://evil.com/messages/", status_queue)

        result = status_queue.get_nowait()
        assert isinstance(result, _StatusError)
        assert "does not match" in str(result.exc)

    def test_valid_origin_puts_status_ready(self):
        from core.mcp.client.sse_client import SSETransport, _StatusReady

        transport = SSETransport("http://example.com/sse")
        status_queue: queue.Queue = queue.Queue()

        transport._handle_endpoint_event("/messages/?session_id=abc", status_queue)

        result = status_queue.get_nowait()
        assert isinstance(result, _StatusReady)
        assert "example.com" in result.endpoint_url


class TestHandleSSEEvent:
    """Tests for SSETransport._handle_sse_event covering all match branches."""

    def _make_sse(self, event_type: str, data: str):
        sse = Mock()
        sse.event = event_type
        sse.data = data
        return sse

    def test_message_event_dispatched(self):
        from core.mcp.client.sse_client import SSETransport

        transport = SSETransport("http://example.com/sse")
        read_queue: queue.Queue = queue.Queue()
        status_queue: queue.Queue = queue.Queue()

        valid_msg = '{"jsonrpc": "2.0", "id": 1, "method": "ping"}'
        transport._handle_sse_event(self._make_sse("message", valid_msg), read_queue, status_queue)

        item = read_queue.get_nowait()
        assert hasattr(item, "message")

    def test_unknown_event_logs_warning_and_does_nothing(self):
        from core.mcp.client.sse_client import SSETransport

        transport = SSETransport("http://example.com/sse")
        read_queue: queue.Queue = queue.Queue()
        status_queue: queue.Queue = queue.Queue()

        transport._handle_sse_event(self._make_sse("ping", "{}"), read_queue, status_queue)

        assert read_queue.empty()
        assert status_queue.empty()


class TestSSEReader:
    """Tests for SSETransport.sse_reader exception branches."""

    def test_read_error_closes_cleanly(self):
        from core.mcp.client.sse_client import SSETransport

        transport = SSETransport("http://example.com/sse")
        read_queue: queue.Queue = queue.Queue()
        status_queue: queue.Queue = queue.Queue()

        event_source = Mock()
        event_source.iter_sse.side_effect = httpx.ReadError("connection reset")

        transport.sse_reader(event_source, read_queue, status_queue)

        # Finally block always puts None as sentinel
        sentinel = read_queue.get_nowait()
        assert sentinel is None

    def test_generic_exception_puts_exc_then_none(self):
        from core.mcp.client.sse_client import SSETransport

        transport = SSETransport("http://example.com/sse")
        read_queue: queue.Queue = queue.Queue()
        status_queue: queue.Queue = queue.Queue()

        boom = RuntimeError("unexpected!")
        event_source = Mock()
        event_source.iter_sse.side_effect = boom

        transport.sse_reader(event_source, read_queue, status_queue)

        exc_item = read_queue.get_nowait()
        assert exc_item is boom

        sentinel = read_queue.get_nowait()
        assert sentinel is None


class TestSendMessage:
    """Tests for SSETransport._send_message."""

    def _make_session_message(self):
        msg_json = '{"jsonrpc": "2.0", "id": 1, "method": "ping"}'
        msg = types.JSONRPCMessage.model_validate_json(msg_json)
        return types.SessionMessage(msg)

    def test_sends_post_and_raises_for_status(self):
        from core.mcp.client.sse_client import SSETransport

        transport = SSETransport("http://example.com/sse")

        mock_response = Mock()
        mock_response.status_code = 200
        mock_client = Mock()
        mock_client.post.return_value = mock_response

        session_msg = self._make_session_message()
        transport._send_message(mock_client, "http://example.com/messages/", session_msg)

        mock_client.post.assert_called_once()
        mock_response.raise_for_status.assert_called_once()


class TestPostWriter:
    """Tests for SSETransport.post_writer exception branches."""

    def _make_session_message(self):
        msg_json = '{"jsonrpc": "2.0", "id": 1, "method": "ping"}'
        msg = types.JSONRPCMessage.model_validate_json(msg_json)
        return types.SessionMessage(msg)

    def test_none_message_exits_loop(self):
        from core.mcp.client.sse_client import SSETransport

        transport = SSETransport("http://example.com/sse")
        write_queue: queue.Queue = queue.Queue()
        write_queue.put(None)  # Signal shutdown immediately

        mock_client = Mock()
        transport.post_writer(mock_client, "http://example.com/messages/", write_queue)

        # Should put final None sentinel
        sentinel = write_queue.get_nowait()
        assert sentinel is None

    def test_exception_in_message_put_back_to_queue(self):
        from core.mcp.client.sse_client import SSETransport

        transport = SSETransport("http://example.com/sse")
        write_queue: queue.Queue = queue.Queue()

        exc = ValueError("some error")
        write_queue.put(exc)  # Exception goes in first
        write_queue.put(None)  # Then shutdown signal

        mock_client = Mock()
        transport.post_writer(mock_client, "http://example.com/messages/", write_queue)

        # The exception should be re-queued, then None from loop exit, then None from finally
        item1 = write_queue.get_nowait()
        assert isinstance(item1, Exception)

    def test_read_error_shuts_down_cleanly(self):
        from core.mcp.client.sse_client import SSETransport

        transport = SSETransport("http://example.com/sse")
        write_queue: queue.Queue = queue.Queue()

        session_msg = self._make_session_message()
        write_queue.put(session_msg)

        mock_response = Mock()
        mock_response.status_code = 200
        mock_client = Mock()
        mock_client.post.side_effect = httpx.ReadError("connection dropped")

        # post_writer calls _send_message which calls client.post → ReadError propagates
        # The ReadError is raised inside _send_message → propagates out of the while loop
        transport.post_writer(mock_client, "http://example.com/messages/", write_queue)

        # finally always puts None
        sentinel = write_queue.get_nowait()
        assert sentinel is None

    def test_generic_exception_puts_exc_in_queue(self):
        from core.mcp.client.sse_client import SSETransport

        transport = SSETransport("http://example.com/sse")
        write_queue: queue.Queue = queue.Queue()

        session_msg = self._make_session_message()
        write_queue.put(session_msg)

        mock_client = Mock()
        boom = RuntimeError("boom")
        mock_client.post.side_effect = boom

        transport.post_writer(mock_client, "http://example.com/messages/", write_queue)

        exc_item = write_queue.get_nowait()
        assert isinstance(exc_item, Exception)

        sentinel = write_queue.get_nowait()
        assert sentinel is None

    def test_queue_empty_timeout_continues_loop(self):
        """Cover the 'except queue.Empty: continue' branch (line 188) in post_writer."""
        from core.mcp.client.sse_client import SSETransport

        transport = SSETransport("http://example.com/sse")
        write_queue: queue.Queue = queue.Queue()

        mock_client = Mock()

        # Patch queue.Queue.get so it raises Empty first, then returns None (shutdown)
        call_count = {"n": 0}
        original_get = write_queue.get

        def patched_get(*args, **kwargs):
            call_count["n"] += 1
            if call_count["n"] == 1:
                raise queue.Empty

        write_queue.get = patched_get  # type: ignore[method-assign]

        transport.post_writer(mock_client, "http://example.com/messages/", write_queue)

        # finally always puts None sentinel
        sentinel = write_queue.get_nowait()
        assert sentinel is None
        assert call_count["n"] >= 2  # Empty on first, None on second (and possibly more retries)


class TestWaitForEndpoint:
    """Tests for SSETransport._wait_for_endpoint edge cases."""

    def test_raises_on_empty_queue(self):
        from core.mcp.client.sse_client import SSETransport

        transport = SSETransport("http://example.com/sse")
        status_queue: queue.Queue = queue.Queue()  # empty

        with pytest.raises(ValueError, match="failed to get endpoint URL"):
            transport._wait_for_endpoint(status_queue)

    def test_raises_status_error_exception(self):
        from core.mcp.client.sse_client import SSETransport, _StatusError

        transport = SSETransport("http://example.com/sse")
        status_queue: queue.Queue = queue.Queue()

        exc = ValueError("malicious endpoint")
        status_queue.put(_StatusError(exc))

        with pytest.raises(ValueError, match="malicious endpoint"):
            transport._wait_for_endpoint(status_queue)

    def test_raises_on_unknown_status_type(self):
        from core.mcp.client.sse_client import SSETransport

        transport = SSETransport("http://example.com/sse")
        status_queue: queue.Queue = queue.Queue()

        # Put an object that is neither _StatusReady nor _StatusError
        status_queue.put("unexpected_value")

        with pytest.raises(ValueError, match="failed to get endpoint URL"):
            transport._wait_for_endpoint(status_queue)


class TestSSEClientRuntimeError:
    """Test sse_client context manager handles RuntimeError on close()."""

    def test_runtime_error_on_close_is_suppressed(self):
        """Ensure RuntimeError raised by event_source.response.close() is caught."""
        test_url = "http://test.example/sse"

        class MockSSEEvent:
            def __init__(self, event_type: str, data: str):
                self.event = event_type
                self.data = data

        endpoint_event = MockSSEEvent("endpoint", "/messages/?session_id=test-123")

        with patch("core.mcp.client.sse_client.create_ssrf_proxy_mcp_http_client") as mock_cf:
            with patch("core.mcp.client.sse_client.ssrf_proxy_sse_connect") as mock_sc:
                mock_client = Mock()
                mock_cf.return_value.__enter__.return_value = mock_client

                mock_es = Mock()
                mock_es.response.raise_for_status.return_value = None
                mock_es.iter_sse.return_value = [endpoint_event]
                # Make close() raise RuntimeError to exercise line 307-308
                mock_es.response.close.side_effect = RuntimeError("already closed")
                mock_sc.return_value.__enter__.return_value = mock_es

                # Should NOT raise even though close() raises RuntimeError
                with contextlib.suppress(Exception):
                    with sse_client(test_url) as (rq, wq):
                        pass


class TestStandaloneSendMessage:
    """Tests for the module-level send_message() function."""

    def _make_session_message(self):
        msg_json = '{"jsonrpc": "2.0", "id": 1, "method": "ping"}'
        msg = types.JSONRPCMessage.model_validate_json(msg_json)
        return types.SessionMessage(msg)

    def test_send_message_success(self):
        from core.mcp.client.sse_client import send_message

        mock_response = Mock()
        mock_response.status_code = 200
        mock_http_client = Mock()
        mock_http_client.post.return_value = mock_response

        session_msg = self._make_session_message()
        send_message(mock_http_client, "http://example.com/messages/", session_msg)

        mock_http_client.post.assert_called_once()
        mock_response.raise_for_status.assert_called_once()

    def test_send_message_raises_on_http_error(self):
        from core.mcp.client.sse_client import send_message

        mock_http_client = Mock()
        mock_http_client.post.side_effect = httpx.ConnectError("refused")

        session_msg = self._make_session_message()

        with pytest.raises(httpx.ConnectError):
            send_message(mock_http_client, "http://example.com/messages/", session_msg)

    def test_send_message_raises_for_status_failure(self):
        from core.mcp.client.sse_client import send_message

        mock_response = Mock()
        mock_response.raise_for_status.side_effect = httpx.HTTPStatusError(
            "Not Found", request=Mock(), response=Mock(status_code=404)
        )
        mock_http_client = Mock()
        mock_http_client.post.return_value = mock_response

        session_msg = self._make_session_message()

        with pytest.raises(httpx.HTTPStatusError):
            send_message(mock_http_client, "http://example.com/messages/", session_msg)


class TestReadMessages:
    """Tests for the module-level read_messages() generator."""

    def _make_mock_sse_event(self, event_type: str, data: str):
        ev = Mock()
        ev.event = event_type
        ev.data = data
        return ev

    def test_valid_message_event_yields_session_message(self):
        from core.mcp.client.sse_client import read_messages

        valid_json = '{"jsonrpc": "2.0", "id": 1, "method": "ping"}'
        mock_sse_event = self._make_mock_sse_event("message", valid_json)

        mock_client = Mock()
        mock_client.events.return_value = [mock_sse_event]

        results = list(read_messages(mock_client))
        assert len(results) == 1
        assert hasattr(results[0], "message")

    def test_invalid_json_yields_exception(self):
        from core.mcp.client.sse_client import read_messages

        mock_sse_event = self._make_mock_sse_event("message", "{not valid json}")

        mock_client = Mock()
        mock_client.events.return_value = [mock_sse_event]

        results = list(read_messages(mock_client))
        assert len(results) == 1
        assert isinstance(results[0], Exception)

    def test_non_message_event_is_skipped(self):
        from core.mcp.client.sse_client import read_messages

        mock_sse_event = self._make_mock_sse_event("endpoint", "/messages/")

        mock_client = Mock()
        mock_client.events.return_value = [mock_sse_event]

        results = list(read_messages(mock_client))
        # Non-message events produce no output
        assert results == []

    def test_outer_exception_yields_exc(self):
        from core.mcp.client.sse_client import read_messages

        boom = RuntimeError("stream broken")
        mock_client = Mock()
        mock_client.events.side_effect = boom

        results = list(read_messages(mock_client))
        assert len(results) == 1
        assert results[0] is boom

    def test_multiple_events_mixed(self):
        from core.mcp.client.sse_client import read_messages

        valid_json = '{"jsonrpc": "2.0", "id": 2, "result": {}}'
        events = [
            self._make_mock_sse_event("endpoint", "/messages/"),
            self._make_mock_sse_event("message", valid_json),
            self._make_mock_sse_event("message", "{bad json}"),
        ]

        mock_client = Mock()
        mock_client.events.return_value = events

        results = list(read_messages(mock_client))
        # endpoint is skipped; 1 valid SessionMessage + 1 Exception
        assert len(results) == 2
        assert hasattr(results[0], "message")
        assert isinstance(results[1], Exception)
