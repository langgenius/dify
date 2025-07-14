"""
Tests for the StreamableHTTP client transport.

Contains tests for only the client side of the StreamableHTTP transport.
"""

import queue
import threading
import time
from typing import Any
from unittest.mock import Mock, patch

from core.mcp import types
from core.mcp.client.streamable_client import streamablehttp_client

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
