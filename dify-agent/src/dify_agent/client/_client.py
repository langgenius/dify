"""HTTPX-based client for Dify Agent runs.

The client uses the public DTOs from ``dify_agent.protocol.schemas`` for all
normal request and response parsing. It intentionally does not retry
``POST /runs`` because create-run is not idempotent, and create helpers require a
``CreateRunRequest`` instance rather than accepting raw payload dicts. SSE
streams are the only operation with reconnect logic: transient stream, connect,
or read failures, stream timeouts, and HTTP 5xx stream responses reconnect with
the latest observed event id, while HTTP 4xx responses, DTO validation failures,
and malformed SSE frames fail immediately.
"""

from __future__ import annotations

import asyncio
import time
from collections.abc import AsyncIterator, Iterator
from types import TracebackType
from typing import Self, TypeVar, cast
from urllib.parse import quote

import httpx
from pydantic import BaseModel, ValidationError

from dify_agent.protocol.schemas import (
    CreateRunRequest,
    CreateRunResponse,
    RUN_EVENT_ADAPTER,
    RunEvent,
    RunEventsResponse,
    RunStatusResponse,
)

_ResponseModelT = TypeVar("_ResponseModelT", bound=BaseModel)
_TERMINAL_EVENT_TYPES = {"run_succeeded", "run_failed"}
_TERMINAL_RUN_STATUSES = {"succeeded", "failed"}


class DifyAgentClientError(RuntimeError):
    """Base class for errors raised by the Dify Agent Python client."""


class DifyAgentHTTPError(DifyAgentClientError):
    """Raised for HTTP 4xx/5xx responses not covered by a narrower subclass."""

    status_code: int
    detail: object

    def __init__(self, status_code: int, detail: object) -> None:
        self.status_code = status_code
        self.detail = detail
        super().__init__(f"Dify Agent HTTP {status_code}: {detail}")


class DifyAgentNotFoundError(DifyAgentHTTPError):
    """Raised when the server returns ``404`` for a run resource."""


class DifyAgentValidationError(DifyAgentHTTPError):
    """Raised for local input validation, invalid DTO responses, or HTTP ``422``."""

    def __init__(self, detail: object, *, status_code: int = 422) -> None:
        super().__init__(status_code=status_code, detail=detail)


class DifyAgentTimeoutError(DifyAgentClientError):
    """Raised when an HTTPX timeout occurs outside successful SSE reconnects."""


class DifyAgentStreamError(DifyAgentClientError):
    """Raised for malformed SSE frames or exhausted SSE reconnect attempts."""


class _ReconnectableStreamError(Exception):
    """Internal wrapper for stream failures that may be retried by the caller."""

    error: DifyAgentClientError

    def __init__(self, error: DifyAgentClientError) -> None:
        self.error = error
        super().__init__(str(error))


class _SSEDecoder:
    """Incrementally decode SSE lines into typed run events.

    The decoder keeps only the fields for the current frame. Comments are ignored,
    ``data`` fields are joined with newlines as required by the SSE specification,
    and payload JSON is validated by ``RUN_EVENT_ADAPTER``. The frame ``id`` is
    copied into the decoded event only when the JSON payload omits ``event.id``.
    """

    _event_id: str | None
    _event_type: str | None
    _data_lines: list[str]

    def __init__(self) -> None:
        self._event_id = None
        self._event_type = None
        self._data_lines = []

    def feed_line(self, raw_line: str) -> RunEvent | None:
        """Consume one SSE line and return an event when a frame completes.

        Empty lines dispatch the current frame. Comment-only frames and frames
        without ``data`` are ignored so server heartbeats do not surface to users.
        Malformed event payloads raise ``DifyAgentStreamError`` and must not be
        retried because replaying would repeat the same invalid frame.
        """
        line = raw_line.rstrip("\r")
        if line == "":
            return self._dispatch()
        if line.startswith(":"):
            return None

        field, separator, value = line.partition(":")
        if separator and value.startswith(" "):
            value = value[1:]
        if field == "id":
            self._event_id = value
        elif field == "event":
            self._event_type = value
        elif field == "data":
            self._data_lines.append(value)
        return None

    def _dispatch(self) -> RunEvent | None:
        """Validate and return the current frame, then clear decoder state."""
        if not self._data_lines:
            self._reset()
            return None

        frame_id = self._event_id
        frame_event_type = self._event_type
        data = "\n".join(self._data_lines)
        self._reset()

        try:
            event = RUN_EVENT_ADAPTER.validate_json(data)
        except ValidationError as exc:
            raise DifyAgentStreamError("malformed SSE data frame") from exc
        if frame_event_type is not None and frame_event_type != event.type:
            raise DifyAgentStreamError(
                f"SSE event field {frame_event_type!r} does not match payload type {event.type!r}"
            )
        if frame_id is not None and event.id is None:
            return event.model_copy(update={"id": frame_id})
        return event

    def _reset(self) -> None:
        """Clear the current frame without changing decoder configuration."""
        self._event_id = None
        self._event_type = None
        self._data_lines = []


class Client:
    """Unified synchronous and asynchronous client for Dify Agent runs.

    The instance is intentionally small and stateful: it stores base URL, default
    headers, timeout settings, optional external HTTPX clients, and lazy-owned
    clients for whichever sync/async side is used. External clients are never
    closed by this wrapper. Owned sync clients close via ``close_sync`` or the
    sync context manager; owned async clients close via ``aclose`` or the async
    context manager.
    """

    _base_url: str
    _timeout: float | httpx.Timeout
    _stream_timeout: float | httpx.Timeout | None
    _headers: dict[str, str]
    _sync_http_client: httpx.Client | None
    _async_http_client: httpx.AsyncClient | None
    _owns_sync_http_client: bool
    _owns_async_http_client: bool
    _sync_closed: bool
    _async_closed: bool

    def __init__(
        self,
        *,
        base_url: str,
        timeout: float | httpx.Timeout = 30.0,
        stream_timeout: float | httpx.Timeout | None = None,
        headers: dict[str, str] | None = None,
        sync_http_client: httpx.Client | None = None,
        async_http_client: httpx.AsyncClient | None = None,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._timeout = timeout
        self._stream_timeout = stream_timeout
        self._headers = dict(headers or {})
        self._sync_http_client = sync_http_client
        self._async_http_client = async_http_client
        self._owns_sync_http_client = sync_http_client is None
        self._owns_async_http_client = async_http_client is None
        self._sync_closed = False
        self._async_closed = False

    def __enter__(self) -> Self:
        """Enter a sync context and return this client without opening the network."""
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc_value: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        """Close the owned sync HTTP client when leaving a sync context."""
        del exc_type, exc_value, traceback
        self.close_sync()

    async def __aenter__(self) -> Self:
        """Enter an async context and return this client without opening the network."""
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc_value: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        """Close owned async resources when leaving an async context."""
        del exc_type, exc_value, traceback
        await self.aclose()

    def close_sync(self) -> None:
        """Close the owned synchronous HTTPX client if it was created."""
        if self._sync_closed:
            return
        if self._owns_sync_http_client and self._sync_http_client is not None:
            self._sync_http_client.close()
        self._sync_closed = True

    async def aclose(self) -> None:
        """Close owned asynchronous resources and any owned sync client already opened."""
        if not self._async_closed:
            if self._owns_async_http_client and self._async_http_client is not None:
                await self._async_http_client.aclose()
            self._async_closed = True
        if self._owns_sync_http_client and self._sync_http_client is not None:
            self.close_sync()

    async def create_run(self, request: CreateRunRequest) -> CreateRunResponse:
        """Create one run and return its accepted status response.

        ``request`` must already be a public ``CreateRunRequest`` DTO. This
        method performs exactly one ``POST /runs`` attempt and maps HTTPX
        timeouts to ``DifyAgentTimeoutError``.
        """
        request_model = _validate_create_run_request(request)
        try:
            response = await self._get_async_http_client().post(
                self._url("/runs"),
                content=request_model.model_dump_json(),
                headers=self._merged_headers({"Content-Type": "application/json"}),
                timeout=self._timeout,
            )
        except httpx.TimeoutException as exc:
            raise DifyAgentTimeoutError("create_run timed out") from exc
        except httpx.RequestError as exc:
            raise DifyAgentClientError(f"create_run request failed: {exc}") from exc
        return _parse_model_response(response, CreateRunResponse)

    def create_run_sync(self, request: CreateRunRequest) -> CreateRunResponse:
        """Synchronous variant of ``create_run`` with the same no-retry contract."""
        request_model = _validate_create_run_request(request)
        try:
            response = self._get_sync_http_client().post(
                self._url("/runs"),
                content=request_model.model_dump_json(),
                headers=self._merged_headers({"Content-Type": "application/json"}),
                timeout=self._timeout,
            )
        except httpx.TimeoutException as exc:
            raise DifyAgentTimeoutError("create_run_sync timed out") from exc
        except httpx.RequestError as exc:
            raise DifyAgentClientError(f"create_run_sync request failed: {exc}") from exc
        return _parse_model_response(response, CreateRunResponse)

    async def get_run(self, run_id: str) -> RunStatusResponse:
        """Return the current status for ``run_id`` or raise a mapped client error."""
        try:
            response = await self._get_async_http_client().get(
                self._url(f"/runs/{quote(run_id, safe='')}"),
                headers=self._merged_headers(),
                timeout=self._timeout,
            )
        except httpx.TimeoutException as exc:
            raise DifyAgentTimeoutError("get_run timed out") from exc
        except httpx.RequestError as exc:
            raise DifyAgentClientError(f"get_run request failed: {exc}") from exc
        return _parse_model_response(response, RunStatusResponse)

    def get_run_sync(self, run_id: str) -> RunStatusResponse:
        """Synchronous variant of ``get_run``."""
        try:
            response = self._get_sync_http_client().get(
                self._url(f"/runs/{quote(run_id, safe='')}"),
                headers=self._merged_headers(),
                timeout=self._timeout,
            )
        except httpx.TimeoutException as exc:
            raise DifyAgentTimeoutError("get_run_sync timed out") from exc
        except httpx.RequestError as exc:
            raise DifyAgentClientError(f"get_run_sync request failed: {exc}") from exc
        return _parse_model_response(response, RunStatusResponse)

    async def get_events(self, run_id: str, *, after: str = "0-0", limit: int = 100) -> RunEventsResponse:
        """Return one cursor-paginated page of events for ``run_id``."""
        try:
            response = await self._get_async_http_client().get(
                self._url(f"/runs/{quote(run_id, safe='')}/events"),
                params={"after": after, "limit": str(limit)},
                headers=self._merged_headers(),
                timeout=self._timeout,
            )
        except httpx.TimeoutException as exc:
            raise DifyAgentTimeoutError("get_events timed out") from exc
        except httpx.RequestError as exc:
            raise DifyAgentClientError(f"get_events request failed: {exc}") from exc
        return _parse_model_response(response, RunEventsResponse)

    def get_events_sync(self, run_id: str, *, after: str = "0-0", limit: int = 100) -> RunEventsResponse:
        """Synchronous variant of ``get_events``."""
        try:
            response = self._get_sync_http_client().get(
                self._url(f"/runs/{quote(run_id, safe='')}/events"),
                params={"after": after, "limit": str(limit)},
                headers=self._merged_headers(),
                timeout=self._timeout,
            )
        except httpx.TimeoutException as exc:
            raise DifyAgentTimeoutError("get_events_sync timed out") from exc
        except httpx.RequestError as exc:
            raise DifyAgentClientError(f"get_events_sync request failed: {exc}") from exc
        return _parse_model_response(response, RunEventsResponse)

    async def stream_events(
        self,
        run_id: str,
        *,
        after: str | None = None,
        reconnect: bool = True,
        max_reconnects: int | None = None,
        reconnect_delay_seconds: float = 1.0,
        until_terminal: bool = True,
    ) -> AsyncIterator[RunEvent]:
        """Yield typed events from SSE with cursor-based reconnect.

        The initial cursor is ``after`` or ``"0-0"``. After every yielded event
        with an id, reconnects resume from that id using the ``after`` query
        parameter. HTTP 5xx stream responses are retried, but HTTP 4xx responses,
        DTO validation failures, and malformed SSE frames are not retried. By
        default iteration stops after ``run_succeeded`` or ``run_failed``.
        """
        _validate_stream_options(max_reconnects, reconnect_delay_seconds)
        cursor = after or "0-0"
        reconnect_attempts = 0
        while True:
            try:
                async for event in self._stream_events_once(run_id, after=cursor):
                    if event.id is not None:
                        cursor = event.id
                    yield event
                    if until_terminal and event.type in _TERMINAL_EVENT_TYPES:
                        return
            except _ReconnectableStreamError as exc:
                if not reconnect:
                    raise exc.error from exc
                reconnect_attempts = _next_reconnect_attempt(
                    reconnect_attempts,
                    max_reconnects=max_reconnects,
                    error=exc.error,
                )
                await _sleep_async(reconnect_delay_seconds)
                continue
            if not reconnect:
                return
            reconnect_attempts = _next_reconnect_attempt(
                reconnect_attempts,
                max_reconnects=max_reconnects,
                error=DifyAgentStreamError("SSE stream ended before a terminal event"),
            )
            await _sleep_async(reconnect_delay_seconds)

    def stream_events_sync(
        self,
        run_id: str,
        *,
        after: str | None = None,
        reconnect: bool = True,
        max_reconnects: int | None = None,
        reconnect_delay_seconds: float = 1.0,
        until_terminal: bool = True,
    ) -> Iterator[RunEvent]:
        """Synchronous variant of ``stream_events`` with the same reconnect rules."""
        _validate_stream_options(max_reconnects, reconnect_delay_seconds)
        cursor = after or "0-0"
        reconnect_attempts = 0
        while True:
            try:
                for event in self._stream_events_once_sync(run_id, after=cursor):
                    if event.id is not None:
                        cursor = event.id
                    yield event
                    if until_terminal and event.type in _TERMINAL_EVENT_TYPES:
                        return
            except _ReconnectableStreamError as exc:
                if not reconnect:
                    raise exc.error from exc
                reconnect_attempts = _next_reconnect_attempt(
                    reconnect_attempts,
                    max_reconnects=max_reconnects,
                    error=exc.error,
                )
                _sleep_sync(reconnect_delay_seconds)
                continue
            if not reconnect:
                return
            reconnect_attempts = _next_reconnect_attempt(
                reconnect_attempts,
                max_reconnects=max_reconnects,
                error=DifyAgentStreamError("SSE stream ended before a terminal event"),
            )
            _sleep_sync(reconnect_delay_seconds)

    async def wait_run(
        self,
        run_id: str,
        *,
        poll_interval_seconds: float = 1.0,
        timeout_seconds: float | None = None,
    ) -> RunStatusResponse:
        """Poll run status until it becomes terminal and return the final status."""
        _validate_wait_options(poll_interval_seconds, timeout_seconds)
        deadline = time.monotonic() + timeout_seconds if timeout_seconds is not None else None
        while True:
            status = await self.get_run(run_id)
            if status.status in _TERMINAL_RUN_STATUSES:
                return status
            sleep_for = _next_sleep_seconds(poll_interval_seconds, deadline)
            if sleep_for is None:
                raise DifyAgentTimeoutError(f"run {run_id!r} did not finish before timeout")
            await _sleep_async(sleep_for)

    def wait_run_sync(
        self,
        run_id: str,
        *,
        poll_interval_seconds: float = 1.0,
        timeout_seconds: float | None = None,
    ) -> RunStatusResponse:
        """Synchronous variant of ``wait_run``."""
        _validate_wait_options(poll_interval_seconds, timeout_seconds)
        deadline = time.monotonic() + timeout_seconds if timeout_seconds is not None else None
        while True:
            status = self.get_run_sync(run_id)
            if status.status in _TERMINAL_RUN_STATUSES:
                return status
            sleep_for = _next_sleep_seconds(poll_interval_seconds, deadline)
            if sleep_for is None:
                raise DifyAgentTimeoutError(f"run {run_id!r} did not finish before timeout")
            _sleep_sync(sleep_for)

    async def _stream_events_once(self, run_id: str, *, after: str) -> AsyncIterator[RunEvent]:
        """Open one SSE connection and yield events until it ends or fails."""
        try:
            async with self._get_async_http_client().stream(
                "GET",
                self._url(f"/runs/{quote(run_id, safe='')}/events/sse"),
                params={"after": after},
                headers=self._merged_headers(),
                timeout=self._stream_timeout,
            ) as response:
                if response.status_code >= 400:
                    _ = await response.aread()
                _raise_for_stream_status(response)
                decoder = _SSEDecoder()
                async for line in response.aiter_lines():
                    event = decoder.feed_line(line)
                    if event is not None:
                        yield event
        except DifyAgentHTTPError:
            raise
        except DifyAgentStreamError:
            raise
        except httpx.TimeoutException as exc:
            raise _ReconnectableStreamError(DifyAgentTimeoutError("SSE stream timed out")) from exc
        except httpx.TransportError as exc:
            raise _ReconnectableStreamError(DifyAgentStreamError(f"SSE stream failed: {exc}")) from exc
        except httpx.StreamError as exc:
            raise _ReconnectableStreamError(DifyAgentStreamError(f"SSE stream failed: {exc}")) from exc

    def _stream_events_once_sync(self, run_id: str, *, after: str) -> Iterator[RunEvent]:
        """Open one synchronous SSE connection and yield events until it ends or fails."""
        try:
            with self._get_sync_http_client().stream(
                "GET",
                self._url(f"/runs/{quote(run_id, safe='')}/events/sse"),
                params={"after": after},
                headers=self._merged_headers(),
                timeout=self._stream_timeout,
            ) as response:
                if response.status_code >= 400:
                    _ = response.read()
                _raise_for_stream_status(response)
                decoder = _SSEDecoder()
                for line in response.iter_lines():
                    event = decoder.feed_line(line)
                    if event is not None:
                        yield event
        except DifyAgentHTTPError:
            raise
        except DifyAgentStreamError:
            raise
        except httpx.TimeoutException as exc:
            raise _ReconnectableStreamError(DifyAgentTimeoutError("SSE stream timed out")) from exc
        except httpx.TransportError as exc:
            raise _ReconnectableStreamError(DifyAgentStreamError(f"SSE stream failed: {exc}")) from exc
        except httpx.StreamError as exc:
            raise _ReconnectableStreamError(DifyAgentStreamError(f"SSE stream failed: {exc}")) from exc

    def _get_sync_http_client(self) -> httpx.Client:
        """Return an open sync HTTPX client, creating an owned one lazily."""
        if self._sync_closed:
            raise DifyAgentClientError("sync client is closed")
        if self._sync_http_client is None:
            self._sync_http_client = httpx.Client(timeout=self._timeout, headers=self._headers)
        return self._sync_http_client

    def _get_async_http_client(self) -> httpx.AsyncClient:
        """Return an open async HTTPX client, creating an owned one lazily."""
        if self._async_closed:
            raise DifyAgentClientError("async client is closed")
        if self._async_http_client is None:
            self._async_http_client = httpx.AsyncClient(timeout=self._timeout, headers=self._headers)
        return self._async_http_client

    def _url(self, path: str) -> str:
        """Build an absolute URL from the configured base and API path."""
        return f"{self._base_url}{path}"

    def _merged_headers(self, extra: dict[str, str] | None = None) -> dict[str, str]:
        """Return per-request headers without mutating client defaults."""
        headers = dict(self._headers)
        if extra is not None:
            headers.update(extra)
        return headers


def _validate_create_run_request(request: CreateRunRequest) -> CreateRunRequest:
    """Reject raw payloads so create-run uses the public request DTO boundary."""
    if isinstance(request, CreateRunRequest):
        return request
    raise DifyAgentValidationError(detail="request must be a CreateRunRequest")


def _parse_model_response(response: httpx.Response, model_type: type[_ResponseModelT]) -> _ResponseModelT:
    """Map HTTP errors and parse a Pydantic response DTO."""
    _raise_for_status(response)
    try:
        return model_type.model_validate_json(response.content)
    except ValidationError as exc:
        raise DifyAgentValidationError(
            detail=exc.errors(include_url=False),
            status_code=response.status_code,
        ) from exc


def _raise_for_status(response: httpx.Response) -> None:
    """Raise the configured client exception for HTTP 4xx/5xx responses."""
    if response.status_code < 400:
        return
    detail = _extract_error_detail(response)
    if response.status_code == 404:
        raise DifyAgentNotFoundError(status_code=response.status_code, detail=detail)
    if response.status_code == 422:
        raise DifyAgentValidationError(status_code=response.status_code, detail=detail)
    raise DifyAgentHTTPError(status_code=response.status_code, detail=detail)


def _raise_for_stream_status(response: httpx.Response) -> None:
    """Raise terminal 4xx errors or wrap retryable SSE 5xx responses."""
    try:
        _raise_for_status(response)
    except DifyAgentHTTPError as exc:
        if response.status_code >= 500:
            raise _ReconnectableStreamError(
                DifyAgentStreamError(f"SSE stream HTTP {response.status_code}: {exc.detail}")
            ) from exc
        raise


def _extract_error_detail(response: httpx.Response) -> object:
    """Extract FastAPI's ``detail`` field when present, falling back to text."""
    try:
        payload = cast(object, response.json())
    except (ValueError, httpx.ResponseNotRead):
        return response.text or response.reason_phrase
    if isinstance(payload, dict) and "detail" in payload:
        return cast(object, payload["detail"])
    return cast(object, payload)


def _next_reconnect_attempt(
    reconnect_attempts: int,
    *,
    max_reconnects: int | None,
    error: DifyAgentClientError,
) -> int:
    """Increment reconnect attempts or raise when the configured budget is spent."""
    if max_reconnects is not None and reconnect_attempts >= max_reconnects:
        raise DifyAgentStreamError("SSE stream reconnect attempts exhausted") from error
    return reconnect_attempts + 1


def _validate_stream_options(max_reconnects: int | None, reconnect_delay_seconds: float) -> None:
    """Reject stream options that cannot produce deterministic reconnect behavior."""
    if max_reconnects is not None and max_reconnects < 0:
        raise DifyAgentValidationError(detail="max_reconnects must be non-negative")
    if reconnect_delay_seconds < 0:
        raise DifyAgentValidationError(detail="reconnect_delay_seconds must be non-negative")


def _validate_wait_options(poll_interval_seconds: float, timeout_seconds: float | None) -> None:
    """Reject wait options that would make polling ambiguous."""
    if poll_interval_seconds < 0:
        raise DifyAgentValidationError(detail="poll_interval_seconds must be non-negative")
    if timeout_seconds is not None and timeout_seconds < 0:
        raise DifyAgentValidationError(detail="timeout_seconds must be non-negative")


def _next_sleep_seconds(poll_interval_seconds: float, deadline: float | None) -> float | None:
    """Return the next polling sleep duration, or ``None`` when timed out."""
    if deadline is None:
        return poll_interval_seconds
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        return None
    return min(poll_interval_seconds, remaining)


async def _sleep_async(seconds: float) -> None:
    """Sleep asynchronously, skipping the call for zero-second test delays."""
    if seconds > 0:
        await asyncio.sleep(seconds)


def _sleep_sync(seconds: float) -> None:
    """Sleep synchronously, skipping the call for zero-second test delays."""
    if seconds > 0:
        time.sleep(seconds)


__all__ = [
    "Client",
    "DifyAgentClientError",
    "DifyAgentHTTPError",
    "DifyAgentNotFoundError",
    "DifyAgentStreamError",
    "DifyAgentTimeoutError",
    "DifyAgentValidationError",
]
