import logging
import queue
from collections.abc import Generator
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from typing import Any, TypeAlias, final
from urllib.parse import urljoin, urlparse

import httpx
from httpx_sse import EventSource, ServerSentEvent
from sseclient import SSEClient

from core.mcp import types
from core.mcp.error import MCPAuthError, MCPConnectionError
from core.mcp.types import SessionMessage
from core.mcp.utils import create_ssrf_proxy_mcp_http_client, ssrf_proxy_sse_connect

logger = logging.getLogger(__name__)

DEFAULT_QUEUE_READ_TIMEOUT = 3


@final
class _StatusReady:
    def __init__(self, endpoint_url: str):
        self.endpoint_url = endpoint_url


@final
class _StatusError:
    def __init__(self, exc: Exception):
        self.exc = exc


# Type aliases for better readability
ReadQueue: TypeAlias = queue.Queue[SessionMessage | Exception | None]
WriteQueue: TypeAlias = queue.Queue[SessionMessage | Exception | None]
StatusQueue: TypeAlias = queue.Queue[_StatusReady | _StatusError]


class SSETransport:
    """SSE client transport implementation."""

    def __init__(
        self,
        url: str,
        headers: dict[str, Any] | None = None,
        timeout: float = 5.0,
        sse_read_timeout: float = 1 * 60,
    ):
        """Initialize the SSE transport.

        Args:
            url: The SSE endpoint URL.
            headers: Optional headers to include in requests.
            timeout: HTTP timeout for regular operations.
            sse_read_timeout: Timeout for SSE read operations.
        """
        self.url = url
        self.headers = headers or {}
        self.timeout = timeout
        self.sse_read_timeout = sse_read_timeout
        self.endpoint_url: str | None = None
        self.event_source: EventSource | None = None

    def _validate_endpoint_url(self, endpoint_url: str) -> bool:
        """Validate that the endpoint URL matches the connection origin.

        Args:
            endpoint_url: The endpoint URL to validate.

        Returns:
            True if valid, False otherwise.
        """
        url_parsed = urlparse(self.url)
        endpoint_parsed = urlparse(endpoint_url)

        return url_parsed.netloc == endpoint_parsed.netloc and url_parsed.scheme == endpoint_parsed.scheme

    def _handle_endpoint_event(self, sse_data: str, status_queue: StatusQueue):
        """Handle an 'endpoint' SSE event.

        Args:
            sse_data: The SSE event data.
            status_queue: Queue to put status updates.
        """
        endpoint_url = urljoin(self.url, sse_data)
        logger.info("Received endpoint URL: %s", endpoint_url)

        if not self._validate_endpoint_url(endpoint_url):
            error_msg = f"Endpoint origin does not match connection origin: {endpoint_url}"
            logger.error(error_msg)
            status_queue.put(_StatusError(ValueError(error_msg)))
            return

        status_queue.put(_StatusReady(endpoint_url))

    def _handle_message_event(self, sse_data: str, read_queue: ReadQueue):
        """Handle a 'message' SSE event.

        Args:
            sse_data: The SSE event data.
            read_queue: Queue to put parsed messages.
        """
        try:
            message = types.JSONRPCMessage.model_validate_json(sse_data)
            logger.debug("Received server message: %s", message)
            session_message = SessionMessage(message)
            read_queue.put(session_message)
        except Exception as exc:
            logger.exception("Error parsing server message")
            read_queue.put(exc)

    def _handle_sse_event(self, sse: ServerSentEvent, read_queue: ReadQueue, status_queue: StatusQueue):
        """Handle a single SSE event.

        Args:
            sse: The SSE event object.
            read_queue: Queue for message events.
            status_queue: Queue for status events.
        """
        match sse.event:
            case "endpoint":
                self._handle_endpoint_event(sse.data, status_queue)
            case "message":
                self._handle_message_event(sse.data, read_queue)
            case _:
                logger.warning("Unknown SSE event: %s", sse.event)

    def sse_reader(self, event_source: EventSource, read_queue: ReadQueue, status_queue: StatusQueue):
        """Read and process SSE events.

        Args:
            event_source: The SSE event source.
            read_queue: Queue to put received messages.
            status_queue: Queue to put status updates.
        """
        try:
            for sse in event_source.iter_sse():
                self._handle_sse_event(sse, read_queue, status_queue)
        except httpx.ReadError as exc:
            logger.debug("SSE reader shutting down normally: %s", exc)
        except Exception as exc:
            read_queue.put(exc)
        finally:
            read_queue.put(None)

    def _send_message(self, client: httpx.Client, endpoint_url: str, message: SessionMessage):
        """Send a single message to the server.

        Args:
            client: HTTP client to use.
            endpoint_url: The endpoint URL to send to.
            message: The message to send.
        """
        response = client.post(
            endpoint_url,
            json=message.message.model_dump(
                by_alias=True,
                mode="json",
                exclude_none=True,
            ),
        )
        response.raise_for_status()
        logger.debug("Client message sent successfully: %s", response.status_code)

    def post_writer(self, client: httpx.Client, endpoint_url: str, write_queue: WriteQueue):
        """Handle writing messages to the server.

        Args:
            client: HTTP client to use.
            endpoint_url: The endpoint URL to send messages to.
            write_queue: Queue to read messages from.
        """
        try:
            while True:
                try:
                    message = write_queue.get(timeout=DEFAULT_QUEUE_READ_TIMEOUT)
                    if message is None:
                        break
                    if isinstance(message, Exception):
                        write_queue.put(message)
                        continue

                    self._send_message(client, endpoint_url, message)

                except queue.Empty:
                    continue
        except httpx.ReadError as exc:
            logger.debug("Post writer shutting down normally: %s", exc)
        except Exception as exc:
            logger.exception("Error writing messages")
            write_queue.put(exc)
        finally:
            write_queue.put(None)

    def _wait_for_endpoint(self, status_queue: StatusQueue) -> str:
        """Wait for the endpoint URL from the status queue.

        Args:
            status_queue: Queue to read status from.

        Returns:
            The endpoint URL.

        Raises:
            ValueError: If endpoint URL is not received or there's an error.
        """
        try:
            status = status_queue.get(timeout=1)
        except queue.Empty:
            raise ValueError("failed to get endpoint URL")

        if isinstance(status, _StatusReady):
            return status.endpoint_url
        elif isinstance(status, _StatusError):
            raise status.exc
        else:
            raise ValueError("failed to get endpoint URL")

    def connect(
        self,
        executor: ThreadPoolExecutor,
        client: httpx.Client,
        event_source: EventSource,
    ) -> tuple[ReadQueue, WriteQueue]:
        """Establish connection and start worker threads.

        Args:
            executor: Thread pool executor.
            client: HTTP client.
            event_source: SSE event source.

        Returns:
            Tuple of (read_queue, write_queue).
        """
        read_queue: ReadQueue = queue.Queue()
        write_queue: WriteQueue = queue.Queue()
        status_queue: StatusQueue = queue.Queue()

        # Store event_source for graceful shutdown
        self.event_source = event_source

        # Start SSE reader thread
        executor.submit(self.sse_reader, event_source, read_queue, status_queue)

        # Wait for endpoint URL
        endpoint_url = self._wait_for_endpoint(status_queue)
        self.endpoint_url = endpoint_url

        # Start post writer thread
        executor.submit(self.post_writer, client, endpoint_url, write_queue)

        return read_queue, write_queue


@contextmanager
def sse_client(
    url: str,
    headers: dict[str, Any] | None = None,
    timeout: float = 5.0,
    sse_read_timeout: float = 1 * 60,
) -> Generator[tuple[ReadQueue, WriteQueue], None, None]:
    """
    Client transport for SSE.
    `sse_read_timeout` determines how long (in seconds) the client will wait for a new
    event before disconnecting. All other HTTP operations are controlled by `timeout`.

    Args:
        url: The SSE endpoint URL.
        headers: Optional headers to include in requests.
        timeout: HTTP timeout for regular operations.
        sse_read_timeout: Timeout for SSE read operations.

    Yields:
        Tuple of (read_queue, write_queue) for message communication.
    """
    transport = SSETransport(url, headers, timeout, sse_read_timeout)

    read_queue: ReadQueue | None = None
    write_queue: WriteQueue | None = None

    executor = ThreadPoolExecutor()
    try:
        with create_ssrf_proxy_mcp_http_client(headers=transport.headers) as client:
            with ssrf_proxy_sse_connect(
                url, timeout=httpx.Timeout(timeout, read=sse_read_timeout), client=client
            ) as event_source:
                event_source.response.raise_for_status()

                read_queue, write_queue = transport.connect(executor, client, event_source)

                yield read_queue, write_queue

    except httpx.HTTPStatusError as exc:
        if exc.response.status_code == 401:
            raise MCPAuthError(response=exc.response)
        raise MCPConnectionError()
    except Exception:
        logger.exception("Error connecting to SSE endpoint")
        raise
    finally:
        # Close the SSE connection to unblock the reader thread
        if transport.event_source is not None:
            try:
                transport.event_source.response.close()
            except RuntimeError:
                pass

        # Clean up queues
        if read_queue:
            read_queue.put(None)
        if write_queue:
            write_queue.put(None)

        # Shutdown executor without waiting to prevent hanging
        executor.shutdown(wait=False)


def send_message(http_client: httpx.Client, endpoint_url: str, session_message: SessionMessage):
    """
    Send a message to the server using the provided HTTP client.

    Args:
        http_client: The HTTP client to use for sending
        endpoint_url: The endpoint URL to send the message to
        session_message: The message to send
    """
    try:
        response = http_client.post(
            endpoint_url,
            json=session_message.message.model_dump(
                by_alias=True,
                mode="json",
                exclude_none=True,
            ),
        )
        response.raise_for_status()
        logger.debug("Client message sent successfully: %s", response.status_code)
    except Exception:
        logger.exception("Error sending message")
        raise


def read_messages(
    sse_client: SSEClient,
) -> Generator[SessionMessage | Exception, None, None]:
    """
    Read messages from the SSE client.

    Args:
        sse_client: The SSE client to read from

    Yields:
        SessionMessage or Exception for each event received
    """
    try:
        for sse in sse_client.events():
            if sse.event == "message":
                try:
                    message = types.JSONRPCMessage.model_validate_json(sse.data)
                    logger.debug("Received server message: %s", message)
                    yield SessionMessage(message)
                except Exception as exc:
                    logger.exception("Error parsing server message")
                    yield exc
            else:
                logger.warning("Unknown SSE event: %s", sse.event)
    except Exception as exc:
        logger.exception("Error reading SSE messages")
        yield exc
