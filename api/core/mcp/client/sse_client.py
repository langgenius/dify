import logging
import queue
import threading
from collections.abc import Generator
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from typing import Any
from urllib.parse import urljoin, urlparse

import httpx
from httpx_sse import connect_sse
from sseclient import SSEClient

from core.mcp import types
from core.mcp.types import SessionMessage
from core.mcp.utils import create_mcp_http_client, remove_request_params

logger = logging.getLogger(__name__)


@contextmanager
def sse_client(
    url: str,
    headers: dict[str, Any] | None = None,
    timeout: float = 5.0,
    sse_read_timeout: float = 5 * 60,
) -> Generator[tuple[queue.Queue, queue.Queue], None, None]:
    """
    Client transport for SSE.
    `sse_read_timeout` determines how long (in seconds) the client will wait for a new
    event before disconnecting. All other HTTP operations are controlled by `timeout`.
    """
    if headers is None:
        headers = {}

    read_queue = queue.Queue()
    write_queue = queue.Queue()
    status_queue = queue.Queue()
    cancel_event = threading.Event()
    with ThreadPoolExecutor() as executor:
        try:
            logger.info(f"Connecting to SSE endpoint: {remove_request_params(url)}")
            with create_mcp_http_client(headers=headers) as client:
                with connect_sse(
                    client, "GET", url, timeout=httpx.Timeout(timeout, read=sse_read_timeout)
                ) as event_source:
                    event_source.response.raise_for_status()
                    logger.debug("SSE connection established")

                    def sse_reader(status_queue: queue.Queue):
                        try:
                            while not cancel_event.is_set():
                                for sse in event_source.iter_sse():
                                    if cancel_event.is_set():
                                        break
                                    match sse.event:
                                        case "endpoint":
                                            endpoint_url = urljoin(url, sse.data)
                                            logger.info(f"Received endpoint URL: {endpoint_url}")
                                            url_parsed = urlparse(url)
                                            endpoint_parsed = urlparse(endpoint_url)

                                            if (
                                                url_parsed.netloc != endpoint_parsed.netloc
                                                or url_parsed.scheme != endpoint_parsed.scheme
                                            ):
                                                error_msg = (
                                                    f"Endpoint origin does not match connection origin: {endpoint_url}"
                                                )
                                                logger.error(error_msg)
                                                raise ValueError(error_msg)
                                            status_queue.put(("ready", endpoint_url))
                                        case "message":
                                            try:
                                                message = types.JSONRPCMessage.model_validate_json(sse.data)
                                                logger.debug(f"Received server message: {message}")
                                            except Exception as exc:
                                                logger.exception("Error parsing server message")
                                                read_queue.put(exc)
                                                continue
                                            session_message = SessionMessage(message)
                                            read_queue.put(session_message)
                                        case _:
                                            logger.warning(f"Unknown SSE event: {sse.event}")

                        except Exception as exc:
                            if not cancel_event.is_set():
                                logger.exception("Error reading SSE messages")
                                read_queue.put(exc)
                        finally:
                            read_queue.put(None)

                    def post_writer(endpoint_url: str):
                        try:
                            while not cancel_event.is_set():
                                try:
                                    message = write_queue.get(timeout=5)
                                    if message is None:
                                        break
                                    response = client.post(
                                        endpoint_url,
                                        json=message.message.model_dump(
                                            by_alias=True,
                                            mode="json",
                                            exclude_none=True,
                                        ),
                                    )
                                    response.raise_for_status()
                                    logger.debug(f"Client message sent successfully: {response.status_code}")
                                    if cancel_event.is_set():
                                        break
                                except queue.Empty:
                                    if cancel_event.is_set():
                                        break
                                    continue
                        except Exception:
                            logger.exception("Error writing messages")
                        finally:
                            write_queue.put(None)

                    executor.submit(sse_reader, status_queue)
                    try:
                        status, endpoint_url = status_queue.get(timeout=1)
                    except queue.Empty:
                        raise ValueError("failed to get endpoint URL")
                    if status != "ready":
                        raise ValueError("failed to get endpoint URL")
                    executor.submit(post_writer, endpoint_url)
                    try:
                        yield read_queue, write_queue
                    finally:
                        cancel_event.set()
        except Exception as exc:
            logger.exception("Error connecting to SSE endpoint")
            raise exc
        finally:
            read_queue.put(None)
            write_queue.put(None)


def send_message(http_client: httpx.Client, endpoint_url: str, session_message: SessionMessage) -> None:
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
        logger.debug(f"Client message sent successfully: {response.status_code}")
    except Exception as exc:
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
                    logger.debug(f"Received server message: {message}")
                    yield SessionMessage(message)
                except Exception as exc:
                    logger.exception("Error parsing server message")
                    yield exc
            else:
                logger.warning(f"Unknown SSE event: {sse.event}")
    except Exception as exc:
        logger.exception("Error reading SSE messages")
        yield exc
