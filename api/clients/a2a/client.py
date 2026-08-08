from __future__ import annotations

import time
from collections.abc import Callable, Iterator, Mapping
from queue import Empty, Full, Queue
from threading import Event, Thread
from typing import Any, Protocol
from urllib.parse import SplitResult, quote, urlsplit, urlunsplit
from uuid import uuid4

import httpx
from pydantic import ValidationError

from core.helper.ssrf_proxy import (
    ResponseDeadlineExceededError,
    ResponseLimitError,
    buffer_response,
    ssrf_proxy,
)

from .errors import A2AProtocolError, A2ARemoteError, A2ATransportError
from .models import (
    A2AAgentCard,
    A2AAgentInterface,
    A2ASendMessageResponse,
    A2AStreamResponse,
    A2ATask,
)

_AGENT_CARD_MAX_BYTES = 1024 * 1024
_JSON_RESPONSE_MAX_BYTES = 4 * 1024 * 1024
_ERROR_RESPONSE_MAX_BYTES = 64 * 1024
_SSE_EVENT_MAX_BYTES = 1024 * 1024
_SSE_STREAM_MAX_BYTES = 32 * 1024 * 1024
_SSE_STREAM_MAX_EVENTS = 10_000
_SSE_CONTROL_POLL_SECONDS = 0.25


class A2AHTTPClient(Protocol):
    def get(self, url: str, max_retries: int = 0, **kwargs: Any) -> httpx.Response: ...

    def post(self, url: str, max_retries: int = 0, **kwargs: Any) -> httpx.Response: ...


class A2AClient:
    """Small A2A 1.0 HTTP+JSON client used by discovery and Workflow runtime.

    The implementation intentionally supports the normative subset Dify needs:
    Agent Card discovery, send/stream, task lookup, subscription, and cancel.
    All HTTP requests use Dify's SSRF-controlled client owner.
    """

    def __init__(
        self,
        endpoint: str,
        bearer_token: str | None = None,
        *,
        http_client: A2AHTTPClient = ssrf_proxy,
        connect_timeout_seconds: float = 10.0,
        read_timeout_seconds: float = 600.0,
    ) -> None:
        self._endpoint = endpoint.rstrip("/")
        self._bearer_token = bearer_token
        self._http_client = http_client
        self._overall_timeout_seconds = read_timeout_seconds
        self._timeout = httpx.Timeout(
            connect=connect_timeout_seconds,
            read=read_timeout_seconds,
            write=30.0,
            pool=connect_timeout_seconds,
        )

    def discover(self) -> A2AAgentCard:
        deadline_monotonic = self._default_deadline()
        response = self._request(
            "GET",
            self._agent_card_url(),
            accept="application/json",
            deadline_monotonic=deadline_monotonic,
        )
        bounded = self._buffer_response(
            response,
            max_response_bytes=_AGENT_CARD_MAX_BYTES,
            deadline_monotonic=deadline_monotonic,
        )
        self._raise_for_status(bounded, deadline_monotonic=deadline_monotonic)
        try:
            return A2AAgentCard.model_validate(bounded.json())
        except (ValueError, ValidationError) as error:
            raise A2AProtocolError("External agent returned an invalid A2A Agent Card") from error

    def send_message(
        self,
        *,
        interface: A2AAgentInterface,
        text: str,
        context_id: str | None = None,
        task_id: str | None = None,
        message_id: str | None = None,
        metadata: Mapping[str, Any] | None = None,
        return_immediately: bool = False,
        deadline_monotonic: float | None = None,
        on_activity: Callable[[], None] | None = None,
    ) -> A2ASendMessageResponse:
        if deadline_monotonic is None:
            deadline_monotonic = self._default_deadline()
        response = self._request(
            "POST",
            self._operation_url(interface, "message:send"),
            json=self._message_request(
                interface=interface,
                text=text,
                context_id=context_id,
                task_id=task_id,
                message_id=message_id,
                metadata=metadata,
                return_immediately=return_immediately,
            ),
            accept="application/json",
            deadline_monotonic=deadline_monotonic,
        )
        bounded = self._buffer_response(
            response,
            max_response_bytes=_JSON_RESPONSE_MAX_BYTES,
            deadline_monotonic=deadline_monotonic,
            on_activity=on_activity,
        )
        self._raise_for_status(bounded, deadline_monotonic=deadline_monotonic, on_activity=on_activity)
        try:
            return A2ASendMessageResponse.model_validate(bounded.json())
        except (ValueError, ValidationError) as error:
            raise A2AProtocolError("External agent returned an invalid A2A SendMessage response") from error

    def stream_message(
        self,
        *,
        interface: A2AAgentInterface,
        text: str,
        context_id: str | None = None,
        task_id: str | None = None,
        message_id: str | None = None,
        metadata: Mapping[str, Any] | None = None,
        deadline_monotonic: float | None = None,
        on_activity: Callable[[], None] | None = None,
    ) -> Iterator[A2AStreamResponse]:
        if deadline_monotonic is None:
            deadline_monotonic = self._default_deadline()
        response = _open_stream_response_with_control(
            lambda: self._request(
                "POST",
                self._operation_url(interface, "message:stream"),
                json=self._message_request(
                    interface=interface,
                    text=text,
                    context_id=context_id,
                    task_id=task_id,
                    message_id=message_id,
                    metadata=metadata,
                ),
                accept="text/event-stream",
                stream_response=True,
                deadline_monotonic=deadline_monotonic,
            ),
            deadline_monotonic=deadline_monotonic,
            on_activity=on_activity,
        )
        self._raise_for_status(response, deadline_monotonic=deadline_monotonic, on_activity=on_activity)
        try:
            for payload in _iter_sse_data(
                response,
                deadline_monotonic=deadline_monotonic,
                on_activity=on_activity,
            ):
                try:
                    yield A2AStreamResponse.model_validate_json(payload)
                except (ValueError, ValidationError) as error:
                    raise A2AProtocolError("External agent returned an invalid A2A stream event") from error
        except httpx.HTTPError as error:
            raise A2ATransportError("External A2A stream was interrupted") from error
        finally:
            response.close()

    def subscribe(
        self,
        *,
        interface: A2AAgentInterface,
        task_id: str,
        deadline_monotonic: float | None = None,
        on_activity: Callable[[], None] | None = None,
    ) -> Iterator[A2AStreamResponse]:
        if deadline_monotonic is None:
            deadline_monotonic = self._default_deadline()
        response = _open_stream_response_with_control(
            lambda: self._request(
                "GET",
                self._operation_url(interface, f"tasks/{quote(task_id, safe='')}:subscribe"),
                accept="text/event-stream",
                stream_response=True,
                deadline_monotonic=deadline_monotonic,
            ),
            deadline_monotonic=deadline_monotonic,
            on_activity=on_activity,
        )
        self._raise_for_status(response, deadline_monotonic=deadline_monotonic, on_activity=on_activity)
        try:
            for payload in _iter_sse_data(
                response,
                deadline_monotonic=deadline_monotonic,
                on_activity=on_activity,
            ):
                try:
                    yield A2AStreamResponse.model_validate_json(payload)
                except (ValueError, ValidationError) as error:
                    raise A2AProtocolError("External agent returned an invalid A2A subscription event") from error
        except httpx.HTTPError as error:
            raise A2ATransportError("External A2A task subscription was interrupted") from error
        finally:
            response.close()

    def get_task(
        self,
        *,
        interface: A2AAgentInterface,
        task_id: str,
        deadline_monotonic: float | None = None,
        on_activity: Callable[[], None] | None = None,
    ) -> A2ATask:
        if deadline_monotonic is None:
            deadline_monotonic = self._default_deadline()
        response = self._request(
            "GET",
            self._operation_url(interface, f"tasks/{quote(task_id, safe='')}"),
            accept="application/json",
            deadline_monotonic=deadline_monotonic,
        )
        bounded = self._buffer_response(
            response,
            max_response_bytes=_JSON_RESPONSE_MAX_BYTES,
            deadline_monotonic=deadline_monotonic,
            on_activity=on_activity,
        )
        self._raise_for_status(bounded, deadline_monotonic=deadline_monotonic, on_activity=on_activity)
        try:
            return A2ATask.model_validate(bounded.json())
        except (ValueError, ValidationError) as error:
            raise A2AProtocolError("External agent returned an invalid A2A Task") from error

    def cancel_task(
        self,
        *,
        interface: A2AAgentInterface,
        task_id: str,
        deadline_monotonic: float | None = None,
        on_activity: Callable[[], None] | None = None,
    ) -> A2ATask:
        if deadline_monotonic is None:
            deadline_monotonic = self._default_deadline()
        payload: dict[str, Any] = {"id": task_id}
        if interface.tenant:
            payload["tenant"] = interface.tenant
        response = self._request(
            "POST",
            self._operation_url(interface, f"tasks/{quote(task_id, safe='')}:cancel"),
            json=payload,
            accept="application/json",
            deadline_monotonic=deadline_monotonic,
        )
        bounded = self._buffer_response(
            response,
            max_response_bytes=_JSON_RESPONSE_MAX_BYTES,
            deadline_monotonic=deadline_monotonic,
            on_activity=on_activity,
        )
        self._raise_for_status(bounded, deadline_monotonic=deadline_monotonic, on_activity=on_activity)
        try:
            return A2ATask.model_validate(bounded.json())
        except (ValueError, ValidationError) as error:
            raise A2AProtocolError("External agent returned an invalid canceled A2A Task") from error

    def _request(
        self,
        method: str,
        url: str,
        *,
        accept: str,
        stream_response: bool = True,
        deadline_monotonic: float | None = None,
        **kwargs: Any,
    ) -> httpx.Response:
        headers = {
            "Accept": accept,
            "Accept-Encoding": "identity",
            "A2A-Version": "1.0",
        }
        if "json" in kwargs:
            headers["Content-Type"] = "application/a2a+json"
        if self._bearer_token:
            headers["Authorization"] = f"Bearer {self._bearer_token}"
        try:
            caller = self._http_client.get if method == "GET" else self._http_client.post
            return caller(
                url,
                max_retries=0,
                headers=headers,
                timeout=self._timeout_for_deadline(deadline_monotonic),
                follow_redirects=False,
                stream_response=stream_response,
                **kwargs,
            )
        except Exception as error:
            raise A2ATransportError(f"Could not reach external A2A agent at {url}") from error

    def _default_deadline(self) -> float:
        return time.monotonic() + self._overall_timeout_seconds

    def _timeout_for_deadline(self, deadline_monotonic: float | None) -> httpx.Timeout:
        if deadline_monotonic is None:
            return self._timeout
        remaining_seconds = max(0.001, deadline_monotonic - time.monotonic())
        return httpx.Timeout(
            connect=min(self._timeout.connect or remaining_seconds, remaining_seconds),
            read=min(self._timeout.read or remaining_seconds, remaining_seconds),
            write=min(self._timeout.write or remaining_seconds, remaining_seconds),
            pool=min(self._timeout.pool or remaining_seconds, remaining_seconds),
        )

    @staticmethod
    def _buffer_response(
        response: httpx.Response,
        *,
        max_response_bytes: int,
        deadline_monotonic: float,
        on_activity: Callable[[], None] | None = None,
    ) -> httpx.Response:
        try:
            return buffer_response(
                response,
                max_response_bytes=max_response_bytes,
                deadline_monotonic=deadline_monotonic,
                on_chunk=on_activity,
            )
        except ResponseDeadlineExceededError as error:
            raise A2ATransportError("External A2A response exceeded its execution deadline") from error
        except ResponseLimitError as error:
            raise A2AProtocolError("External A2A response exceeded a protocol safety limit") from error
        except httpx.HTTPError as error:
            raise A2ATransportError("External A2A response was interrupted") from error

    def _agent_card_url(self) -> str:
        parsed = urlsplit(self._endpoint)
        _validate_http_url(parsed, label="A2A endpoint")
        if parsed.path.endswith("/.well-known/agent-card.json"):
            return self._endpoint
        path = f"{parsed.path.rstrip('/')}/.well-known/agent-card.json"
        return urlunsplit((parsed.scheme, parsed.netloc, path, "", ""))

    @staticmethod
    def _operation_url(interface: A2AAgentInterface, operation: str) -> str:
        parsed = urlsplit(interface.url)
        _validate_http_url(parsed, label="A2A Agent Interface")
        path = parsed.path.rstrip("/")
        if interface.tenant:
            path = f"{path}/{quote(interface.tenant, safe='')}"
        path = f"{path}/{operation}"
        return urlunsplit((parsed.scheme, parsed.netloc, path, "", ""))

    @staticmethod
    def _message_request(
        *,
        interface: A2AAgentInterface,
        text: str,
        context_id: str | None,
        task_id: str | None,
        message_id: str | None,
        metadata: Mapping[str, Any] | None,
        return_immediately: bool = False,
    ) -> dict[str, Any]:
        message: dict[str, Any] = {
            "messageId": message_id or str(uuid4()),
            "role": "ROLE_USER",
            "parts": [{"text": text, "mediaType": "text/plain"}],
        }
        if context_id:
            message["contextId"] = context_id
        if task_id:
            message["taskId"] = task_id
        payload: dict[str, Any] = {
            "message": message,
            "configuration": {
                "acceptedOutputModes": ["text/plain", "application/json"],
                "historyLength": 0,
                "returnImmediately": return_immediately,
            },
        }
        if interface.tenant:
            payload["tenant"] = interface.tenant
        if metadata:
            payload["metadata"] = dict(metadata)
        return payload

    def _raise_for_status(
        self,
        response: httpx.Response,
        *,
        deadline_monotonic: float,
        on_activity: Callable[[], None] | None = None,
    ) -> None:
        if response.status_code < 400:
            return
        if response.is_stream_consumed:
            self._buffer_response(
                response,
                max_response_bytes=_ERROR_RESPONSE_MAX_BYTES,
                deadline_monotonic=deadline_monotonic,
                on_activity=on_activity,
            )
        else:
            # The error body is deliberately never surfaced. Closing an unread
            # streaming body also prevents a silent peer from holding workflow
            # cancellation until the HTTP read timeout expires.
            response.close()
        # Never propagate a remote error body into workflow execution logs. An
        # external server sees the Authorization header and could accidentally
        # or deliberately reflect the bearer token in that body.
        raise A2ARemoteError(f"External A2A agent returned HTTP {response.status_code}")


def _iter_sse_data(
    response: httpx.Response,
    *,
    deadline_monotonic: float | None = None,
    on_activity: Callable[[], None] | None = None,
) -> Iterator[str]:
    _validate_identity_content_encoding(response)
    data_lines: list[str] = []
    data_size = 0
    stream_size = 0
    event_count = 0

    def process_line(line: str) -> str | None:
        nonlocal data_size, event_count
        if line == "":
            if not data_lines:
                return None
            event_count += 1
            if event_count > _SSE_STREAM_MAX_EVENTS:
                raise A2AProtocolError("External agent returned too many A2A stream events")
            payload = "\n".join(data_lines)
            data_lines.clear()
            data_size = 0
            return payload
        if line.startswith(":"):
            return None
        field, separator, value = line.partition(":")
        if not separator:
            return None
        value = value.removeprefix(" ")
        if field == "data":
            data_size += len(value.encode("utf-8"))
            if data_size > _SSE_EVENT_MAX_BYTES:
                raise A2AProtocolError("External agent returned an oversized A2A stream event")
            data_lines.append(value)
        return None

    pending = bytearray()
    for chunk in _iter_response_bytes_with_control(
        response,
        deadline_monotonic=deadline_monotonic,
        on_activity=on_activity,
    ):
        stream_size += len(chunk)
        if stream_size > _SSE_STREAM_MAX_BYTES:
            raise A2AProtocolError("External agent returned an oversized A2A event stream")
        pending.extend(chunk)
        while (newline := pending.find(b"\n")) >= 0:
            raw_line = bytes(pending[:newline])
            del pending[: newline + 1]
            if raw_line.endswith(b"\r"):
                raw_line = raw_line[:-1]
            try:
                line = raw_line.decode("utf-8")
            except UnicodeDecodeError as error:
                raise A2AProtocolError("External agent returned a non-UTF-8 A2A event stream") from error
            if payload := process_line(line):
                yield payload
    if pending:
        try:
            line = bytes(pending).removesuffix(b"\r").decode("utf-8")
        except UnicodeDecodeError as error:
            raise A2AProtocolError("External agent returned a non-UTF-8 A2A event stream") from error
        if payload := process_line(line):
            yield payload
    if data_lines:
        event_count += 1
        if event_count > _SSE_STREAM_MAX_EVENTS:
            raise A2AProtocolError("External agent returned too many A2A stream events")
        yield "\n".join(data_lines)


def _validate_identity_content_encoding(response: httpx.Response) -> None:
    content_encoding = response.headers.get("Content-Encoding")
    if content_encoding is None:
        return
    encodings = [encoding.strip().lower() for encoding in content_encoding.split(",")]
    if any(encoding not in {"", "identity"} for encoding in encodings):
        raise A2AProtocolError("External agent returned a non-identity Content-Encoding for an A2A event stream")


def _open_stream_response_with_control(
    request: Callable[[], httpx.Response],
    *,
    deadline_monotonic: float,
    on_activity: Callable[[], None] | None,
) -> httpx.Response:
    """Open a streaming response without letting header silence block cancellation."""

    _check_stream_control(deadline_monotonic=deadline_monotonic, on_activity=on_activity)
    results: Queue[tuple[httpx.Response | None, BaseException | None]] = Queue()
    abandoned = Event()

    def run_request() -> None:
        try:
            response = request()
        except BaseException as error:
            if not abandoned.is_set():
                results.put((None, error))
            return
        if abandoned.is_set():
            response.close()
            return
        results.put((response, None))
        if abandoned.is_set():
            try:
                queued_response, _ = results.get_nowait()
            except Empty:
                return
            if queued_response is not None:
                queued_response.close()

    Thread(target=run_request, name="a2a-stream-open", daemon=True).start()
    try:
        while True:
            _check_stream_control(deadline_monotonic=deadline_monotonic, on_activity=on_activity)
            try:
                response, error = results.get(timeout=_control_wait_seconds(deadline_monotonic=deadline_monotonic))
            except Empty:
                continue
            if error is not None:
                raise error
            if response is None:
                raise A2ATransportError("External A2A stream returned no response")
            return response
    except BaseException:
        abandoned.set()
        try:
            response, _ = results.get_nowait()
        except Empty:
            pass
        else:
            if response is not None:
                response.close()
        raise


def _iter_response_bytes_with_control(
    response: httpx.Response,
    *,
    deadline_monotonic: float | None,
    on_activity: Callable[[], None] | None,
) -> Iterator[bytes]:
    """Read a sync HTTP stream on a worker so silence remains cancellable."""

    results: Queue[tuple[bytes | None, BaseException | None, bool]] = Queue(maxsize=1)
    abandoned = Event()

    def put_result(result: tuple[bytes | None, BaseException | None, bool]) -> bool:
        while not abandoned.is_set():
            try:
                results.put(result, timeout=_SSE_CONTROL_POLL_SECONDS)
            except Full:
                continue
            return True
        return False

    def read_response() -> None:
        try:
            for chunk in response.iter_bytes():
                if abandoned.is_set():
                    return
                if not put_result((chunk, None, False)):
                    return
        except BaseException as error:
            if not abandoned.is_set():
                put_result((None, error, False))
            return
        if not abandoned.is_set():
            put_result((None, None, True))

    Thread(target=read_response, name="a2a-stream-read", daemon=True).start()
    try:
        while True:
            _check_stream_control(deadline_monotonic=deadline_monotonic, on_activity=on_activity)
            try:
                chunk, error, completed = results.get(
                    timeout=_control_wait_seconds(deadline_monotonic=deadline_monotonic)
                )
            except Empty:
                continue
            if error is not None:
                raise error
            if completed:
                return
            if chunk is not None:
                yield chunk
    finally:
        abandoned.set()
        response.close()


def _check_stream_control(
    *,
    deadline_monotonic: float | None,
    on_activity: Callable[[], None] | None,
) -> None:
    if deadline_monotonic is not None and time.monotonic() >= deadline_monotonic:
        raise A2ATransportError("External A2A stream exceeded its execution deadline")
    if on_activity is not None:
        on_activity()


def _control_wait_seconds(*, deadline_monotonic: float | None) -> float:
    if deadline_monotonic is None:
        return _SSE_CONTROL_POLL_SECONDS
    return max(0.001, min(_SSE_CONTROL_POLL_SECONDS, deadline_monotonic - time.monotonic()))


def validate_same_origin_interface(endpoint: str, interface_url: str) -> None:
    """Prevent a discovered card from redirecting connection credentials to another origin."""

    endpoint_parts = urlsplit(endpoint)
    interface_parts = urlsplit(interface_url)
    _validate_http_url(endpoint_parts, label="A2A endpoint")
    _validate_http_url(interface_parts, label="A2A Agent Interface")
    if _http_origin(endpoint_parts) != _http_origin(interface_parts):
        raise A2AProtocolError("A2A Agent Interface must use the same origin as the configured endpoint")


def _validate_http_url(parts: SplitResult, *, label: str) -> None:
    if parts.scheme not in {"http", "https"} or not parts.netloc or parts.hostname is None:
        raise A2AProtocolError(f"{label} must be an absolute HTTP(S) URL")
    if parts.username is not None or parts.password is not None:
        raise A2AProtocolError(f"{label} must not contain embedded credentials")
    if parts.query or parts.fragment:
        raise A2AProtocolError(f"{label} must not contain a query or fragment")
    try:
        _port = parts.port
    except ValueError as error:
        raise A2AProtocolError(f"{label} contains an invalid port") from error


def _http_origin(parts: SplitResult) -> tuple[str, str, int]:
    hostname = parts.hostname
    if hostname is None:
        raise A2AProtocolError("A2A URL is missing a hostname")
    default_port = 443 if parts.scheme == "https" else 80
    return parts.scheme, hostname, parts.port or default_port
