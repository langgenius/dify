"""
StreamableHTTP Client Transport Module

This module implements the StreamableHTTP transport for MCP clients,
providing support for HTTP POST requests with optional SSE streaming responses
and session management.
"""

import logging
import queue
import threading
from collections.abc import Callable, Generator
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import timedelta
from typing import Any, cast

import httpx
from httpx_sse import EventSource, ServerSentEvent

from core.mcp.types import (
    ClientMessageMetadata,
    ErrorData,
    JSONRPCError,
    JSONRPCMessage,
    JSONRPCNotification,
    JSONRPCRequest,
    JSONRPCResponse,
    RequestId,
    SessionMessage,
)
from core.mcp.utils import create_ssrf_proxy_mcp_http_client, ssrf_proxy_sse_connect

logger = logging.getLogger(__name__)


SessionMessageOrError = SessionMessage | Exception | None
# Queue types with clearer names for their roles
ServerToClientQueue = queue.Queue[SessionMessageOrError]  # Server to client messages
ClientToServerQueue = queue.Queue[SessionMessage | None]  # Client to server messages
GetSessionIdCallback = Callable[[], str | None]

MCP_SESSION_ID = "mcp-session-id"
LAST_EVENT_ID = "last-event-id"
CONTENT_TYPE = "content-type"
ACCEPT = "Accept"


JSON = "application/json"
SSE = "text/event-stream"

DEFAULT_QUEUE_READ_TIMEOUT = 3


class StreamableHTTPError(Exception):
    """Base exception for StreamableHTTP transport errors."""


class ResumptionError(StreamableHTTPError):
    """Raised when resumption request is invalid."""


@dataclass
class RequestContext:
    """Context for a request operation."""

    client: httpx.Client
    headers: dict[str, str]
    session_id: str | None
    session_message: SessionMessage
    metadata: ClientMessageMetadata | None
    server_to_client_queue: ServerToClientQueue  # Renamed for clarity
    sse_read_timeout: float


class StreamableHTTPTransport:
    """StreamableHTTP client transport implementation."""

    def __init__(
        self,
        url: str,
        headers: dict[str, Any] | None = None,
        timeout: float | timedelta = 30,
        sse_read_timeout: float | timedelta = 60 * 5,
    ):
        """Initialize the StreamableHTTP transport.

        Args:
            url: The endpoint URL.
            headers: Optional headers to include in requests.
            timeout: HTTP timeout for regular operations.
            sse_read_timeout: Timeout for SSE read operations.
        """
        self.url = url
        self.headers = headers or {}
        self.timeout = timeout.total_seconds() if isinstance(timeout, timedelta) else timeout
        self.sse_read_timeout = (
            sse_read_timeout.total_seconds() if isinstance(sse_read_timeout, timedelta) else sse_read_timeout
        )
        self.session_id: str | None = None
        self.request_headers = {
            ACCEPT: f"{JSON}, {SSE}",
            CONTENT_TYPE: JSON,
            **self.headers,
        }
        self.stop_event = threading.Event()
        self._active_responses: list[httpx.Response] = []
        self._lock = threading.Lock()

    def _update_headers_with_session(self, base_headers: dict[str, str]) -> dict[str, str]:
        """Update headers with session ID if available."""
        headers = base_headers.copy()
        if self.session_id:
            headers[MCP_SESSION_ID] = self.session_id
        return headers

    def _register_response(self, response: httpx.Response):
        """Register a response for cleanup on shutdown."""
        with self._lock:
            self._active_responses.append(response)

    def _unregister_response(self, response: httpx.Response):
        """Unregister a response after it's closed."""
        with self._lock:
            try:
                self._active_responses.remove(response)
            except ValueError as e:
                logger.debug("Ignoring error during response unregister: %s", e)

    def close_active_responses(self):
        """Close all active SSE connections to unblock threads."""
        with self._lock:
            responses_to_close = list(self._active_responses)
            self._active_responses.clear()
            for response in responses_to_close:
                try:
                    response.close()
                except RuntimeError as e:
                    logger.debug("Ignoring error during active response close: %s", e)

    def _is_initialization_request(self, message: JSONRPCMessage) -> bool:
        """Check if the message is an initialization request."""
        return isinstance(message.root, JSONRPCRequest) and message.root.method == "initialize"

    def _is_initialized_notification(self, message: JSONRPCMessage) -> bool:
        """Check if the message is an initialized notification."""
        return isinstance(message.root, JSONRPCNotification) and message.root.method == "notifications/initialized"

    def _maybe_extract_session_id_from_response(
        self,
        response: httpx.Response,
    ):
        """Extract and store session ID from response headers."""
        new_session_id = response.headers.get(MCP_SESSION_ID)
        if new_session_id:
            self.session_id = new_session_id
            logger.info("Received session ID: %s", self.session_id)

    def _handle_sse_event(
        self,
        sse: ServerSentEvent,
        server_to_client_queue: ServerToClientQueue,
        original_request_id: RequestId | None = None,
        resumption_callback: Callable[[str], None] | None = None,
    ) -> bool:
        """Handle an SSE event, returning True if the response is complete."""
        if sse.event == "message":
            # ping event send by server will be recognized  as a message event with empty data by httpx-sse's SSEDecoder
            if not sse.data.strip():
                return False

            try:
                message = JSONRPCMessage.model_validate_json(sse.data)
                logger.debug("SSE message: %s", message)

                # If this is a response and we have original_request_id, replace it
                if original_request_id is not None and isinstance(message.root, JSONRPCResponse | JSONRPCError):
                    message.root.id = original_request_id

                session_message = SessionMessage(message)
                # Put message in queue that goes to client
                server_to_client_queue.put(session_message)

                # Call resumption token callback if we have an ID
                if sse.id and resumption_callback:
                    resumption_callback(sse.id)

                # If this is a response or error return True indicating completion
                # Otherwise, return False to continue listening
                return isinstance(message.root, JSONRPCResponse | JSONRPCError)

            except Exception as exc:
                # Put exception in queue that goes to client
                server_to_client_queue.put(exc)
                return False
        elif sse.event == "ping":
            logger.debug("Received ping event")
            return False
        else:
            logger.warning("Unknown SSE event: %s", sse.event)
            return False

    def handle_get_stream(
        self,
        client: httpx.Client,
        server_to_client_queue: ServerToClientQueue,
    ):
        """Handle GET stream for server-initiated messages."""
        try:
            if not self.session_id:
                return

            headers = self._update_headers_with_session(self.request_headers)

            with ssrf_proxy_sse_connect(
                self.url,
                headers=headers,
                timeout=httpx.Timeout(self.timeout, read=self.sse_read_timeout),
                client=client,
                method="GET",
            ) as event_source:
                event_source.response.raise_for_status()
                logger.debug("GET SSE connection established")

                # Register response for cleanup
                self._register_response(event_source.response)

                try:
                    for sse in event_source.iter_sse():
                        if self.stop_event.is_set():
                            logger.debug("GET stream received stop signal")
                            break
                        self._handle_sse_event(sse, server_to_client_queue)
                finally:
                    self._unregister_response(event_source.response)

        except Exception as exc:
            if not self.stop_event.is_set():
                logger.debug("GET stream error (non-fatal): %s", exc)

    def _handle_resumption_request(self, ctx: RequestContext):
        """Handle a resumption request using GET with SSE."""
        headers = self._update_headers_with_session(ctx.headers)
        if ctx.metadata and ctx.metadata.resumption_token:
            headers[LAST_EVENT_ID] = ctx.metadata.resumption_token
        else:
            raise ResumptionError("Resumption request requires a resumption token")

        # Extract original request ID to map responses
        original_request_id = None
        if isinstance(ctx.session_message.message.root, JSONRPCRequest):
            original_request_id = ctx.session_message.message.root.id

        with ssrf_proxy_sse_connect(
            self.url,
            headers=headers,
            timeout=httpx.Timeout(self.timeout, read=self.sse_read_timeout),
            client=ctx.client,
            method="GET",
        ) as event_source:
            event_source.response.raise_for_status()
            logger.debug("Resumption GET SSE connection established")

            # Register response for cleanup
            self._register_response(event_source.response)

            try:
                for sse in event_source.iter_sse():
                    if self.stop_event.is_set():
                        logger.debug("Resumption stream received stop signal")
                        break
                    is_complete = self._handle_sse_event(
                        sse,
                        ctx.server_to_client_queue,
                        original_request_id,
                        ctx.metadata.on_resumption_token_update if ctx.metadata else None,
                    )
                    if is_complete:
                        break
            finally:
                self._unregister_response(event_source.response)

    def _handle_post_request(self, ctx: RequestContext):
        """Handle a POST request with response processing."""
        headers = self._update_headers_with_session(ctx.headers)
        message = ctx.session_message.message
        is_initialization = self._is_initialization_request(message)

        with ctx.client.stream(
            "POST",
            self.url,
            json=message.model_dump(by_alias=True, mode="json", exclude_none=True),
            headers=headers,
        ) as response:
            if response.status_code == 202:
                logger.debug("Received 202 Accepted")
                return

            if response.status_code == 204:
                logger.debug("Received 204 No Content")
                return

            if response.status_code == 404:
                if isinstance(message.root, JSONRPCRequest):
                    self._send_session_terminated_error(
                        ctx.server_to_client_queue,
                        message.root.id,
                    )
                return

            response.raise_for_status()
            if is_initialization:
                self._maybe_extract_session_id_from_response(response)

            # Per https://modelcontextprotocol.io/specification/2025-06-18/basic#notifications:
            # The server MUST NOT send a response to notifications.
            if isinstance(message.root, JSONRPCRequest):
                content_type = cast(str, response.headers.get(CONTENT_TYPE, "").lower())

                if content_type.startswith(JSON):
                    self._handle_json_response(response, ctx.server_to_client_queue)
                elif content_type.startswith(SSE):
                    self._handle_sse_response(response, ctx)
                else:
                    self._handle_unexpected_content_type(
                        content_type,
                        ctx.server_to_client_queue,
                    )

    def _handle_json_response(
        self,
        response: httpx.Response,
        server_to_client_queue: ServerToClientQueue,
    ):
        """Handle JSON response from the server."""
        try:
            content = response.read()
            message = JSONRPCMessage.model_validate_json(content)
            session_message = SessionMessage(message)
            server_to_client_queue.put(session_message)
        except Exception as exc:
            server_to_client_queue.put(exc)

    def _handle_sse_response(self, response: httpx.Response, ctx: RequestContext):
        """Handle SSE response from the server."""
        try:
            # Register response for cleanup
            self._register_response(response)

            event_source = EventSource(response)
            try:
                for sse in event_source.iter_sse():
                    if self.stop_event.is_set():
                        logger.debug("SSE response stream received stop signal")
                        break
                    is_complete = self._handle_sse_event(
                        sse,
                        ctx.server_to_client_queue,
                        resumption_callback=(ctx.metadata.on_resumption_token_update if ctx.metadata else None),
                    )
                    if is_complete:
                        break
            finally:
                self._unregister_response(response)
        except Exception as e:
            if not self.stop_event.is_set():
                ctx.server_to_client_queue.put(e)

    def _handle_unexpected_content_type(
        self,
        content_type: str,
        server_to_client_queue: ServerToClientQueue,
    ):
        """Handle unexpected content type in response."""
        error_msg = f"Unexpected content type: {content_type}"
        logger.error(error_msg)
        server_to_client_queue.put(ValueError(error_msg))

    def _send_session_terminated_error(
        self,
        server_to_client_queue: ServerToClientQueue,
        request_id: RequestId,
    ):
        """Send a session terminated error response."""
        jsonrpc_error = JSONRPCError(
            jsonrpc="2.0",
            id=request_id,
            error=ErrorData(code=32600, message="Session terminated by server"),
        )
        session_message = SessionMessage(JSONRPCMessage(jsonrpc_error))
        server_to_client_queue.put(session_message)

    def post_writer(
        self,
        client: httpx.Client,
        client_to_server_queue: ClientToServerQueue,
        server_to_client_queue: ServerToClientQueue,
        start_get_stream: Callable[[], None],
    ):
        """Handle writing requests to the server.

        This method processes messages from the client_to_server_queue and sends them to the server.
        Responses are written to the server_to_client_queue.
        """
        while True:
            try:
                # Check if we should stop
                if self.stop_event.is_set():
                    logger.debug("Post writer received stop signal")
                    break

                # Read message from client queue with timeout to check stop_event periodically
                session_message = client_to_server_queue.get(timeout=DEFAULT_QUEUE_READ_TIMEOUT)
                if session_message is None:
                    break

                message = session_message.message
                metadata = (
                    session_message.metadata if isinstance(session_message.metadata, ClientMessageMetadata) else None
                )

                # Check if this is a resumption request
                is_resumption = bool(metadata and metadata.resumption_token)

                logger.debug("Sending client message: %s", message)

                # Handle initialized notification
                if self._is_initialized_notification(message):
                    start_get_stream()

                ctx = RequestContext(
                    client=client,
                    headers=self.request_headers,
                    session_id=self.session_id,
                    session_message=session_message,
                    metadata=metadata,
                    server_to_client_queue=server_to_client_queue,  # Queue to write responses to client
                    sse_read_timeout=self.sse_read_timeout,
                )

                if is_resumption:
                    self._handle_resumption_request(ctx)
                else:
                    self._handle_post_request(ctx)
            except queue.Empty:
                continue
            except Exception as exc:
                if not self.stop_event.is_set():
                    server_to_client_queue.put(exc)

    def terminate_session(self, client: httpx.Client):
        """Terminate the session by sending a DELETE request."""
        if not self.session_id:
            return

        try:
            headers = self._update_headers_with_session(self.request_headers)
            response = client.delete(self.url, headers=headers)

            if response.status_code == 405:
                logger.debug("Server does not allow session termination")
            elif response.status_code != 200:
                logger.warning("Session termination failed: %s", response.status_code)
        except Exception as exc:
            logger.warning("Session termination failed: %s", exc)

    def get_session_id(self) -> str | None:
        """Get the current session ID."""
        return self.session_id


@contextmanager
def streamablehttp_client(
    url: str,
    headers: dict[str, Any] | None = None,
    timeout: float | timedelta = 30,
    sse_read_timeout: float | timedelta = 60 * 5,
    terminate_on_close: bool = True,
) -> Generator[
    tuple[
        ServerToClientQueue,  # Queue for receiving messages FROM server
        ClientToServerQueue,  # Queue for sending messages TO server
        GetSessionIdCallback,
    ],
    None,
    None,
]:
    """
    Client transport for StreamableHTTP.

    `sse_read_timeout` determines how long (in seconds) the client will wait for a new
    event before disconnecting. All other HTTP operations are controlled by `timeout`.

    Yields:
        Tuple containing:
            - server_to_client_queue: Queue for reading messages FROM the server
            - client_to_server_queue: Queue for sending messages TO the server
            - get_session_id_callback: Function to retrieve the current session ID
    """
    transport = StreamableHTTPTransport(url, headers, timeout, sse_read_timeout)

    # Create queues with clear directional meaning
    server_to_client_queue: ServerToClientQueue = queue.Queue()  # For messages FROM server TO client
    client_to_server_queue: ClientToServerQueue = queue.Queue()  # For messages FROM client TO server

    executor = ThreadPoolExecutor(max_workers=2)
    try:
        with create_ssrf_proxy_mcp_http_client(
            headers=transport.request_headers,
            timeout=httpx.Timeout(transport.timeout, read=transport.sse_read_timeout),
        ) as client:
            # Define callbacks that need access to thread pool
            def start_get_stream():
                """Start a worker thread to handle server-initiated messages."""
                executor.submit(transport.handle_get_stream, client, server_to_client_queue)

            # Start the post_writer worker thread
            executor.submit(
                transport.post_writer,
                client,
                client_to_server_queue,  # Queue for messages FROM client TO server
                server_to_client_queue,  # Queue for messages FROM server TO client
                start_get_stream,
            )

            try:
                yield (
                    server_to_client_queue,  # Queue for receiving messages FROM server
                    client_to_server_queue,  # Queue for sending messages TO server
                    transport.get_session_id,
                )
            finally:
                # Set stop event to signal all threads to stop
                transport.stop_event.set()

                # Close all active SSE connections to unblock threads
                transport.close_active_responses()

                if transport.session_id and terminate_on_close:
                    transport.terminate_session(client)

                # Signal threads to stop
                client_to_server_queue.put(None)
    finally:
        # Clear any remaining items and add None sentinel to unblock any waiting threads
        try:
            while not client_to_server_queue.empty():
                client_to_server_queue.get_nowait()
        except queue.Empty:
            pass

        client_to_server_queue.put(None)
        server_to_client_queue.put(None)

        # Shutdown executor without waiting to prevent hanging
        executor.shutdown(wait=False)
