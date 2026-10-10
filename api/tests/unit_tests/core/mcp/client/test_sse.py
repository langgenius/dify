import contextlib
import json
import queue
import threading
import time
from unittest.mock import patch

import httpx
import pytest
from httpx_sse import EventSource, ServerSentEvent
from sseclient import SSEClient

from core.mcp import types
from core.mcp.client.sse_client import sse_client
from core.mcp.error import MCPAuthError, MCPConnectionError

SSE_ENDPOINT = "event: endpoint\ndata: /messages/?session_id=test-123\n\n"


@pytest.fixture
def install_sse_response(monkeypatch: pytest.MonkeyPatch):
    def install(response: httpx.Response | Exception) -> list[httpx.Request]:
        requests: list[httpx.Request] = []

        def handle(request: httpx.Request) -> httpx.Response:
            requests.append(request)
            if isinstance(response, Exception):
                raise response
            return response

        def client(*, headers: dict[str, str]) -> httpx.Client:
            return httpx.Client(headers=headers, transport=httpx.MockTransport(handle))

        monkeypatch.setattr("core.mcp.client.sse_client.create_ssrf_proxy_mcp_http_client", client)
        return requests

    return install


@pytest.fixture
def make_http_client():
    with contextlib.ExitStack() as stack:

        def make(response: httpx.Response | Exception) -> tuple[httpx.Client, list[httpx.Request]]:
            requests: list[httpx.Request] = []

            def handle(request: httpx.Request) -> httpx.Response:
                requests.append(request)
                if isinstance(response, Exception):
                    raise response
                return response

            client = stack.enter_context(httpx.Client(transport=httpx.MockTransport(handle)))
            return client, requests

        yield make


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


def test_sse_message_without_id_stays_notification():
    """Test that method messages without an ID still parse as notifications."""
    json_message = '{"jsonrpc": "2.0", "method": "ping", "params": null}'

    msg = types.JSONRPCMessage.model_validate_json(json_message)

    assert isinstance(msg.root, types.JSONRPCNotification)
    assert msg.root.method == "ping"
    assert msg.root.jsonrpc == "2.0"


def test_sse_client_message_id_handling(install_sse_response):
    """Parse numeric string IDs from actual SSE response bytes."""
    message_data = {"jsonrpc": "2.0", "id": "456", "result": {"test": "data"}}
    install_sse_response(
        httpx.Response(
            200,
            headers={"content-type": "text/event-stream"},
            text=SSE_ENDPOINT + f"event: message\ndata: {json.dumps(message_data)}\n\n",
        )
    )
    with sse_client("http://test.example/sse") as (read_queue, _write_queue):
        message = read_queue.get(timeout=1)
        assert isinstance(message, types.SessionMessage)
        assert isinstance(message.message.root, types.JSONRPCResponse)
        assert message.message.root.id == 456


def test_sse_client_connection_validation(install_sse_response):
    """Accept a same-origin endpoint parsed by the real SSE reader."""
    requests = install_sse_response(
        httpx.Response(200, headers={"content-type": "text/event-stream"}, text=SSE_ENDPOINT)
    )
    with sse_client("http://test.example/sse") as (read_queue, write_queue):
        assert isinstance(read_queue, queue.Queue)
        assert isinstance(write_queue, queue.Queue)
    assert len(requests) == 1
    assert str(requests[0].url) == "http://test.example/sse"


def test_sse_client_error_handling(install_sse_response):
    """Translate real HTTP status errors to the MCP error contract."""
    for status, error in ((401, MCPAuthError), (500, MCPConnectionError)):
        install_sse_response(httpx.Response(status, headers={"WWW-Authenticate": 'Bearer realm="example"'}))
        with pytest.raises(error):
            with sse_client("http://test.example/sse"):
                pytest.fail("An HTTP error must prevent connection establishment")


@pytest.mark.parametrize(
    "transport_error",
    [
        httpx.ConnectError("[Errno 111] Connection refused"),
        httpx.RemoteProtocolError("Server disconnected without sending a response."),
        httpx.ReadTimeout("timed out"),
    ],
    ids=["connect_error", "remote_protocol_error", "read_timeout"],
)
def test_sse_client_wraps_transport_errors(transport_error: httpx.RequestError):
    """Transport failures must surface as MCPConnectionError, not raw httpx errors.

    Callers rely on the MCP error contract: MCPClient only falls back to
    streamable HTTP on MCPConnectionError/ValueError, and the console API maps
    those to a 4xx with a readable message instead of a bare 500.
    """
    test_url = "http://test.example/sse"

    with (
        patch("core.mcp.client.sse_client.create_ssrf_proxy_mcp_http_client"),
        patch("core.mcp.client.sse_client.ssrf_proxy_sse_connect") as mock_sse_connect,
    ):
        mock_sse_connect.side_effect = transport_error

        with pytest.raises(MCPConnectionError) as exc_info:
            with sse_client(test_url):
                pass

    # The underlying reason must survive so the user can act on it.
    assert str(transport_error) in str(exc_info.value)


def test_sse_client_timeout_configuration(install_sse_response):
    """Pass the configured timeouts through the actual HTTP request."""
    requests = install_sse_response(
        httpx.Response(200, headers={"content-type": "text/event-stream"}, text=SSE_ENDPOINT)
    )
    with sse_client(
        "http://test.example/sse", headers={"Authorization": "Bearer test-token"}, timeout=10.0, sse_read_timeout=300.0
    ):
        assert len(requests) == 1
        assert requests[0].headers["Authorization"] == "Bearer test-token"
        assert requests[0].extensions["timeout"]["read"] == 300.0
        assert requests[0].extensions["timeout"]["connect"] == 10.0


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


def test_sse_client_queue_cleanup(install_sse_response, monkeypatch: pytest.MonkeyPatch):
    """Closing a connected client signals shutdown on both queues."""
    from core.mcp.client.sse_client import SSETransport

    writer_finished = threading.Event()
    original_writer = SSETransport.post_writer

    def post_writer(self: SSETransport, client: httpx.Client, endpoint: str, messages: queue.Queue) -> None:
        try:
            original_writer(self, client, endpoint, messages)
        finally:
            writer_finished.set()

    monkeypatch.setattr(SSETransport, "post_writer", post_writer)
    install_sse_response(httpx.Response(200, headers={"content-type": "text/event-stream"}, text=SSE_ENDPOINT))
    with sse_client("http://test.example/sse") as (read_queue, write_queue):
        # The finite SSE body first terminates the reader itself.
        assert read_queue.get(timeout=1) is None
    assert read_queue.get(timeout=1) is None
    # The writer consumes shutdown and enqueues its own final sentinel.
    assert writer_finished.wait(timeout=1)
    assert write_queue.get(timeout=1) is None


def test_sse_client_headers_propagation(install_sse_response):
    """Custom headers reach the real SSE GET request."""
    headers = {
        "Authorization": "Bearer test-token",
        "X-Custom-Header": "test-value",
        "User-Agent": "test-client/1.0",
    }
    requests = install_sse_response(
        httpx.Response(200, headers={"content-type": "text/event-stream"}, text=SSE_ENDPOINT)
    )
    with sse_client("http://test.example/sse", headers=headers):
        assert len(requests) == 1
        for key, value in headers.items():
            assert requests[0].headers[key] == value


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
        return ServerSentEvent(event=event_type, data=data)

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

        def fail() -> bytes:
            raise httpx.ReadError("connection reset")

        event_source = EventSource(
            httpx.Response(200, headers={"content-type": "text/event-stream"}, content=iter(fail, b""))
        )

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

        def fail() -> bytes:
            raise boom

        event_source = EventSource(
            httpx.Response(200, headers={"content-type": "text/event-stream"}, content=iter(fail, b""))
        )

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

    def test_sends_post_and_raises_for_status(self, make_http_client):
        from core.mcp.client.sse_client import SSETransport

        transport = SSETransport("http://example.com/sse")

        mock_client, requests = make_http_client(httpx.Response(200))

        session_msg = self._make_session_message()
        transport._send_message(mock_client, "http://example.com/messages/", session_msg)

        assert len(requests) == 1
        assert requests[0].method == "POST"
        assert str(requests[0].url) == "http://example.com/messages/"
        assert json.loads(requests[0].content) == session_msg.message.model_dump(by_alias=True, exclude_none=True)


class TestPostWriter:
    """Tests for SSETransport.post_writer exception branches."""

    def _make_session_message(self):
        msg_json = '{"jsonrpc": "2.0", "id": 1, "method": "ping"}'
        msg = types.JSONRPCMessage.model_validate_json(msg_json)
        return types.SessionMessage(msg)

    def test_none_message_exits_loop(self, make_http_client):
        from core.mcp.client.sse_client import SSETransport

        transport = SSETransport("http://example.com/sse")
        write_queue: queue.Queue = queue.Queue()
        write_queue.put(None)  # Signal shutdown immediately

        mock_client, _requests = make_http_client(httpx.Response(200))
        transport.post_writer(mock_client, "http://example.com/messages/", write_queue)

        # Should put final None sentinel
        sentinel = write_queue.get_nowait()
        assert sentinel is None

    def test_exception_in_message_put_back_to_queue(self, make_http_client):
        from core.mcp.client.sse_client import SSETransport

        transport = SSETransport("http://example.com/sse")
        write_queue: queue.Queue = queue.Queue()

        exc = ValueError("some error")
        write_queue.put(exc)  # Exception goes in first
        write_queue.put(None)  # Then shutdown signal

        mock_client, _requests = make_http_client(httpx.Response(200))
        transport.post_writer(mock_client, "http://example.com/messages/", write_queue)

        # The exception should be re-queued, then None from loop exit, then None from finally
        item1 = write_queue.get_nowait()
        assert item1 is exc

    def test_read_error_shuts_down_cleanly(self, make_http_client):
        from core.mcp.client.sse_client import SSETransport

        transport = SSETransport("http://example.com/sse")
        write_queue: queue.Queue = queue.Queue()

        session_msg = self._make_session_message()
        write_queue.put(session_msg)

        mock_client, _requests = make_http_client(httpx.ReadError("connection dropped"))

        # post_writer calls _send_message which calls client.post → ReadError propagates
        # The ReadError is raised inside _send_message → propagates out of the while loop
        transport.post_writer(mock_client, "http://example.com/messages/", write_queue)

        # finally always puts None
        sentinel = write_queue.get_nowait()
        assert sentinel is None

    def test_generic_exception_puts_exc_in_queue(self, make_http_client):
        from core.mcp.client.sse_client import SSETransport

        transport = SSETransport("http://example.com/sse")
        write_queue: queue.Queue = queue.Queue()

        session_msg = self._make_session_message()
        write_queue.put(session_msg)

        boom = RuntimeError("boom")
        mock_client, _requests = make_http_client(boom)

        transport.post_writer(mock_client, "http://example.com/messages/", write_queue)

        exc_item = write_queue.get_nowait()
        assert exc_item is boom

        sentinel = write_queue.get_nowait()
        assert sentinel is None

    def test_queue_empty_timeout_continues_loop(self, make_http_client):
        """Cover the 'except queue.Empty: continue' branch (line 188) in post_writer."""
        from core.mcp.client.sse_client import SSETransport

        transport = SSETransport("http://example.com/sse")
        write_queue: queue.Queue = queue.Queue()

        mock_client, _requests = make_http_client(httpx.Response(200))

        # Patch queue.Queue.get so it raises Empty first, then returns None (shutdown)
        call_count = {"n": 0}
        original_get = write_queue.get
        write_queue.put(None)

        def patched_get[**P](*args: P.args, **kwargs: P.kwargs):
            call_count["n"] += 1
            if call_count["n"] == 1:
                raise queue.Empty
            return original_get(*args, **kwargs)

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

    def test_runtime_error_on_close_is_suppressed(self, install_sse_response, monkeypatch: pytest.MonkeyPatch):
        """Suppress only RuntimeError from response.close during final cleanup."""
        response = httpx.Response(
            200,
            headers={"content-type": "text/event-stream"},
            text=SSE_ENDPOINT,
            request=httpx.Request("GET", "http://test.example/sse"),
        )
        install_sse_response(response)
        closed: list[bool] = []

        def close() -> None:
            closed.append(True)
            raise RuntimeError("already closed")

        monkeypatch.setattr(response, "close", close)
        monkeypatch.setattr(
            "core.mcp.client.sse_client.ssrf_proxy_sse_connect",
            lambda *_args, **_kwargs: contextlib.nullcontext(EventSource(response)),
        )
        with sse_client("http://test.example/sse") as (read_queue, _write_queue):
            assert read_queue.get(timeout=1) is None
        assert closed == [True]


class TestStandaloneSendMessage:
    """Tests for the module-level send_message() function."""

    def _make_session_message(self):
        msg_json = '{"jsonrpc": "2.0", "id": 1, "method": "ping"}'
        msg = types.JSONRPCMessage.model_validate_json(msg_json)
        return types.SessionMessage(msg)

    def test_send_message_success(self, make_http_client):
        from core.mcp.client.sse_client import send_message

        mock_http_client, requests = make_http_client(httpx.Response(200))

        session_msg = self._make_session_message()
        send_message(mock_http_client, "http://example.com/messages/", session_msg)

        assert len(requests) == 1
        assert requests[0].method == "POST"
        assert str(requests[0].url) == "http://example.com/messages/"
        assert json.loads(requests[0].content) == session_msg.message.model_dump(by_alias=True, exclude_none=True)

    def test_send_message_raises_on_http_error(self, make_http_client):
        from core.mcp.client.sse_client import send_message

        mock_http_client, _requests = make_http_client(httpx.ConnectError("refused"))

        session_msg = self._make_session_message()

        with pytest.raises(httpx.ConnectError):
            send_message(mock_http_client, "http://example.com/messages/", session_msg)

    def test_send_message_raises_for_status_failure(self, make_http_client):
        from core.mcp.client.sse_client import send_message

        mock_http_client, _requests = make_http_client(httpx.Response(404))

        session_msg = self._make_session_message()

        with pytest.raises(httpx.HTTPStatusError):
            send_message(mock_http_client, "http://example.com/messages/", session_msg)


class TestReadMessages:
    """Tests for the module-level read_messages() generator."""

    def _make_sse_event(self, event_type: str, data: str):
        return f"event: {event_type}\ndata: {data}\n\n".encode()

    def test_valid_message_event_yields_session_message(self):
        from core.mcp.client.sse_client import read_messages

        valid_json = '{"jsonrpc": "2.0", "id": 1, "method": "ping"}'
        mock_sse_event = self._make_sse_event("message", valid_json)

        mock_client = SSEClient([mock_sse_event])

        results = list(read_messages(mock_client))
        assert len(results) == 1
        assert hasattr(results[0], "message")

    def test_invalid_json_yields_exception(self):
        from core.mcp.client.sse_client import read_messages

        mock_sse_event = self._make_sse_event("message", "{not valid json}")

        mock_client = SSEClient([mock_sse_event])

        results = list(read_messages(mock_client))
        assert len(results) == 1
        assert isinstance(results[0], Exception)

    def test_non_message_event_is_skipped(self):
        from core.mcp.client.sse_client import read_messages

        mock_sse_event = self._make_sse_event("endpoint", "/messages/")

        mock_client = SSEClient([mock_sse_event])

        results = list(read_messages(mock_client))
        # Non-message events produce no output
        assert results == []

    def test_outer_exception_yields_exc(self):
        from core.mcp.client.sse_client import read_messages

        boom = RuntimeError("stream broken")

        def fail() -> bytes:
            raise boom

        mock_client = SSEClient(iter(fail, b""))

        results = list(read_messages(mock_client))
        assert len(results) == 1
        assert results[0] is boom

    def test_multiple_events_mixed(self):
        from core.mcp.client.sse_client import read_messages

        valid_json = '{"jsonrpc": "2.0", "id": 2, "result": {}}'
        events = [
            self._make_sse_event("endpoint", "/messages/"),
            self._make_sse_event("message", valid_json),
            self._make_sse_event("message", "{bad json}"),
        ]

        mock_client = SSEClient(events)

        results = list(read_messages(mock_client))
        # endpoint is skipped; 1 valid SessionMessage + 1 Exception
        assert len(results) == 2
        assert hasattr(results[0], "message")
        assert isinstance(results[1], Exception)
