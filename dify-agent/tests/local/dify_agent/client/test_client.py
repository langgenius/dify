from __future__ import annotations

import asyncio
import inspect
import json
import math
import socket
from collections import deque
from collections.abc import AsyncIterator, Buffer, Callable, Iterable, Iterator
from contextlib import aclosing, closing
from datetime import UTC, datetime
from threading import BoundedSemaphore, Event, Thread
from time import monotonic, sleep
from typing import cast, override

import httpcore
import httpx
import pytest

from dify_agent.protocol.snapshot import SessionSnapshot
from dify_agent.layers.execution_context import DifyExecutionContextLayerConfig
from dify_agent.client import _client as client_module
from dify_agent.client import _http_deadline as http_deadline
from dify_agent.client import (
    Client,
    DifyAgentClientError,
    DifyAgentHTTPError,
    DifyAgentNotFoundError,
    DifyAgentStreamError,
    DifyAgentTimeoutError,
    DifyAgentValidationError,
)
from dify_agent.client._http_deadline import SocketOption
from dify_agent.protocol import (
    BindingFileDownloadRequest,
    BindingFileDownloadResponse,
    BindingFileListResponse,
    BindingFileReadResponse,
    CancelRunRequest,
    CancelRunResponse,
    CreateExecutionBindingRequest,
    CreateHomeSnapshotFromBindingRequest,
    CreateRunRequest,
    DestroyExecutionBindingRequest,
    RUN_EVENT_ADAPTER,
    RunCancelledEvent,
    RunCancelledEventData,
    RunEvent,
    RunEventsResponse,
    RunFailedEvent,
    RunFailedEventData,
    RunStartedEvent,
    RunStatusResponse,
    RunSucceededEvent,
    RunSucceededEventData,
)


def _create_run_payload() -> dict[str, object]:
    return {
        "composition": {
            "schema_version": 2,
            "layers": [{"name": "prompt", "config": {"user": "hello"}}],
        }
    }


def _event_frame(event: RunEvent, *, event_id: str | None = None, exclude_id: bool = False) -> str:
    payload = RUN_EVENT_ADAPTER.dump_json(event, exclude={"id"} if exclude_id else None).decode()
    lines: list[str] = []
    if event_id is not None:
        lines.append(f"id: {event_id}")
    lines.append(f"data: {payload}")
    return "\n".join(lines) + "\n\n"


def _run_succeeded_event(*, event_id: str = "2-0", run_id: str = "run-1") -> RunSucceededEvent:
    return RunSucceededEvent(
        id=event_id,
        run_id=run_id,
        data=RunSucceededEventData(output="done", session_snapshot=SessionSnapshot(layers={})),
    )


def _run_failed_event(error: str, *, event_id: str = "2-0", run_id: str = "run-1") -> RunFailedEvent:
    return RunFailedEvent(
        id=event_id,
        run_id=run_id,
        data=RunFailedEventData(error=error),
    )


def _run_status_json(status: str) -> dict[str, object]:
    now = datetime(2026, 5, 11, tzinfo=UTC).isoformat()
    return {"run_id": "run-1", "status": status, "created_at": now, "updated_at": now, "error": None}


def _binding_file_download_request(path: str = "report.txt") -> BindingFileDownloadRequest:
    return BindingFileDownloadRequest(
        backend_binding_ref="binding-ref",
        path=path,
        execution_context=DifyExecutionContextLayerConfig(
            tenant_id="tenant-1",
            user_id="account-1",
            user_from="account",
            agent_mode="agent_app",
            invoke_from="debugger",
        ),
    )


def _assert_binding_download_timeout(request: httpx.Request, expected: float = 240.0) -> None:
    timeout = cast(dict[str, float], request.extensions["timeout"])
    assert timeout == {"connect": expected, "read": expected, "write": expected, "pool": expected}


def _function_tool_result_payload(key: str) -> dict[str, object]:
    return {
        "type": "pydantic_ai_event",
        "run_id": "run-1",
        "created_at": datetime(2026, 5, 11, tzinfo=UTC).isoformat(),
        "data": {
            "event_kind": "function_tool_result",
            key: {
                "tool_name": "shell_run",
                "content": "ok",
                "tool_call_id": "call-1",
                "part_kind": "tool-return",
            },
        },
    }


class DisconnectingSyncStream(httpx.SyncByteStream):
    chunks: list[bytes]

    def __init__(self, *chunks: str) -> None:
        self.chunks = [chunk.encode() for chunk in chunks]

    @override
    def __iter__(self) -> Iterator[bytes]:
        yield from self.chunks
        raise httpx.ReadError("stream disconnected")


class DisconnectingAsyncStream(httpx.AsyncByteStream):
    chunks: list[bytes]

    def __init__(self, *chunks: str) -> None:
        self.chunks = [chunk.encode() for chunk in chunks]
        self.closed = False

    @override
    async def aclose(self) -> None:
        self.closed = True

    @override
    async def __aiter__(self) -> AsyncIterator[bytes]:
        for chunk in self.chunks:
            yield chunk
        raise httpx.ReadError("stream disconnected")


class TrackingSyncStream(httpx.SyncByteStream):
    def __init__(
        self,
        *chunks: str,
        close_error: httpx.HTTPError | None = None,
        on_chunk: Callable[[], None] | None = None,
    ) -> None:
        self.chunks = [chunk.encode() for chunk in chunks]
        self.closed = False
        self.close_error = close_error
        self.on_chunk = on_chunk

    @override
    def close(self) -> None:
        self.closed = True
        if self.close_error is not None:
            raise self.close_error

    @override
    def __iter__(self) -> Iterator[bytes]:
        for chunk in self.chunks:
            if self.on_chunk is not None:
                self.on_chunk()
            yield chunk


class OpenSyncStream(TrackingSyncStream):
    """Keep the synchronous response open until the client closes it, rejecting further reads."""

    @override
    def __iter__(self) -> Iterator[bytes]:
        yield from super().__iter__()
        raise AssertionError("stream was read past expected frames before close")


class TrackingAsyncStream(httpx.AsyncByteStream):
    def __init__(
        self,
        *chunks: str,
        close_error: httpx.HTTPError | None = None,
        on_chunk: Callable[[], None] | None = None,
    ) -> None:
        self.chunks = [chunk.encode() for chunk in chunks]
        self.closed = False
        self.close_error = close_error
        self.on_chunk = on_chunk

    @override
    async def aclose(self) -> None:
        self.closed = True
        if self.close_error is not None:
            raise self.close_error

    @override
    async def __aiter__(self) -> AsyncIterator[bytes]:
        for chunk in self.chunks:
            if self.on_chunk is not None:
                self.on_chunk()
            yield chunk


class OpenAsyncStream(TrackingAsyncStream):
    """Keep the response open until the client closes it, rejecting further reads."""

    @override
    async def __aiter__(self) -> AsyncIterator[bytes]:
        async for chunk in super().__aiter__():
            yield chunk
        raise AssertionError("stream was read past expected frames before close")


class ScriptedSSEStream(httpx.SyncByteStream, httpx.AsyncByteStream):
    """Run the same deterministic read script in either HTTPX client."""

    def __init__(self, chunks: Iterator[bytes], *, on_close: Callable[[], None] | None = None) -> None:
        self.chunks = chunks
        self.on_close = on_close
        self.closed = False

    @override
    def __iter__(self) -> Iterator[bytes]:
        yield from self.chunks

    @override
    async def __aiter__(self) -> AsyncIterator[bytes]:
        for chunk in self.chunks:
            yield chunk

    @override
    def close(self) -> None:
        self.closed = True
        if self.on_close is not None:
            self.on_close()

    @override
    async def aclose(self) -> None:
        self.close()


class DeadlineClock:
    def __init__(self) -> None:
        self.now = 0.0

    def monotonic(self) -> float:
        return self.now


@pytest.fixture
def deadline_clock(monkeypatch: pytest.MonkeyPatch) -> DeadlineClock:
    clock = DeadlineClock()
    monkeypatch.setattr(client_module, "time", clock)

    def unexpected_backoff(_seconds: float) -> None:
        pytest.fail("An expired deadline must not back off")

    monkeypatch.setattr(client_module, "_sleep_sync", unexpected_backoff)
    monkeypatch.setattr(client_module, "_sleep_async", unexpected_backoff)
    return clock


class ScriptedNetwork:
    """Drive socket operations and a monotonic clock through httpcore's own HTTP/1.1 pipeline."""

    def __init__(
        self,
        clock: DeadlineClock,
        reads: list[tuple[float | None, bytes]],
        *,
        connect_seconds: float = 0.0,
        write_seconds: float = 0.0,
    ) -> None:
        self.clock = clock
        self.reads = deque(reads)
        self.connect_seconds = connect_seconds
        self.write_seconds = write_seconds
        self.calls: list[tuple[str, float | None]] = []
        self.requests: list[bytes] = []

    def _spend(self, phase: str, elapsed: float | None, timeout: float | None, timeout_error: type[Exception]) -> None:
        self.calls.append((phase, timeout))
        if elapsed is None or (timeout is not None and elapsed > timeout):
            assert timeout is not None, f"{phase} would block without a timeout"
            assert type(timeout) is float
            self.clock.now += timeout
            raise timeout_error(f"timed out during {phase}")
        self.clock.now += elapsed

    def connect(self, timeout: float | None) -> None:
        self._spend("connect", self.connect_seconds, timeout, httpcore.ConnectTimeout)

    def write(self, buffer: bytes, timeout: float | None) -> None:
        if buffer.startswith((b"GET ", b"POST ")):
            self.requests.append(buffer.split(b"\r\n", 1)[0])
            self._spend("request headers", self.write_seconds, timeout, httpcore.WriteTimeout)

    def read(self, timeout: float | None) -> bytes:
        assert self.reads, "Unexpected extra socket read"
        elapsed, data = self.reads.popleft()
        self._spend("read", elapsed, timeout, httpcore.ReadTimeout)
        return data


class ScriptedSyncSocket(httpcore.NetworkStream):
    def __init__(self, script: ScriptedNetwork) -> None:
        self.script = script

    @override
    def read(self, max_bytes: int, timeout: float | None = None) -> bytes:
        return self.script.read(timeout)

    @override
    def write(self, buffer: bytes, timeout: float | None = None) -> None:
        self.script.write(buffer, timeout)

    @override
    def close(self) -> None:
        pass


class ScriptedAsyncSocket(httpcore.AsyncNetworkStream):
    def __init__(self, script: ScriptedNetwork) -> None:
        self.script = script

    @override
    async def read(self, max_bytes: int, timeout: float | None = None) -> bytes:
        return self.script.read(timeout)

    @override
    async def write(self, buffer: bytes, timeout: float | None = None) -> None:
        self.script.write(buffer, timeout)

    @override
    async def aclose(self) -> None:
        pass


class ScriptedSyncBackend(httpcore.NetworkBackend):
    def __init__(self, script: ScriptedNetwork) -> None:
        self.script = script

    @override
    def connect_tcp(
        self,
        host: str,
        port: int,
        timeout: float | None = None,
        local_address: str | None = None,
        socket_options: Iterable[SocketOption] | None = None,
    ) -> httpcore.NetworkStream:
        self.script.connect(timeout)
        return ScriptedSyncSocket(self.script)


class ScriptedAsyncBackend(httpcore.AsyncNetworkBackend):
    def __init__(self, script: ScriptedNetwork) -> None:
        self.script = script

    @override
    async def connect_tcp(
        self,
        host: str,
        port: int,
        timeout: float | None = None,
        local_address: str | None = None,
        socket_options: Iterable[SocketOption] | None = None,
    ) -> httpcore.AsyncNetworkStream:
        self.script.connect(timeout)
        return ScriptedAsyncSocket(self.script)


def _core_sync_transport(script: ScriptedNetwork) -> httpx.HTTPTransport:
    transport = httpx.HTTPTransport()
    transport._pool = httpcore.ConnectionPool(network_backend=ScriptedSyncBackend(script))
    return transport


def _core_async_transport(script: ScriptedNetwork) -> httpx.AsyncHTTPTransport:
    transport = httpx.AsyncHTTPTransport()
    transport._pool = httpcore.AsyncConnectionPool(network_backend=ScriptedAsyncBackend(script))
    return transport


def _response_headers(body_size: int) -> bytes:
    return f"HTTP/1.1 200 OK\r\nContent-Length: {body_size}\r\n\r\n".encode()


def test_sse_decoder_accepts_function_tool_result_part_alias(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(client_module, "_function_tool_result_payload_key_cache", "part")
    decoder = client_module._SSEDecoder()
    payload = _function_tool_result_payload("result")

    assert decoder.feed_line(f"data: {json.dumps(payload)}") is None
    event = decoder.feed_line("")

    assert event is not None
    assert event.type == "pydantic_ai_event"
    assert event.data.event_kind == "function_tool_result"
    assert event.data.part.tool_name == "shell_run"


def test_function_tool_result_payload_normalization_supports_old_part_schema(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(client_module, "_function_tool_result_payload_key_cache", "part")
    payload = _function_tool_result_payload("result")

    normalized = client_module._normalize_run_event_payload_for_local_pydantic_ai(payload)

    assert normalized["data"]["part"]["tool_name"] == "shell_run"
    assert "result" not in normalized["data"]


def test_sync_methods_parse_protocol_dtos_and_send_create_request_dto() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "POST" and request.url.path == "/runs":
            payload = cast(dict[str, object], json.loads(request.content))
            composition = cast(dict[str, object], payload["composition"])
            layers = cast(list[dict[str, object]], composition["layers"])
            assert layers[0]["config"] == {"user": "hello"}
            assert "compositor" not in payload
            assert "agent_profile" not in payload
            return httpx.Response(202, json={"run_id": "run-1", "status": "running"})
        if request.method == "GET" and request.url.path == "/runs/run-1":
            return httpx.Response(200, json=_run_status_json("running"))
        if request.method == "GET" and request.url.path == "/runs/run-1/events":
            assert request.url.params["after"] == "0-0"
            assert request.url.params["limit"] == "10"
            event = RunStartedEvent(id="1-0", run_id="run-1")
            return httpx.Response(
                200,
                json={
                    "run_id": "run-1",
                    "events": [cast(object, json.loads(RUN_EVENT_ADAPTER.dump_json(event)))],
                    "next_cursor": "1-0",
                },
            )
        if request.method == "POST" and request.url.path == "/runs/run-1/cancel":
            payload = cast(dict[str, object], json.loads(request.content))
            assert payload == {"reason": "user_cancelled", "message": None}
            return httpx.Response(202, json={"run_id": "run-1", "status": "cancelled"})
        raise AssertionError(f"unexpected request: {request.method} {request.url}")

    http_client = httpx.Client(transport=httpx.MockTransport(handler))
    client = Client(base_url="http://testserver", sync_http_client=http_client)

    created = client.create_run_sync(CreateRunRequest.model_validate(_create_run_payload()))
    status = client.get_run_sync(created.run_id)
    events = client.get_events_sync(created.run_id, after="0-0", limit=10)
    cancelled = client.cancel_run_sync(created.run_id, CancelRunRequest(reason="user_cancelled"))

    assert created.status == "running"
    assert status.status == "running"
    assert isinstance(events, RunEventsResponse)
    assert [event.type for event in events.events] == ["run_started"]
    assert isinstance(cancelled, CancelRunResponse)
    assert cancelled.status == "cancelled"


def test_async_methods_and_wait_run_parse_protocol_dtos() -> None:
    statuses = iter(["running", "succeeded"])

    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "POST" and request.url.path == "/runs":
            return httpx.Response(202, json={"run_id": "run-1", "status": "running"})
        if request.method == "GET" and request.url.path == "/runs/run-1":
            return httpx.Response(200, json=_run_status_json(next(statuses)))
        if request.method == "GET" and request.url.path == "/runs/run-1/events":
            return httpx.Response(200, json={"run_id": "run-1", "events": [], "next_cursor": "0-0"})
        raise AssertionError(f"unexpected request: {request.method} {request.url}")

    async def scenario() -> None:
        http_client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        client = Client(base_url="http://testserver", async_http_client=http_client)
        request = CreateRunRequest.model_validate(_create_run_payload())

        created = await client.create_run(request)
        events = await client.get_events(created.run_id)
        terminal = await client.wait_run(created.run_id, poll_interval_seconds=0)

        assert created.run_id == "run-1"
        assert events.events == []
        assert terminal.status == "succeeded"
        await http_client.aclose()

    asyncio.run(scenario())


@pytest.mark.parametrize("sync", [False, True], ids=["async", "sync"])
def test_wait_run_does_not_poll_after_its_deadline(monkeypatch: pytest.MonkeyPatch, sync: bool) -> None:
    class PollingClock:
        def __init__(self) -> None:
            self.now = 0.0

        def monotonic(self) -> float:
            return self.now

        def sleep(self, seconds: float) -> None:
            self.now += seconds

        async def sleep_async(self, seconds: float) -> None:
            self.sleep(seconds)

    clock = PollingClock()
    request_count = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal request_count
        assert request.method == "GET"
        assert request.url.path == "/runs/run-1"
        request_count += 1
        return httpx.Response(200, json=_run_status_json("running" if request_count == 1 else "succeeded"))

    monkeypatch.setattr(client_module, "time", clock)
    monkeypatch.setattr(client_module, "_sleep_sync", clock.sleep)
    monkeypatch.setattr(client_module, "_sleep_async", clock.sleep_async)
    transport = httpx.MockTransport(handler)

    async def scenario() -> None:
        async with httpx.AsyncClient(transport=transport) as http_client:
            client = Client(base_url="http://testserver", async_http_client=http_client)
            await client.wait_run("run-1", poll_interval_seconds=2, timeout_seconds=1)

    with pytest.raises(DifyAgentTimeoutError, match="did not finish before timeout"):
        if sync:
            with httpx.Client(transport=transport) as http_client:
                client = Client(base_url="http://testserver", sync_http_client=http_client)
                client.wait_run_sync("run-1", poll_interval_seconds=2, timeout_seconds=1)
        else:
            asyncio.run(scenario())
    assert request_count == 1
    assert clock.now == 1


@pytest.mark.parametrize("sync", [False, True], ids=["async", "sync"])
def test_wait_run_checks_deadline_after_closing_terminal_status_response(
    deadline_clock: DeadlineClock, sync: bool
) -> None:
    requests: list[tuple[str, str]] = []

    def advance_clock_on_close() -> None:
        deadline_clock.now = 1.25

    body = json.dumps(_run_status_json("succeeded")).encode()
    stream = ScriptedSSEStream(iter([body]), on_close=advance_clock_on_close)

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append((request.method, request.url.path))
        return httpx.Response(200, stream=stream, headers={"content-type": "application/json"})

    transport = httpx.MockTransport(handler)

    async def wait_async() -> RunStatusResponse:
        async with httpx.AsyncClient(transport=transport) as http_client:
            client = Client(base_url="http://testserver", async_http_client=http_client)
            return await client.wait_run("run-1", timeout_seconds=1)

    with pytest.raises(DifyAgentTimeoutError, match="did not finish before timeout"):
        if sync:
            with httpx.Client(transport=transport) as http_client:
                client = Client(base_url="http://testserver", sync_http_client=http_client)
                _ = client.wait_run_sync("run-1", timeout_seconds=1)
        else:
            _ = asyncio.run(wait_async())

    assert requests == [("GET", "/runs/run-1")]
    assert stream.closed
    assert deadline_clock.now == 1.25


@pytest.mark.parametrize("sync", [False, True], ids=["async", "sync"])
@pytest.mark.parametrize(
    ("timeout_seconds", "status"),
    [(0.0, "succeeded"), (0.0, "running"), (math.inf, "succeeded")],
    ids=["zero-succeeded", "zero-running", "infinite"],
)
def test_wait_run_uses_configured_timeouts_for_zero_and_infinite_budgets(
    deadline_clock: DeadlineClock, sync: bool, timeout_seconds: float, status: str
) -> None:
    requests: list[httpx.Request] = []
    request_timeout = httpx.Timeout(7.5, connect=3.0)

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.extensions["timeout"] == request_timeout.as_dict()
        requests.append(request)
        deadline_clock.now += 0.25
        return httpx.Response(200, json=_run_status_json(status))

    transport = httpx.MockTransport(handler)

    async def wait_async() -> RunStatusResponse:
        async with httpx.AsyncClient(transport=transport) as http_client:
            client = Client(base_url="http://testserver", timeout=request_timeout, async_http_client=http_client)
            return await client.wait_run("run-1", timeout_seconds=timeout_seconds)

    def wait() -> RunStatusResponse:
        if sync:
            with httpx.Client(transport=transport) as http_client:
                client = Client(base_url="http://testserver", timeout=request_timeout, sync_http_client=http_client)
                return client.wait_run_sync("run-1", timeout_seconds=timeout_seconds)
        return asyncio.run(wait_async())

    if status == "succeeded":
        assert wait().status == "succeeded"
    else:
        with pytest.raises(DifyAgentTimeoutError, match="did not finish before timeout"):
            wait()

    assert [(request.method, request.url.path) for request in requests] == [("GET", "/runs/run-1")]
    assert deadline_clock.now == 0.25


@pytest.mark.parametrize("invalid", [-1.0, -math.inf, math.nan], ids=["negative", "negative-infinity", "nan"])
def test_wait_and_stream_reject_invalid_timing_options(invalid: float) -> None:
    def unexpected_request(_request: httpx.Request) -> httpx.Response:
        pytest.fail("Invalid timing options must fail before opening the request")

    with httpx.Client(transport=httpx.MockTransport(unexpected_request)) as http_client:
        client = Client(base_url="http://testserver", sync_http_client=http_client)
        with pytest.raises(DifyAgentValidationError, match="timeout_seconds must be non-negative"):
            client.wait_run_sync("run-1", timeout_seconds=invalid)
        with pytest.raises(DifyAgentValidationError, match="poll_interval_seconds must be non-negative"):
            client.wait_run_sync("run-1", poll_interval_seconds=invalid)
        with pytest.raises(DifyAgentValidationError, match="reconnect_delay_seconds must be non-negative"):
            list(client.stream_events_sync("run-1", reconnect_delay_seconds=invalid))


def test_cancel_run_and_wait_sync_resumes_after_cursor_and_returns_cancelled_snapshot() -> None:
    snapshot = SessionSnapshot(layers={})

    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "POST":
            return httpx.Response(202, json={"run_id": "run-1", "status": "cancelled"})
        if request.url.path == "/runs/run-1":
            return httpx.Response(
                200,
                json={
                    "run_id": "run-1",
                    "status": "running",
                    "created_at": "2026-08-17T00:00:00Z",
                    "updated_at": "2026-08-17T00:00:00Z",
                },
            )
        assert request.url.params["after"] == "3-0"
        event = RunCancelledEvent(
            id="4-0",
            run_id="run-1",
            data=RunCancelledEventData(reason="stopped", session_snapshot=snapshot),
        )
        return httpx.Response(200, content=_event_frame(event))

    client = Client(
        base_url="http://testserver",
        sync_http_client=httpx.Client(transport=httpx.MockTransport(handler)),
    )

    event = client.cancel_run_and_wait_sync(
        "run-1",
        CancelRunRequest(reason="stopped"),
        after="3-0",
    )

    assert event.data.session_snapshot == snapshot


def test_cancel_run_and_wait_sync_replays_when_cursor_already_points_to_cancelled_event() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "POST":
            return httpx.Response(202, json={"run_id": "run-1", "status": "cancelled"})
        if request.url.path == "/runs/run-1":
            return httpx.Response(
                200,
                json={
                    "run_id": "run-1",
                    "status": "cancelled",
                    "created_at": "2026-08-17T00:00:00Z",
                    "updated_at": "2026-08-17T00:00:01Z",
                },
            )
        assert request.url.params["after"] == "0-0"
        return httpx.Response(200, content=_event_frame(RunCancelledEvent(id="4-0", run_id="run-1")))

    client = Client(
        base_url="http://testserver",
        sync_http_client=httpx.Client(transport=httpx.MockTransport(handler)),
    )

    event = client.cancel_run_and_wait_sync("run-1", after="4-0")

    assert event.id == "4-0"


@pytest.mark.parametrize("sync", [False, True], ids=["async", "sync"])
def test_cancel_run_and_wait_shares_one_deadline_across_cancel_status_and_events(
    deadline_clock: DeadlineClock, sync: bool
) -> None:
    seen: list[tuple[str, dict[str, float]]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        timeouts = dict(request.extensions["timeout"])
        seen.append((path, timeouts))
        if path == "/runs/run-1/cancel":
            deadline_clock.now += 1.0
            return httpx.Response(202, json={"run_id": "run-1", "status": "cancelled"})
        if path == "/runs/run-1":
            deadline_clock.now += 2.0
            return httpx.Response(200, json=_run_status_json("running"))
        assert path == "/runs/run-1/events/sse"
        assert request.url.params["after"] == "3-0"
        deadline_clock.now += timeouts["read"]
        raise httpx.ReadTimeout("cancellation confirmation stalled", request=request)

    transport = httpx.MockTransport(handler)
    request_timeout = httpx.Timeout(30.0, connect=3.0)

    async def scenario() -> None:
        async with httpx.AsyncClient(transport=transport) as http_client:
            client = Client(
                base_url="http://testserver",
                timeout=request_timeout,
                stream_timeout=None,
                async_http_client=http_client,
            )
            await client.cancel_run_and_wait("run-1", after="3-0", timeout_seconds=5.0)

    with pytest.raises(DifyAgentTimeoutError, match="exceeded its timeout"):
        if sync:
            with httpx.Client(transport=transport) as http_client:
                client = Client(
                    base_url="http://testserver",
                    timeout=request_timeout,
                    stream_timeout=None,
                    sync_http_client=http_client,
                )
                client.cancel_run_and_wait_sync("run-1", after="3-0", timeout_seconds=5.0)
        else:
            asyncio.run(scenario())

    assert seen == [
        ("/runs/run-1/cancel", {"connect": 3.0, "read": 5.0, "write": 5.0, "pool": 5.0}),
        ("/runs/run-1", {"connect": 3.0, "read": 4.0, "write": 4.0, "pool": 4.0}),
        ("/runs/run-1/events/sse", {"connect": 2.0, "read": 2.0, "write": 2.0, "pool": 2.0}),
    ]
    assert deadline_clock.now == 5.0


def test_cancel_run_and_wait_async_returns_cancelled_terminal() -> None:
    stream = OpenAsyncStream(_event_frame(RunCancelledEvent(id="2-0", run_id="run-1")))

    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "POST":
            return httpx.Response(202, json={"run_id": "run-1", "status": "cancelled"})
        if request.url.path == "/runs/run-1":
            return httpx.Response(200, json=_run_status_json("running"))
        assert request.url.params["after"] == "1-0"
        return httpx.Response(200, stream=stream)

    async def scenario() -> None:
        http_client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        client = Client(base_url="http://testserver", async_http_client=http_client)
        event = await client.cancel_run_and_wait("run-1", after="1-0")
        assert event.type == "run_cancelled"
        assert stream.closed
        await http_client.aclose()

    asyncio.run(scenario())


@pytest.mark.parametrize("terminal_event", [_run_succeeded_event(), _run_failed_event("failed")])
def test_cancel_run_and_wait_async_closes_response_on_unexpected_terminal(terminal_event: RunEvent) -> None:
    stream = OpenAsyncStream(_event_frame(terminal_event))

    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "POST":
            return httpx.Response(202, json={"run_id": "run-1", "status": "cancelled"})
        return httpx.Response(200, stream=stream)

    async def scenario() -> None:
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http_client:
            client = Client(base_url="http://testserver", async_http_client=http_client)
            with pytest.raises(DifyAgentClientError, match="before cancellation"):
                await client.cancel_run_and_wait("run-1")
            assert stream.closed

    asyncio.run(scenario())


@pytest.mark.parametrize("close_error", [None, httpx.ReadError])
def test_cancel_run_and_wait_async_closes_response_when_cancelled(close_error: type[httpx.HTTPError] | None) -> None:
    async def scenario() -> None:
        waiting = asyncio.Event()

        class WaitingAsyncStream(TrackingAsyncStream):
            @override
            async def __aiter__(self) -> AsyncIterator[bytes]:
                for chunk in self.chunks:
                    yield chunk
                waiting.set()
                await asyncio.Event().wait()

        stream = WaitingAsyncStream(
            _event_frame(RunStartedEvent(id="1-0", run_id="run-1")),
            close_error=close_error("response close failed") if close_error is not None else None,
        )
        calls = 0

        def handler(request: httpx.Request) -> httpx.Response:
            nonlocal calls
            if request.method == "POST":
                return httpx.Response(202, json={"run_id": "run-1", "status": "cancelled"})
            calls += 1
            assert calls == 1, "task cancellation must not reconnect the SSE stream"
            return httpx.Response(200, stream=stream)

        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http_client:
            client = Client(base_url="http://testserver", async_http_client=http_client)
            task = asyncio.create_task(client.cancel_run_and_wait("run-1"))
            await asyncio.wait_for(waiting.wait(), timeout=1)
            assert not stream.closed
            task.cancel()
            expected_error = asyncio.CancelledError if close_error is None else DifyAgentStreamError
            with pytest.raises(expected_error):
                await task
            assert stream.closed
            assert calls == 1

    asyncio.run(scenario())


def test_cancel_run_and_wait_async_replays_when_cursor_already_points_to_cancelled_event() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "POST":
            return httpx.Response(202, json={"run_id": "run-1", "status": "cancelled"})
        if request.url.path == "/runs/run-1":
            return httpx.Response(200, json=_run_status_json("cancelled"))
        assert request.url.params["after"] == "0-0"
        return httpx.Response(200, content=_event_frame(RunCancelledEvent(id="4-0", run_id="run-1")))

    async def scenario() -> None:
        http_client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        client = Client(base_url="http://testserver", async_http_client=http_client)
        event = await client.cancel_run_and_wait("run-1", after="4-0")
        assert event.id == "4-0"
        await http_client.aclose()

    asyncio.run(scenario())


def test_sync_binding_file_methods_post_dtos_and_parse_responses() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/execution-bindings/files/list":
            payload = cast(dict[str, object], json.loads(request.content))
            assert payload["path"] == "."
            assert payload["backend_binding_ref"] == "binding-ref"
            return httpx.Response(200, json={"path": ".", "entries": [], "truncated": False})
        if request.url.path == "/execution-bindings/files/read":
            payload = cast(dict[str, object], json.loads(request.content))
            assert payload["path"] == "note.txt"
            assert payload["max_bytes"] == 128
            return httpx.Response(
                200, json={"path": "note.txt", "size": 5, "truncated": False, "binary": False, "text": "hello"}
            )
        if request.url.path == "/execution-bindings/files/download":
            _assert_binding_download_timeout(request)
            payload = cast(dict[str, object], json.loads(request.content))
            assert payload["path"] == "report.txt"
            return httpx.Response(
                200,
                json={"reference": "dify-file-ref:file-1"},
            )
        raise AssertionError(f"unexpected request: {request.method} {request.url}")

    client = Client(base_url="http://testserver", sync_http_client=httpx.Client(transport=httpx.MockTransport(handler)))

    listing = client.list_binding_files_sync("binding-ref", ".")
    preview = client.read_binding_file_sync("binding-ref", "note.txt", max_bytes=128)
    downloaded = client.download_binding_file_sync(_binding_file_download_request())

    assert isinstance(listing, BindingFileListResponse)
    assert listing.path == "."
    assert isinstance(preview, BindingFileReadResponse)
    assert preview.text == "hello"
    assert isinstance(downloaded, BindingFileDownloadResponse)
    assert downloaded.reference == "dify-file-ref:file-1"


def test_async_binding_file_methods_post_dtos_and_parse_responses() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/execution-bindings/files/list":
            return httpx.Response(200, json={"path": ".", "entries": [], "truncated": False})
        if request.url.path == "/execution-bindings/files/read":
            payload = cast(dict[str, object], json.loads(request.content))
            assert payload["max_bytes"] == 262144
            return httpx.Response(
                200, json={"path": "note.txt", "size": 5, "truncated": False, "binary": False, "text": "hello"}
            )
        if request.url.path == "/execution-bindings/files/download":
            _assert_binding_download_timeout(request, expected=123.5)
            return httpx.Response(200, json={"reference": "dify-file-ref:file-1"})
        raise AssertionError(f"unexpected request: {request.method} {request.url}")

    async def scenario() -> None:
        http_client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        client = Client(
            base_url="http://testserver",
            binding_file_download_timeout=123.5,
            async_http_client=http_client,
        )

        listing = await client.list_binding_files("binding-ref", ".")
        preview = await client.read_binding_file("binding-ref", "note.txt")
        downloaded = await client.download_binding_file(_binding_file_download_request())

        assert listing.path == "."
        assert preview.text == "hello"
        assert downloaded.reference == "dify-file-ref:file-1"
        await http_client.aclose()

    asyncio.run(scenario())


def test_sync_execution_binding_client_uses_private_binding_routes() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        payload = cast(dict[str, object], json.loads(request.content))
        if request.url.path == "/execution-bindings":
            assert payload["binding_id"] == "binding-1"
            assert payload["home_snapshot_ref"] == "home-ref"
            return httpx.Response(201, json={"binding_ref": "backend-binding", "workspace_ref": "backend-workspace"})
        assert request.url.path == "/execution-bindings/destroy"
        assert payload == {
            "binding_ref": "backend-binding",
            "destroy_workspace": True,
            "workspace_ref": "backend-workspace",
        }
        return httpx.Response(204)

    client = Client(
        base_url="http://testserver",
        sync_http_client=httpx.Client(transport=httpx.MockTransport(handler)),
    )
    allocation = client.create_execution_binding_sync(
        CreateExecutionBindingRequest(
            tenant_id="tenant-1",
            agent_id="agent-1",
            binding_id="binding-1",
            workspace_id="workspace-1",
            existing_workspace_ref=None,
            home_snapshot_ref="home-ref",
        )
    )
    client.destroy_execution_binding_sync(
        DestroyExecutionBindingRequest(
            binding_ref=allocation.binding_ref,
            workspace_ref=allocation.workspace_ref,
            destroy_workspace=True,
        )
    )

    assert allocation.binding_ref == "backend-binding"


def _create_home_snapshot_from_binding_request() -> CreateHomeSnapshotFromBindingRequest:
    return CreateHomeSnapshotFromBindingRequest(
        tenant_id="tenant-1",
        agent_id="agent-1",
        home_snapshot_id="home-2",
        backend_binding_ref="binding-ref",
    )


def test_sync_home_snapshot_client_parses_checkpoint_and_delete() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "POST":
            if request.url.path == "/home-snapshots/from-binding":
                assert json.loads(request.content) == _create_home_snapshot_from_binding_request().model_dump(
                    mode="json"
                )
                return httpx.Response(201, json={"snapshot_ref": "team/home 1"})
            assert request.url.path == "/home-snapshots/delete"
            assert json.loads(request.content) == {"snapshot_ref": "team/home 1"}
            return httpx.Response(204)
        raise AssertionError(request.url)

    http_client = httpx.Client(transport=httpx.MockTransport(handler))
    client = Client(base_url="http://testserver", sync_http_client=http_client)

    created = client.create_home_snapshot_from_binding_sync(_create_home_snapshot_from_binding_request())
    client.delete_home_snapshot_sync(created.snapshot_ref)

    assert created.snapshot_ref == "team/home 1"
    http_client.close()


def test_async_home_snapshot_client_parses_checkpoint_and_delete() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "POST":
            if request.url.path == "/home-snapshots/from-binding":
                return httpx.Response(201, json={"snapshot_ref": "team/home 1"})
            assert request.url.path == "/home-snapshots/delete"
            return httpx.Response(204)
        raise AssertionError(request.url)

    async def scenario() -> None:
        http_client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        client = Client(base_url="http://testserver", async_http_client=http_client)

        created = await client.create_home_snapshot_from_binding(_create_home_snapshot_from_binding_request())
        await client.delete_home_snapshot(created.snapshot_ref)

        assert created.snapshot_ref == "team/home 1"
        await http_client.aclose()

    asyncio.run(scenario())


def test_home_snapshot_client_maps_sync_validation_and_async_http_errors() -> None:
    sync_http_client = httpx.Client(transport=httpx.MockTransport(lambda _request: httpx.Response(200, json={})))
    sync_client = Client(
        base_url="http://testserver",
        sync_http_client=sync_http_client,
    )

    with pytest.raises(DifyAgentValidationError):
        _ = sync_client.create_home_snapshot_from_binding_sync(_create_home_snapshot_from_binding_request())
    sync_http_client.close()

    async def scenario() -> None:
        http_client = httpx.AsyncClient(
            transport=httpx.MockTransport(
                lambda _request: httpx.Response(502, json={"detail": {"code": "backend_failed"}})
            )
        )
        client = Client(base_url="http://testserver", async_http_client=http_client)

        with pytest.raises(DifyAgentHTTPError) as exc_info:
            _ = await client.create_home_snapshot_from_binding(_create_home_snapshot_from_binding_request())
        assert exc_info.value.status_code == 502
        assert exc_info.value.detail == {"code": "backend_failed"}
        await http_client.aclose()

    asyncio.run(scenario())


def test_sync_download_binding_file_rejects_missing_reference() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path != "/execution-bindings/files/download":
            raise AssertionError(f"unexpected request: {request.method} {request.url}")
        return httpx.Response(
            200,
            json={},
        )

    client = Client(base_url="http://testserver", sync_http_client=httpx.Client(transport=httpx.MockTransport(handler)))

    with pytest.raises(DifyAgentValidationError):
        _ = client.download_binding_file_sync(_binding_file_download_request())


def test_sync_binding_file_methods_map_invalid_json_to_validation_error() -> None:
    responses = iter([httpx.Response(200, text="not-json"), httpx.Response(404, json={"detail": "missing"})])

    def handler(_request: httpx.Request) -> httpx.Response:
        return next(responses)

    client = Client(base_url="http://testserver", sync_http_client=httpx.Client(transport=httpx.MockTransport(handler)))

    with pytest.raises(DifyAgentValidationError):
        _ = client.list_binding_files_sync("binding-ref", ".")

    with pytest.raises(DifyAgentHTTPError) as http_error:
        _ = client.read_binding_file_sync("binding-ref", "missing.txt")
    assert http_error.value.status_code == 404


def test_error_mapping_and_create_run_input_validation() -> None:
    responses = iter(
        [
            httpx.Response(404, json={"detail": "run not found"}),
            httpx.Response(422, json={"detail": "invalid"}),
            httpx.Response(500, json={"detail": "boom"}),
        ]
    )

    def handler(_request: httpx.Request) -> httpx.Response:
        return next(responses)

    client = Client(
        base_url="http://testserver",
        sync_http_client=httpx.Client(transport=httpx.MockTransport(handler)),
    )

    with pytest.raises(DifyAgentNotFoundError) as not_found:
        _ = client.get_run_sync("missing")
    assert not_found.value.status_code == 404
    assert not_found.value.detail == "run not found"

    with pytest.raises(DifyAgentValidationError) as validation:
        _ = client.get_run_sync("bad")
    assert validation.value.status_code == 422

    with pytest.raises(DifyAgentHTTPError) as server_error:
        _ = client.get_run_sync("bad")
    assert server_error.value.status_code == 500

    with pytest.raises(DifyAgentValidationError):
        _ = client.create_run_sync({"unknown": "field"})  # pyright: ignore[reportArgumentType]


def test_http_timeout_maps_to_client_timeout_error() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("slow", request=request)

    client = Client(
        base_url="http://testserver",
        sync_http_client=httpx.Client(transport=httpx.MockTransport(handler)),
    )

    with pytest.raises(DifyAgentTimeoutError):
        _ = client.get_run_sync("run-1")


def test_create_run_is_not_retried_after_timeout() -> None:
    attempts = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal attempts
        attempts += 1
        raise httpx.ConnectTimeout("cannot connect", request=request)

    client = Client(
        base_url="http://testserver",
        sync_http_client=httpx.Client(transport=httpx.MockTransport(handler)),
    )

    with pytest.raises(DifyAgentTimeoutError):
        _ = client.create_run_sync(CreateRunRequest.model_validate(_create_run_payload()))
    assert attempts == 1


def test_sync_sse_parser_supports_comments_multiline_data_and_id_fill() -> None:
    payload = RUN_EVENT_ADAPTER.dump_json(RunStartedEvent(run_id="run-1"), exclude={"id"}).decode()
    before_type, after_type = payload.split('"type"', maxsplit=1)
    body = f': keepalive\nid: 5-0\nevent: run_started\ndata: {before_type}\ndata: "type"{after_type}\n\n'

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.params["after"] == "0-0"
        return httpx.Response(200, content=body)

    client = Client(
        base_url="http://testserver",
        sync_http_client=httpx.Client(transport=httpx.MockTransport(handler)),
    )

    events = list(client.stream_events_sync("run-1", until_terminal=False, reconnect=False))

    assert [event.id for event in events] == ["5-0"]
    assert [event.type for event in events] == ["run_started"]


@pytest.mark.parametrize("separator", ["\x85", "\u2028", "\u2029"])
def test_sync_sse_parser_preserves_unicode_line_separators(separator: str) -> None:
    error = f"before{separator}after"
    body = _event_frame(_run_failed_event(error))

    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=body)

    client = Client(
        base_url="http://testserver",
        sync_http_client=httpx.Client(transport=httpx.MockTransport(handler)),
    )

    events = list(client.stream_events_sync("run-1", reconnect=False))

    assert len(events) == 1
    assert isinstance(events[0], RunFailedEvent)
    assert events[0].data.error == error


def test_stream_events_stops_after_terminal_event() -> None:
    calls = 0
    body = "".join(
        [
            _event_frame(RunStartedEvent(id="1-0", run_id="run-1")),
            _event_frame(_run_succeeded_event()),
        ]
    )

    def handler(_request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(200, content=body)

    client = Client(
        base_url="http://testserver",
        sync_http_client=httpx.Client(transport=httpx.MockTransport(handler)),
    )

    events = list(client.stream_events_sync("run-1", reconnect_delay_seconds=0))

    assert [event.type for event in events] == ["run_started", "run_succeeded"]
    assert calls == 1


def test_stream_events_stops_after_cancelled_terminal_event() -> None:
    calls = 0
    body = "".join(
        [
            _event_frame(RunStartedEvent(id="1-0", run_id="run-1")),
            _event_frame(RunCancelledEvent(id="2-0", run_id="run-1")),
        ]
    )

    def handler(_request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(200, content=body)

    client = Client(
        base_url="http://testserver",
        sync_http_client=httpx.Client(transport=httpx.MockTransport(handler)),
    )

    events = list(client.stream_events_sync("run-1", reconnect_delay_seconds=0))

    assert [event.type for event in events] == ["run_started", "run_cancelled"]
    assert calls == 1


def test_stream_events_does_not_reconnect_after_terminal_when_until_terminal_is_false() -> None:
    calls = 0

    def handler(_request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(200, content=_event_frame(_run_succeeded_event()))

    client = Client(
        base_url="http://testserver",
        sync_http_client=httpx.Client(transport=httpx.MockTransport(handler)),
    )

    events = list(client.stream_events_sync("run-1", until_terminal=False, reconnect_delay_seconds=0))

    assert [event.type for event in events] == ["run_succeeded"]
    assert calls == 1


def test_stream_events_does_not_reconnect_after_terminal_transport_error() -> None:
    calls = 0

    def handler(_request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(200, stream=DisconnectingSyncStream(_event_frame(_run_succeeded_event())))

    client = Client(
        base_url="http://testserver",
        sync_http_client=httpx.Client(transport=httpx.MockTransport(handler)),
    )

    events = list(client.stream_events_sync("run-1", until_terminal=False, reconnect_delay_seconds=0))

    assert [event.type for event in events] == ["run_succeeded"]
    assert calls == 1


@pytest.mark.parametrize("sync", [True, False], ids=["sync", "async"])
@pytest.mark.parametrize("timeout_seconds", [10.0, 4.0], ids=["enough-budget", "expires-in-backoff"])
def test_stream_events_reconnects_from_latest_event_id_with_remaining_budget(
    deadline_clock: DeadlineClock, monkeypatch: pytest.MonkeyPatch, sync: bool, timeout_seconds: float
) -> None:
    requests: list[tuple[str, float]] = []
    backoff: list[float] = []

    def sleep(seconds: float) -> None:
        backoff.append(seconds)
        deadline_clock.now += seconds

    async def sleep_async(seconds: float) -> None:
        sleep(seconds)

    monkeypatch.setattr(client_module, "_sleep_sync", sleep)
    monkeypatch.setattr(client_module, "_sleep_async", sleep_async)

    def first_connection() -> Iterator[bytes]:
        deadline_clock.now += 3.0
        yield _event_frame(RunStartedEvent(id="1-0", run_id="run-1")).encode()
        raise httpx.ReadError("stream disconnected")

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append((request.url.params["after"], request.extensions["timeout"]["read"]))
        if len(requests) == 1:
            return httpx.Response(200, stream=ScriptedSSEStream(first_connection()))
        return httpx.Response(200, content=_event_frame(_run_succeeded_event()))

    transport = httpx.MockTransport(handler)

    async def read_async() -> list[RunEvent]:
        async with httpx.AsyncClient(transport=transport) as http_client:
            client = Client(base_url="http://testserver", async_http_client=http_client)
            return [
                event
                async for event in client.stream_events(
                    "run-1", reconnect_delay_seconds=2, timeout_seconds=timeout_seconds
                )
            ]

    def read() -> list[RunEvent]:
        if sync:
            with httpx.Client(transport=transport) as http_client:
                client = Client(base_url="http://testserver", sync_http_client=http_client)
                return list(
                    client.stream_events_sync("run-1", reconnect_delay_seconds=2, timeout_seconds=timeout_seconds)
                )
        return asyncio.run(read_async())

    if timeout_seconds == 4.0:
        with pytest.raises(DifyAgentTimeoutError, match="exceeded its timeout"):
            _ = read()
        assert backoff == [1.0]
        assert deadline_clock.now == 4.0
        assert requests == [("0-0", 4.0)]
    else:
        events = read()
        assert backoff == [2.0]
        assert requests == [("0-0", 10.0), ("1-0", 5.0)]
        assert [event.type for event in events] == ["run_started", "run_succeeded"]


def test_stream_events_reconnects_after_http_5xx_response() -> None:
    seen_after: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen_after.append(request.url.params["after"])
        if len(seen_after) == 1:
            return httpx.Response(503, json={"detail": "temporarily unavailable"})
        return httpx.Response(200, content=_event_frame(_run_succeeded_event()))

    client = Client(
        base_url="http://testserver",
        sync_http_client=httpx.Client(transport=httpx.MockTransport(handler)),
    )

    events = list(client.stream_events_sync("run-1", reconnect_delay_seconds=0))

    assert seen_after == ["0-0", "0-0"]
    assert [event.type for event in events] == ["run_succeeded"]


def test_stream_events_raises_when_reconnects_are_exhausted() -> None:
    calls = 0

    def handler(_request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(200, stream=DisconnectingSyncStream())

    client = Client(
        base_url="http://testserver",
        sync_http_client=httpx.Client(transport=httpx.MockTransport(handler)),
    )

    with pytest.raises(DifyAgentStreamError):
        _ = list(client.stream_events_sync("run-1", max_reconnects=1, reconnect_delay_seconds=0))
    assert calls == 2


def test_stream_events_resets_reconnect_budget_after_each_delivered_event() -> None:
    """A proxy that drops every connection must not fail a run that keeps resuming."""
    seen_after: list[str] = []
    progress_events = 5

    def handler(request: httpx.Request) -> httpx.Response:
        seen_after.append(request.url.params["after"])
        index = len(seen_after)
        if index <= progress_events:
            return httpx.Response(
                200,
                stream=DisconnectingSyncStream(_event_frame(RunStartedEvent(id=f"{index}-0", run_id="run-1"))),
            )
        return httpx.Response(200, content=_event_frame(_run_succeeded_event(event_id=f"{index}-0")))

    client = Client(
        base_url="http://testserver",
        sync_http_client=httpx.Client(transport=httpx.MockTransport(handler)),
    )

    events = list(client.stream_events_sync("run-1", max_reconnects=1, reconnect_delay_seconds=0))

    assert seen_after == ["0-0", "1-0", "2-0", "3-0", "4-0", "5-0"]
    assert [event.type for event in events] == ["run_started"] * progress_events + ["run_succeeded"]


def test_stream_events_still_bounds_consecutive_reconnects_after_progress() -> None:
    """Only a delivered event restores spent retries; comment-only heartbeats do not."""
    seen_after: list[str] = []
    progress_event = RunStartedEvent(id="1-0", run_id="run-1")

    def handler(request: httpx.Request) -> httpx.Response:
        seen_after.append(request.url.params["after"])
        assert len(seen_after) <= 4, "heartbeats must not restore the reconnect budget"
        if len(seen_after) == 2:
            return httpx.Response(
                200,
                stream=DisconnectingSyncStream(_event_frame(progress_event)),
            )
        return httpx.Response(200, stream=DisconnectingSyncStream(": keepalive\n\n"))

    events: list[RunEvent] = []
    with httpx.Client(transport=httpx.MockTransport(handler)) as http_client:
        client = Client(base_url="http://testserver", sync_http_client=http_client)
        with pytest.raises(DifyAgentStreamError, match="^SSE stream reconnect attempts exhausted$"):
            for event in client.stream_events_sync("run-1", max_reconnects=2, reconnect_delay_seconds=0):
                events.append(event)

    assert seen_after == ["0-0", "0-0", "1-0", "1-0"]
    assert events == [progress_event]


def test_stream_events_default_reconnect_budget_is_finite() -> None:
    calls = 0

    def handler(_request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(200, content="")

    client = Client(
        base_url="http://testserver",
        sync_http_client=httpx.Client(transport=httpx.MockTransport(handler)),
    )

    with pytest.raises(DifyAgentStreamError, match="reconnect attempts exhausted"):
        _ = list(client.stream_events_sync("run-1", reconnect_delay_seconds=0))
    assert calls == 4


def test_stream_events_enforces_total_timeout_before_connecting() -> None:
    calls = 0

    def handler(_request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(200, content="")

    client = Client(
        base_url="http://testserver",
        sync_http_client=httpx.Client(transport=httpx.MockTransport(handler)),
    )

    with pytest.raises(DifyAgentTimeoutError, match="exceeded its timeout"):
        _ = list(client.stream_events_sync("run-1", timeout_seconds=0))
    assert calls == 0


def _read_stream_with_deadline(
    transport: httpx.MockTransport,
    *,
    sync: bool,
    stream_timeout: float | httpx.Timeout = 30.0,
) -> list[RunEvent]:
    async def read_async() -> list[RunEvent]:
        async with httpx.AsyncClient(transport=transport) as http_client:
            client = Client(base_url="http://testserver", stream_timeout=stream_timeout, async_http_client=http_client)
            return [event async for event in client.stream_events("run-1", timeout_seconds=60.0, max_reconnects=0)]

    if sync:
        with httpx.Client(transport=transport) as http_client:
            client = Client(base_url="http://testserver", stream_timeout=stream_timeout, sync_http_client=http_client)
            return list(client.stream_events_sync("run-1", timeout_seconds=60.0, max_reconnects=0))
    return asyncio.run(read_async())


@pytest.mark.parametrize("sync", [False, True], ids=["async", "sync"])
@pytest.mark.parametrize(
    ("stream_timeout", "initial_timeouts"),
    [
        (30.0, (30.0, 30.0, 30.0, 30.0)),
        (httpx.Timeout(30.0, connect=3.0, write=None, pool=4.0), (3.0, 30.0, 60.0, 4.0)),
    ],
)
def test_mock_stream_uses_remaining_budget_after_a_heartbeat(
    deadline_clock: DeadlineClock,
    sync: bool,
    stream_timeout: float | httpx.Timeout,
    initial_timeouts: tuple[float, float, float, float],
) -> None:
    seen: list[str] = []
    streams: list[ScriptedSSEStream] = []

    def handler(request: httpx.Request) -> httpx.Response:
        assert not seen, "A heartbeat does not open a second event stream"
        seen.append(request.url.params["after"])
        timeouts = request.extensions["timeout"]
        assert tuple(timeouts[key] for key in ("connect", "read", "write", "pool")) == initial_timeouts

        def chunks() -> Iterator[bytes]:
            deadline_clock.now = 12.0
            yield _event_frame(RunStartedEvent(id="1-0", run_id="run-1")).encode()
            deadline_clock.now = 40.0
            yield b": keepalive\n\n"
            assert timeouts["read"] == 20.0
            deadline_clock.now += timeouts["read"]
            raise httpx.ReadTimeout("event stream became silent", request=request)

        stream = ScriptedSSEStream(chunks())
        streams.append(stream)
        return httpx.Response(200, stream=stream)

    with pytest.raises(DifyAgentTimeoutError, match="exceeded its timeout"):
        _read_stream_with_deadline(httpx.MockTransport(handler), sync=sync, stream_timeout=stream_timeout)

    assert seen == ["0-0"]
    assert deadline_clock.now == 60.0
    assert all(stream.closed for stream in streams)


@pytest.mark.parametrize("sync", [False, True], ids=["async", "sync"])
@pytest.mark.parametrize("boundary", ["partial_line", "partial_frame"])
def test_deadline_preserves_sse_frames_on_the_same_connection(
    deadline_clock: DeadlineClock, sync: bool, boundary: str
) -> None:
    started = _event_frame(RunStartedEvent(id="1-0", run_id="run-1"))
    terminal = _event_frame(_run_succeeded_event())
    split = 10 if boundary == "partial_line" else len(started) - 1

    def chunks() -> Iterator[bytes]:
        deadline_clock.now = 40.0
        yield started[:split].encode()
        deadline_clock.now = 41.0
        yield (started[split:] + terminal).encode()

    stream = ScriptedSSEStream(chunks())
    seen_after: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        assert not seen_after, "All the frames belong to the same response"
        seen_after.append(request.url.params["after"])
        return httpx.Response(200, stream=stream)

    events = _read_stream_with_deadline(httpx.MockTransport(handler), sync=sync)

    assert seen_after == ["0-0"]
    assert [event.id for event in events] == ["1-0", "2-0"]
    assert stream.closed


@pytest.mark.parametrize("sync", [False, True], ids=["async", "sync"])
@pytest.mark.parametrize("slow_headers", [False, True], ids=["heartbeat-then-silent", "slow-headers-then-silent"])
def test_httpcore_stream_socket_reads_share_the_deadline(
    deadline_clock: DeadlineClock, sync: bool, slow_headers: bool
) -> None:
    if slow_headers:
        timeout = 5.0
        script = ScriptedNetwork(
            deadline_clock,
            [(2.0, _response_headers(1)), (None, b"")],
            connect_seconds=1.0,
            write_seconds=1.0,
        )
        expected_calls = [("connect", 5.0), ("request headers", 4.0), ("read", 3.0), ("read", 1.0)]
    else:
        timeout = 60.0
        started = _event_frame(RunStartedEvent(id="1-0", run_id="run-1")).encode()
        heartbeat = b": keepalive\n\n"
        script = ScriptedNetwork(
            deadline_clock,
            [
                (0.0, _response_headers(len(started) + len(heartbeat) + 1)),
                (12.0, started),
                (28.0, heartbeat),
                (None, b""),
            ],
        )
        expected_calls = [
            ("connect", 30.0),
            ("request headers", 30.0),
            ("read", 30.0),
            ("read", 30.0),
            ("read", 30.0),
            ("read", 20.0),
        ]

    async def scenario() -> None:
        async with httpx.AsyncClient(transport=_core_async_transport(script)) as http_client:
            client = Client(base_url="http://testserver", async_http_client=http_client)
            async for _ in client.stream_events("run-1", timeout_seconds=timeout, max_reconnects=0):
                pass

    with pytest.raises(DifyAgentTimeoutError, match="exceeded its timeout"):
        if sync:
            with httpx.Client(transport=_core_sync_transport(script)) as http_client:
                client = Client(base_url="http://testserver", sync_http_client=http_client)
                list(client.stream_events_sync("run-1", timeout_seconds=timeout, max_reconnects=0))
        else:
            asyncio.run(scenario())

    assert script.calls == expected_calls
    assert script.requests == [b"GET /runs/run-1/events/sse?after=0-0 HTTP/1.1"]
    assert deadline_clock.now == timeout


@pytest.mark.parametrize("sync", [False, True], ids=["async", "sync"])
def test_httpcore_stream_keeps_preopened_connection_for_multiple_frames(
    deadline_clock: DeadlineClock, sync: bool
) -> None:
    status = json.dumps(_run_status_json("running")).encode()
    frames = [
        _event_frame(RunStartedEvent(id="1-0", run_id="run-1")).encode(),
        b": keepalive\n\n",
        _event_frame(RunStartedEvent(id="2-0", run_id="run-1")).encode(),
        b": keepalive\n\n",
        _event_frame(_run_succeeded_event(event_id="3-0")).encode(),
    ]
    script = ScriptedNetwork(
        deadline_clock,
        [
            (0.0, _response_headers(len(status)) + status),
            (0.06, _response_headers(sum(map(len, frames)))),
            *((0.06, frame) for frame in frames),
        ],
    )

    async def scenario() -> list[RunEvent]:
        async with httpx.AsyncClient(transport=_core_async_transport(script)) as http_client:
            response = await http_client.get("http://testserver/runs/run-1")
            assert response.status_code == 200
            client = Client(base_url="http://testserver", async_http_client=http_client)
            return [event async for event in client.stream_events("run-1", timeout_seconds=1.0)]

    if sync:
        with httpx.Client(transport=_core_sync_transport(script)) as http_client:
            response = http_client.get("http://testserver/runs/run-1")
            assert response.status_code == 200
            client = Client(base_url="http://testserver", sync_http_client=http_client)
            events = list(client.stream_events_sync("run-1", timeout_seconds=1.0))
    else:
        events = asyncio.run(scenario())

    assert [event.id for event in events] == ["1-0", "2-0", "3-0"]
    assert script.requests == [b"GET /runs/run-1 HTTP/1.1", b"GET /runs/run-1/events/sse?after=0-0 HTTP/1.1"]
    assert sum(phase == "connect" for phase, _ in script.calls) == 1
    assert [cap for phase, cap in script.calls if phase == "read"] == pytest.approx(
        [5.0, 1.0, 0.94, 0.88, 0.82, 0.76, 0.70]
    )
    assert deadline_clock.now == pytest.approx(0.36)


def test_owned_httpx_client_bounds_a_read_after_response_headers(deadline_clock: DeadlineClock) -> None:
    script = ScriptedNetwork(deadline_clock, [(4.0, _response_headers(1)), (None, b"")])
    base_url = "http://127.0.0.1"
    with Client(base_url=base_url) as client:
        transport = client._get_sync_http_client()._transport_for_url(httpx.URL(base_url))
        assert isinstance(transport, httpx.HTTPTransport)
        transport._pool = httpcore.ConnectionPool(network_backend=ScriptedSyncBackend(script))

        with pytest.raises(DifyAgentTimeoutError, match="exceeded its timeout"):
            list(client.stream_events_sync("run-1", timeout_seconds=5.0, max_reconnects=0))

    assert script.requests == [b"GET /runs/run-1/events/sse?after=0-0 HTTP/1.1"]
    assert [cap for phase, cap in script.calls if phase == "read"] == [5.0, 1.0]
    assert deadline_clock.now == 5.0


def _patch_sync_socket(monkeypatch: pytest.MonkeyPatch, name: str, replacement: object) -> None:
    """Patch the socket lookup used by both the SDK and the active TCP connector."""
    connector_module = inspect.getmodule(socket.create_connection)
    assert connector_module is not None
    # With gevent, the connector resolves its socket and resolver in gevent.socket.
    for module in {socket, connector_module}:
        monkeypatch.setattr(module, name, replacement)


def _observe_resolver_wait(monkeypatch: pytest.MonkeyPatch, observe: Callable[[float | None], None]) -> None:
    """Record the resolver's Event.wait budget while using normal thread synchronization."""

    class ResolverEvent(Event):
        @override
        def wait(self, timeout: float | None = None) -> bool:
            observe(timeout)
            return super().wait(timeout)

    class ResolverThreading:
        Event = ResolverEvent
        Thread = Thread

    monkeypatch.setattr(http_deadline, "threading", ResolverThreading)


def _script_sync_status_socket(monkeypatch: pytest.MonkeyPatch, clock: DeadlineClock) -> ScriptedNetwork:
    """Serve a terminal status through the default httpcore backend with scripted DNS and socket I/O."""
    body = json.dumps(_run_status_json("succeeded")).encode()
    script = ScriptedNetwork(clock, [(0.0, _response_headers(len(body)) + body)])

    def resolve(
        host: str, port: int, family: int = 0, kind: int = socket.SOCK_STREAM
    ) -> list[tuple[socket.AddressFamily, socket.SocketKind, int, str, tuple[str, int]]]:
        assert host == "testserver"
        assert family == 0 and kind == socket.SOCK_STREAM
        return [(socket.AF_INET, socket.SOCK_STREAM, socket.IPPROTO_TCP, "", ("192.0.2.1", port))]

    class StatusSocket(socket.socket):
        @override
        def connect(self, address: object) -> None:
            assert address == ("192.0.2.1", 80)
            script.connect(self.gettimeout())

        @override
        def send(self, data: Buffer, flags: int = 0, /) -> int:
            buffer = bytes(data)
            script.write(buffer, self.gettimeout())
            return len(buffer)

        @override
        def recv(self, bufsize: int, flags: int = 0, /) -> bytes:
            return script.read(self.gettimeout())

    _patch_sync_socket(monkeypatch, "getaddrinfo", resolve)
    _patch_sync_socket(monkeypatch, "socket", StatusSocket)
    return script


@pytest.mark.parametrize(
    ("poll", "timeout", "expected_connect", "expected_read"),
    [
        (False, httpx.Timeout(5.0, connect=3.0), 3.0, 5.0),
        (True, httpx.Timeout(5.0, connect=3.0), 3.0, 5.0),
        (False, httpx.Timeout(math.inf), None, None),
    ],
    ids=["get", "wait", "unbounded-http-phases"],
)
def test_sync_infinite_total_timeout_keeps_http_phase_timeouts(
    monkeypatch: pytest.MonkeyPatch,
    poll: bool,
    timeout: httpx.Timeout,
    expected_connect: float | None,
    expected_read: float | None,
) -> None:
    script = _script_sync_status_socket(monkeypatch, DeadlineClock())
    with httpx.Client(trust_env=False) as http_client:
        client = Client(base_url="http://testserver", timeout=timeout, sync_http_client=http_client)
        get_status = client.wait_run_sync if poll else client.get_run_sync
        assert get_status("run-1", timeout_seconds=math.inf).status == "succeeded"

    assert script.requests == [b"GET /runs/run-1 HTTP/1.1"]
    assert [call for call in script.calls if call[0] in {"connect", "read"}] == [
        ("connect", expected_connect),
        ("read", expected_read),
    ]


def test_infinite_injected_budget_preserves_the_finite_dns_connect_budget(monkeypatch: pytest.MonkeyPatch) -> None:
    clock = DeadlineClock()
    monkeypatch.setattr(http_deadline, "time", clock)
    script = _script_sync_status_socket(monkeypatch, clock)
    semaphore = BoundedSemaphore(1)
    acquire = semaphore.acquire
    waits: list[float | None] = []

    def acquire_after_slot_wait(*, timeout: float | None = None) -> bool:
        assert timeout == 3.0
        clock.now += 2.0
        return acquire(timeout=timeout)

    monkeypatch.setattr(semaphore, "acquire", acquire_after_slot_wait)
    monkeypatch.setattr(http_deadline, "_dns_resolution_semaphore", semaphore)
    _observe_resolver_wait(monkeypatch, waits.append)
    timeout = httpx.Timeout(5.0, connect=3.0)
    with httpx.Client(trust_env=False) as http_client:
        request = http_client.build_request("GET", "http://testserver/runs/run-1", timeout=timeout)
        with http_deadline.stream_sync(http_client, request, timeout, lambda: math.inf) as response:
            response.read()
            assert response.json()["status"] == "succeeded"

    assert waits == [1.0]
    assert [call for call in script.calls if call[0] in {"connect", "read"}] == [("connect", 3.0), ("read", 5.0)]


def test_sync_tcp_address_attempts_share_request_deadline(
    deadline_clock: DeadlineClock, monkeypatch: pytest.MonkeyPatch
) -> None:
    addresses = ["192.0.2.1", "192.0.2.2", "192.0.2.3"]
    attempts: list[tuple[socket.socket, object, float]] = []

    def resolve(
        host: str, port: int, family: int = 0, kind: int = socket.SOCK_STREAM
    ) -> list[tuple[socket.AddressFamily, socket.SocketKind, int, str, tuple[str, int]]]:
        assert host == "testserver"
        assert family == 0 and kind == socket.SOCK_STREAM
        return [(socket.AF_INET, socket.SOCK_STREAM, socket.IPPROTO_TCP, "", (ip, port)) for ip in addresses]

    class SlowConnectSocket(socket.socket):
        @override
        def connect(self, address: object) -> None:
            timeout = self.gettimeout()
            assert timeout is not None
            attempts.append((self, address, timeout))
            deadline_clock.now += min(3.0, timeout)
            if timeout < 3.0:
                raise TimeoutError("connection attempt timed out")
            raise ConnectionRefusedError("address unavailable")

    _patch_sync_socket(monkeypatch, "getaddrinfo", resolve)
    _patch_sync_socket(monkeypatch, "socket", SlowConnectSocket)

    with httpx.Client(trust_env=False) as http_client:
        client = Client(base_url="http://testserver", sync_http_client=http_client)
        with pytest.raises(DifyAgentTimeoutError, match="cancel_run_sync timed out"):
            client.cancel_run_sync("run-1", timeout_seconds=5.0)

    assert [(address, timeout) for _, address, timeout in attempts] == [
        (("192.0.2.1", 80), 5.0),
        (("192.0.2.2", 80), 2.0),
    ]
    assert all(sock.fileno() == -1 for sock, _, _ in attempts)
    assert deadline_clock.now == 5.0


@pytest.mark.parametrize(
    ("host", "family", "sockaddr"),
    [
        ("127.0.0.1", socket.AF_INET, ("127.0.0.1", 80)),
        ("[::1]", socket.AF_INET6, ("::1", 80, 0, 0)),
        ("[fe80::1%7]", socket.AF_INET6, ("fe80::1", 80, 0, 7)),
    ],
    ids=["ipv4", "ipv6", "ipv6-numeric-scope"],
)
def test_sync_numeric_address_connects_within_deadline_without_dns(
    deadline_clock: DeadlineClock,
    monkeypatch: pytest.MonkeyPatch,
    host: str,
    family: socket.AddressFamily,
    sockaddr: tuple[str, int] | tuple[str, int, int, int],
) -> None:
    attempts: list[socket.socket] = []

    def unexpected_lookup(*_args: object) -> None:
        pytest.fail("A numeric address must bypass DNS resolution")

    class SlowConnectSocket(socket.socket):
        @override
        def connect(self, address: object) -> None:
            attempts.append(self)
            assert self.family == family
            assert address == sockaddr
            timeout = self.gettimeout()
            assert timeout == 5.0
            deadline_clock.now += timeout
            raise TimeoutError("connect timed out")

    _patch_sync_socket(monkeypatch, "getaddrinfo", unexpected_lookup)
    _patch_sync_socket(monkeypatch, "socket", SlowConnectSocket)
    with httpx.Client(trust_env=False) as http_client:
        client = Client(base_url=f"http://{host}", sync_http_client=http_client)
        with pytest.raises(DifyAgentTimeoutError, match="cancel_run_sync timed out"):
            client.cancel_run_and_wait_sync("run-1", timeout_seconds=5.0)

    assert len(attempts) == 1
    assert attempts[0].fileno() == -1
    assert deadline_clock.now == 5.0


def test_sync_dns_exhaustion_prevents_tcp_connection(
    deadline_clock: DeadlineClock, monkeypatch: pytest.MonkeyPatch
) -> None:
    def resolve(
        host: str, port: int, family: int, kind: int
    ) -> list[tuple[socket.AddressFamily, socket.SocketKind, int, str, tuple[str, int]]]:
        assert host == "testserver"
        assert family == 0 and kind == socket.SOCK_STREAM
        deadline_clock.now += 6.0
        return [(socket.AF_INET, socket.SOCK_STREAM, socket.IPPROTO_TCP, "", ("192.0.2.1", port))]

    class UnexpectedSocket(socket.socket):
        @override
        def connect(self, address: object) -> None:
            pytest.fail(f"Attempted TCP connect to {address} after DNS exhausted the deadline")

    _patch_sync_socket(monkeypatch, "getaddrinfo", resolve)
    _patch_sync_socket(monkeypatch, "socket", UnexpectedSocket)
    with httpx.Client(trust_env=False) as http_client:
        client = Client(base_url="http://testserver", sync_http_client=http_client)
        with pytest.raises(DifyAgentTimeoutError, match="cancel_run_sync timed out"):
            client.cancel_run_and_wait_sync("run-1", timeout_seconds=5.0)
    assert deadline_clock.now == 6.0


@pytest.mark.parametrize(
    ("url_host", "resolver_host"),
    [("testserver", "testserver"), ("[fe80::1%lo]", "fe80::1%lo")],
    ids=["hostname", "ipv6-interface-scope"],
)
def test_sync_dns_timeout_returns_while_resolver_is_blocked(
    monkeypatch: pytest.MonkeyPatch, url_host: str, resolver_host: str
) -> None:
    started = Event()
    release = Event()
    finished = Event()

    def resolve(
        host: str, _port: int, family: int, kind: int
    ) -> list[tuple[socket.AddressFamily, socket.SocketKind, int, str, tuple[str, int]]]:
        assert host == resolver_host
        assert family == 0 and kind == socket.SOCK_STREAM
        started.set()
        try:
            release.wait(5.0)
            return []
        finally:
            finished.set()

    _patch_sync_socket(monkeypatch, "getaddrinfo", resolve)
    try:
        with httpx.Client(trust_env=False) as http_client:
            client = Client(base_url=f"http://{url_host}", sync_http_client=http_client)
            with pytest.raises(DifyAgentTimeoutError, match="cancel_run_sync timed out"):
                client.cancel_run_and_wait_sync("run-1", timeout_seconds=0.25)
        assert started.is_set()
        assert not finished.is_set()
    finally:
        release.set()
        if started.is_set():
            assert finished.wait(2.0)


def test_sync_dns_caps_abandoned_lookups_and_recovers_capacity(monkeypatch: pytest.MonkeyPatch) -> None:
    release = Event()
    lookups: list[str] = []
    monkeypatch.setattr(http_deadline, "_dns_resolution_semaphore", BoundedSemaphore(2))

    def resolve(
        host: str, port: int, family: int, kind: int
    ) -> list[tuple[socket.AddressFamily, socket.SocketKind, int, str, tuple[str, int]]]:
        assert family == 0 and kind == socket.SOCK_STREAM
        lookups.append(host)
        release.wait(5.0)
        return [(socket.AF_INET, socket.SOCK_STREAM, socket.IPPROTO_TCP, "", ("192.0.2.1", port))]

    class RefusedSocket(socket.socket):
        @override
        def connect(self, address: object) -> None:
            assert address == ("192.0.2.1", 80)
            raise ConnectionRefusedError("resolved address was tried")

    _patch_sync_socket(monkeypatch, "getaddrinfo", resolve)
    _patch_sync_socket(monkeypatch, "socket", RefusedSocket)
    with httpx.Client(trust_env=False) as http_client:
        client = Client(base_url="http://testserver", sync_http_client=http_client)
        try:
            for expected_lookups in (1, 2, 2):
                with pytest.raises(DifyAgentTimeoutError, match="cancel_run_sync timed out"):
                    client.cancel_run_and_wait_sync("run-1", timeout_seconds=0.2)
                assert lookups == ["testserver"] * expected_lookups
        finally:
            release.set()
        with pytest.raises(DifyAgentClientError, match="resolved address was tried"):
            client.cancel_run_sync("run-1", timeout_seconds=2.0)

    assert lookups == ["testserver"] * 3


@pytest.mark.parametrize(
    ("request_timeout", "connect_timeout", "resolution_fails"),
    [(5.0, 10.0, False), (10.0, 3.0, False), (10.0, 3.0, True)],
    ids=["request-budget", "connect-budget", "connect-budget-resolver-error"],
)
def test_sync_dns_capacity_wait_and_lookup_share_the_connect_budget(
    deadline_clock: DeadlineClock,
    monkeypatch: pytest.MonkeyPatch,
    request_timeout: float,
    connect_timeout: float,
    resolution_fails: bool,
) -> None:
    connect_budget = min(request_timeout, connect_timeout)
    waiting = Event()
    allow_resolution = Event()
    semaphore = BoundedSemaphore(1)
    assert semaphore.acquire()
    acquire = semaphore.acquire

    def acquire_with_observation(*, timeout: float | None = None) -> bool:
        assert timeout == connect_budget
        waiting.set()
        return acquire(timeout=timeout)

    def observe_resolver_wait(timeout: float | None) -> None:
        assert timeout == connect_budget - 2.0
        allow_resolution.set()

    def release_waiter() -> None:
        if waiting.wait(2.0):
            deadline_clock.now += 2.0
        semaphore.release()

    def resolve(
        host: str, port: int, family: int, kind: int
    ) -> list[tuple[socket.AddressFamily, socket.SocketKind, int, str, tuple[str, int]]]:
        assert host == "testserver"
        assert family == 0 and kind == socket.SOCK_STREAM
        assert allow_resolution.wait(2.0)
        assert deadline_clock.now == 2.0
        deadline_clock.now += 1.0
        if resolution_fails:
            raise OSError("Lookup failed at the connect deadline")
        return [(socket.AF_INET, socket.SOCK_STREAM, socket.IPPROTO_TCP, "", ("192.0.2.1", port))]

    class SlowConnectSocket(socket.socket):
        @override
        def connect(self, address: object) -> None:
            assert request_timeout < connect_timeout, "TCP attempted after DNS exhausted the connect budget"
            assert address == ("192.0.2.1", 80)
            timeout = self.gettimeout()
            assert timeout == 2.0
            deadline_clock.now += timeout
            raise TimeoutError("connect timed out")

    monkeypatch.setattr(semaphore, "acquire", acquire_with_observation)
    monkeypatch.setattr(http_deadline, "_dns_resolution_semaphore", semaphore)
    _observe_resolver_wait(monkeypatch, observe_resolver_wait)
    _patch_sync_socket(monkeypatch, "getaddrinfo", resolve)
    _patch_sync_socket(monkeypatch, "socket", SlowConnectSocket)
    releaser = Thread(target=release_waiter, daemon=True)
    releaser.start()
    try:
        with httpx.Client(trust_env=False) as http_client:
            client = Client(
                base_url="http://testserver",
                timeout=httpx.Timeout(10.0, connect=connect_timeout),
                sync_http_client=http_client,
            )
            with pytest.raises(DifyAgentTimeoutError, match="cancel_run_sync timed out"):
                client.cancel_run_and_wait_sync("run-1", timeout_seconds=request_timeout)
    finally:
        allow_resolution.set()
        waiting.set()
        releaser.join(timeout=2.0)

    assert deadline_clock.now == connect_budget


def test_sync_blocked_dns_uses_connect_time_left_after_waiting_for_capacity(monkeypatch: pytest.MonkeyPatch) -> None:
    connect_timeout = 0.5
    slot_delay = 0.15
    waiting_for_slot = Event()
    lookup_started = Event()
    finish_lookup = Event()
    lookup_finished = Event()
    semaphore = BoundedSemaphore(1)
    assert semaphore.acquire()
    acquire = semaphore.acquire

    def acquire_with_observation(*, timeout: float | None = None) -> bool:
        waiting_for_slot.set()
        return acquire(timeout=timeout)

    def release_slot() -> None:
        if waiting_for_slot.wait(2.0):
            sleep(slot_delay)
        semaphore.release()

    def observe_resolver_wait(timeout: float | None) -> None:
        assert timeout is not None
        # A tolerance for thread scheduling still distinguishes a reused connect timeout.
        assert 0.0 < timeout <= connect_timeout - slot_delay / 2

    def resolve(
        host: str, _port: int, family: int, kind: int
    ) -> list[tuple[socket.AddressFamily, socket.SocketKind, int, str, tuple[str, int]]]:
        assert host == "testserver"
        assert family == 0 and kind == socket.SOCK_STREAM
        lookup_started.set()
        try:
            assert finish_lookup.wait(5.0)
            return []
        finally:
            lookup_finished.set()

    def unexpected_connect(_sock: socket.socket, address: object) -> None:
        pytest.fail(f"Attempted TCP connect to {address} while DNS was blocked")

    monkeypatch.setattr(semaphore, "acquire", acquire_with_observation)
    monkeypatch.setattr(http_deadline, "_dns_resolution_semaphore", semaphore)
    _observe_resolver_wait(monkeypatch, observe_resolver_wait)
    _patch_sync_socket(monkeypatch, "getaddrinfo", resolve)
    monkeypatch.setattr(socket.socket, "connect", unexpected_connect)
    with httpx.Client(trust_env=False) as http_client:
        client = Client(
            base_url="http://testserver",
            timeout=httpx.Timeout(2.0, connect=connect_timeout),
            sync_http_client=http_client,
        )
        releaser = Thread(target=release_slot, daemon=True)
        releaser.start()
        try:
            started_at = monotonic()
            with pytest.raises(DifyAgentTimeoutError, match="cancel_run_sync timed out"):
                client.cancel_run_and_wait_sync("run-1", timeout_seconds=2.0)
            assert monotonic() - started_at < 1.5
            assert lookup_started.is_set()
            assert not lookup_finished.is_set()
        finally:
            finish_lookup.set()
            waiting_for_slot.set()
            releaser.join(timeout=2.0)
            if lookup_started.is_set():
                assert lookup_finished.wait(2.0)


def test_sync_partial_writes_share_request_deadline(
    deadline_clock: DeadlineClock, monkeypatch: pytest.MonkeyPatch
) -> None:
    writes: list[tuple[bytes, float]] = []

    class SlowSendSocket(socket.socket):
        @override
        def connect(self, address: object) -> None:
            pass

        @override
        def send(self, data: Buffer, flags: int = 0, /) -> int:
            timeout = self.gettimeout()
            assert timeout is not None
            chunk = bytes(data)
            writes.append((chunk, timeout))
            deadline_clock.now += min(3.0, timeout)
            if timeout < 3.0:
                raise TimeoutError("partial write timed out")
            return len(chunk) // 2

    _patch_sync_socket(monkeypatch, "socket", SlowSendSocket)
    with httpx.Client(trust_env=False) as http_client:
        client = Client(base_url="http://127.0.0.1", sync_http_client=http_client)
        with pytest.raises(DifyAgentTimeoutError, match="cancel_run_sync timed out"):
            client.cancel_run_sync("run-1", timeout_seconds=5.0)

    assert [timeout for _, timeout in writes] == [5.0, 2.0]
    (first_chunk, _), (second_chunk, _) = writes
    first_sent = len(first_chunk) // 2
    assert second_chunk == first_chunk[first_sent:]
    assert deadline_clock.now == 5.0


@pytest.mark.parametrize("sync", [False, True], ids=["async", "sync"])
@pytest.mark.parametrize(
    ("operation", "second_chunk_delay", "request_line"),
    [
        ("cancel", None, b"POST /runs/run-1/cancel HTTP/1.1"),
        ("create", None, b"POST /runs HTTP/1.1"),
        ("wait", 3.0, b"GET /runs/run-1 HTTP/1.1"),
    ],
)
def test_httpcore_json_body_reads_share_the_request_deadline(
    deadline_clock: DeadlineClock, sync: bool, operation: str, second_chunk_delay: float | None, request_line: bytes
) -> None:
    body = b'{"run_id":"run-1","status":"cancelled"}'
    split = len(body) // 2
    script = ScriptedNetwork(
        deadline_clock,
        [(0.0, _response_headers(len(body))), (3.0, body[:split]), (second_chunk_delay, body[split:])],
    )
    payload = CreateRunRequest.model_validate(_create_run_payload())

    async def scenario() -> None:
        async with httpx.AsyncClient(transport=_core_async_transport(script)) as http_client:
            client = Client(base_url="http://testserver", async_http_client=http_client)
            if operation == "cancel":
                await client.cancel_run_and_wait("run-1", after="1-0", timeout_seconds=5.0)
            elif operation == "create":
                await client.create_run(payload, timeout_seconds=5.0)
            else:
                await client.wait_run("run-1", timeout_seconds=5.0)

    with pytest.raises(DifyAgentTimeoutError, match="timed out"):
        if sync:
            with httpx.Client(transport=_core_sync_transport(script)) as http_client:
                client = Client(base_url="http://testserver", sync_http_client=http_client)
                if operation == "cancel":
                    client.cancel_run_and_wait_sync("run-1", after="1-0", timeout_seconds=5.0)
                elif operation == "create":
                    client.create_run_sync(payload, timeout_seconds=5.0)
                else:
                    client.wait_run_sync("run-1", timeout_seconds=5.0)
        else:
            asyncio.run(scenario())

    assert script.requests == [request_line]
    assert [cap for phase, cap in script.calls if phase == "read"] == [5.0, 5.0, 2.0]
    assert deadline_clock.now == 5.0


@pytest.mark.parametrize("sync", [True, False])
@pytest.mark.parametrize("stop_reason", ["cancel", "timeout"])
def test_stream_events_observes_caller_stop_on_heartbeat(
    monkeypatch: pytest.MonkeyPatch, sync: bool, stop_reason: str
) -> None:
    now = 0.0
    stopped = False
    chunks_delivered = 0
    calls = 0
    monkeypatch.setattr(client_module.time, "monotonic", lambda: now)

    def on_heartbeat_chunk() -> None:
        nonlocal chunks_delivered, now, stopped
        chunks_delivered += 1
        if stop_reason == "cancel":
            stopped = True
        else:
            now = 1.0

    stream: OpenSyncStream | OpenAsyncStream = (
        OpenSyncStream(": keepalive\n\n", on_chunk=on_heartbeat_chunk)
        if sync
        else OpenAsyncStream(": keepalive\n\n", on_chunk=on_heartbeat_chunk)
    )

    def handler(_request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(200, stream=stream)

    expected_error = DifyAgentStreamError if stop_reason == "cancel" else DifyAgentTimeoutError
    expected_message = "cancelled by the caller" if stop_reason == "cancel" else "exceeded its timeout"

    async def scenario() -> None:
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http_client:
            client = Client(base_url="http://testserver", async_http_client=http_client)
            with pytest.raises(expected_error, match=expected_message):
                _ = [
                    event
                    async for event in client.stream_events(
                        "run-1",
                        should_stop=lambda: stopped,
                        timeout_seconds=1,
                        reconnect_delay_seconds=0,
                    )
                ]

    if sync:
        with httpx.Client(transport=httpx.MockTransport(handler)) as http_client:
            client = Client(base_url="http://testserver", sync_http_client=http_client)
            with pytest.raises(expected_error, match=expected_message):
                _ = list(
                    client.stream_events_sync(
                        "run-1",
                        should_stop=lambda: stopped,
                        timeout_seconds=1,
                        reconnect_delay_seconds=0,
                    )
                )
    else:
        asyncio.run(scenario())

    assert chunks_delivered == 1
    assert stream.closed
    assert calls == 1


@pytest.mark.parametrize("sync", [True, False])
@pytest.mark.parametrize("stop_reason", ["cancel", "timeout"])
def test_stream_events_finishes_cleanly_at_eof_after_last_event(
    monkeypatch: pytest.MonkeyPatch, sync: bool, stop_reason: str
) -> None:
    now = 0.0
    stopped = False
    calls = 0
    monkeypatch.setattr(client_module.time, "monotonic", lambda: now)
    body = _event_frame(RunStartedEvent(id="1-0", run_id="run-1")) + ": trailing\r"

    def trigger_stop() -> None:
        nonlocal now, stopped
        if stop_reason == "cancel":
            stopped = True
        else:
            now = 1.0

    # HTTPX closes the response after reading EOF and before the SSE decoder flushes.
    stream = ScriptedSSEStream(iter([body.encode()]), on_close=trigger_stop)

    def handler(_request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(200, stream=stream, headers={"content-type": "text/event-stream"})

    async def scenario() -> None:
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http_client:
            client = Client(base_url="http://testserver", async_http_client=http_client)
            async with aclosing(
                client.stream_events(
                    "run-1",
                    reconnect=False,
                    should_stop=lambda: stopped,
                    timeout_seconds=1,
                )
            ) as events:
                assert (await anext(events)).type == "run_started"
                assert [event.type async for event in events] == []

    if sync:
        with httpx.Client(transport=httpx.MockTransport(handler)) as http_client:
            client = Client(base_url="http://testserver", sync_http_client=http_client)
            events = client.stream_events_sync(
                "run-1",
                reconnect=False,
                should_stop=lambda: stopped,
                timeout_seconds=1,
            )
            try:
                assert next(events).type == "run_started"
                assert [event.type for event in events] == []
            finally:
                events.close()
    else:
        asyncio.run(scenario())

    assert stream.closed
    assert calls == 1


@pytest.mark.parametrize("sync", [True, False])
@pytest.mark.parametrize("stop_reason", ["cancel", "timeout", None])
@pytest.mark.parametrize("frame_ending", ["\n", "\r"])
def test_stream_events_checks_stop_between_buffered_events(
    monkeypatch: pytest.MonkeyPatch, sync: bool, stop_reason: str | None, frame_ending: str
) -> None:
    now = 0.0
    stopped = False
    calls = 0
    monkeypatch.setattr(client_module.time, "monotonic", lambda: now)
    body = _event_frame(RunStartedEvent(id="1-0", run_id="run-1")) + _event_frame(_run_succeeded_event())
    body = body[:-1] + frame_ending

    def trigger_stop() -> None:
        nonlocal now, stopped
        if stop_reason == "cancel":
            stopped = True
        elif stop_reason == "timeout":
            now = 1.0

    if frame_ending == "\r":
        # Let the body reach EOF within budget so the final frame is checked during decoder flush.
        stream: ScriptedSSEStream | OpenSyncStream | OpenAsyncStream = ScriptedSSEStream(
            iter([body.encode()]), on_close=trigger_stop
        )
    else:
        stream = OpenSyncStream(body) if sync else OpenAsyncStream(body)

    def handler(_request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(200, stream=stream, headers={"content-type": "text/event-stream"})

    expected_error = DifyAgentStreamError if stop_reason == "cancel" else DifyAgentTimeoutError
    expected_message = "cancelled by the caller" if stop_reason == "cancel" else "exceeded its timeout"

    async def scenario() -> None:
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http_client:
            client = Client(base_url="http://testserver", async_http_client=http_client)
            async with aclosing(
                client.stream_events("run-1", should_stop=lambda: stopped, timeout_seconds=1, reconnect_delay_seconds=0)
            ) as events:
                assert (await anext(events)).type == "run_started"
                if frame_ending == "\n":
                    trigger_stop()
                if stop_reason is None:
                    assert [event.type async for event in events] == ["run_succeeded"]
                else:
                    with pytest.raises(expected_error, match=expected_message):
                        _ = await anext(events)
                    assert stream.closed

    if sync:
        with httpx.Client(transport=httpx.MockTransport(handler)) as http_client:
            client = Client(base_url="http://testserver", sync_http_client=http_client)
            events = client.stream_events_sync(
                "run-1", should_stop=lambda: stopped, timeout_seconds=1, reconnect_delay_seconds=0
            )
            try:
                assert next(events).type == "run_started"
                if frame_ending == "\n":
                    trigger_stop()
                if stop_reason is None:
                    assert [event.type for event in events] == ["run_succeeded"]
                else:
                    with pytest.raises(expected_error, match=expected_message):
                        _ = next(events)
                    assert stream.closed
            finally:
                events.close()
    else:
        asyncio.run(scenario())

    assert stream.closed
    assert calls == 1


@pytest.mark.parametrize("sync", [True, False])
@pytest.mark.parametrize("stop_reason", ["cancel", "timeout"])
@pytest.mark.parametrize("close_error_cls", [httpx.CloseError, httpx.ReadTimeout])
def test_stream_events_preserves_stop_error_when_response_close_fails(
    monkeypatch: pytest.MonkeyPatch,
    sync: bool,
    stop_reason: str,
    close_error_cls: type[httpx.HTTPError],
) -> None:
    now = 0.0
    cancel_once = False
    calls = 0
    monkeypatch.setattr(client_module.time, "monotonic", lambda: now)
    body = _event_frame(RunStartedEvent(id="1-0", run_id="run-1")) + _event_frame(
        _run_failed_event("synthetic failure")
    )
    close_error = close_error_cls("response close failed")
    stream: OpenSyncStream | OpenAsyncStream = (
        OpenSyncStream(body, close_error=close_error) if sync else OpenAsyncStream(body, close_error=close_error)
    )

    def should_stop() -> bool:
        nonlocal cancel_once
        if cancel_once:
            cancel_once = False
            return True
        return False

    def handler(_request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(200, stream=stream, headers={"content-type": "text/event-stream"})

    expected_error = DifyAgentStreamError if stop_reason == "cancel" else DifyAgentTimeoutError
    expected_message = "cancelled by the caller" if stop_reason == "cancel" else "exceeded its timeout"
    max_reconnects = 3 if stop_reason == "cancel" else 0

    def trigger_stop() -> None:
        nonlocal cancel_once, now
        if stop_reason == "cancel":
            cancel_once = True
        else:
            now = 1.0

    async def scenario() -> None:
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http_client:
            client = Client(base_url="http://testserver", async_http_client=http_client)
            async with aclosing(
                client.stream_events(
                    "run-1",
                    should_stop=should_stop,
                    timeout_seconds=1,
                    max_reconnects=max_reconnects,
                    reconnect_delay_seconds=0,
                )
            ) as events:
                assert (await anext(events)).type == "run_started"
                trigger_stop()
                with pytest.raises(expected_error, match=expected_message):
                    _ = await anext(events)
                assert stream.closed

    if sync:
        with httpx.Client(transport=httpx.MockTransport(handler)) as http_client:
            client = Client(base_url="http://testserver", sync_http_client=http_client)
            events = client.stream_events_sync(
                "run-1",
                should_stop=should_stop,
                timeout_seconds=1,
                max_reconnects=max_reconnects,
                reconnect_delay_seconds=0,
            )
            try:
                assert next(events).type == "run_started"
                trigger_stop()
                with pytest.raises(expected_error, match=expected_message):
                    _ = next(events)
                assert stream.closed
            finally:
                events.close()
    else:
        asyncio.run(scenario())

    assert calls == 1


def test_malformed_sse_frame_does_not_reconnect() -> None:
    calls = 0

    def handler(_request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(200, content="data: not-json\n\n")

    client = Client(
        base_url="http://testserver",
        sync_http_client=httpx.Client(transport=httpx.MockTransport(handler)),
    )

    with pytest.raises(DifyAgentStreamError):
        _ = list(client.stream_events_sync("run-1", reconnect_delay_seconds=0))
    assert calls == 1


@pytest.mark.parametrize("sync", [True, False])
@pytest.mark.parametrize(
    "terminal_event",
    [_run_succeeded_event(), _run_failed_event("failed"), RunCancelledEvent(id="2-0", run_id="run-1")],
)
@pytest.mark.parametrize("close_error", [None, httpx.ReadError, httpx.StreamError, httpx.ReadTimeout])
def test_stream_events_yields_terminal_event_after_closing_response(
    sync: bool, terminal_event: RunEvent, close_error: type[httpx.HTTPError] | None
) -> None:
    stream_type = OpenSyncStream if sync else OpenAsyncStream
    stream = stream_type(
        _event_frame(terminal_event),
        close_error=close_error("response close failed") if close_error is not None else None,
    )

    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, stream=stream)

    async def scenario() -> None:
        http_client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        client = Client(base_url="http://testserver", async_http_client=http_client)

        events = client.stream_events("run-1")
        try:
            assert await anext(events) == terminal_event
            assert stream.closed
            with pytest.raises(StopAsyncIteration):
                _ = await anext(events)
        finally:
            await events.aclose()
        await http_client.aclose()

    if sync:
        with httpx.Client(transport=httpx.MockTransport(handler)) as http_client:
            client = Client(base_url="http://testserver", sync_http_client=http_client)
            with closing(client.stream_events_sync("run-1")) as events:
                assert next(events) == terminal_event
                assert stream.closed
                with pytest.raises(StopIteration):
                    _ = next(events)
    else:
        asyncio.run(scenario())


@pytest.mark.parametrize("sync", [True, False], ids=["sync", "async"])
@pytest.mark.parametrize("deadline_expires", [False, True], ids=["stop", "stop-and-timeout"])
def test_stream_events_delivers_accepted_terminal_event_while_deadline_remains(
    deadline_clock: DeadlineClock, sync: bool, deadline_expires: bool
) -> None:
    stopped = False
    calls = 0
    terminal_event = _run_succeeded_event()

    def stop_on_close() -> None:
        nonlocal stopped
        stopped = True
        if deadline_expires:
            deadline_clock.now = 2.0

    stream = ScriptedSSEStream(iter([_event_frame(terminal_event).encode()]), on_close=stop_on_close)

    def handler(_request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(200, stream=stream)

    transport = httpx.MockTransport(handler)

    async def read_async() -> list[RunEvent]:
        async with httpx.AsyncClient(transport=transport) as http_client:
            client = Client(base_url="http://testserver", async_http_client=http_client)
            return [
                event async for event in client.stream_events("run-1", should_stop=lambda: stopped, timeout_seconds=1)
            ]

    def read_events() -> list[RunEvent]:
        if not sync:
            return asyncio.run(read_async())
        with httpx.Client(transport=transport) as http_client:
            client = Client(base_url="http://testserver", sync_http_client=http_client)
            return list(client.stream_events_sync("run-1", should_stop=lambda: stopped, timeout_seconds=1))

    if deadline_expires:
        with pytest.raises(DifyAgentTimeoutError, match="exceeded its timeout"):
            read_events()
    else:
        assert read_events() == [terminal_event]

    assert stopped
    assert stream.closed
    assert calls == 1


def test_async_stream_events_closes_response_when_the_iterator_is_closed() -> None:
    stream = OpenAsyncStream(_event_frame(RunStartedEvent(id="1-0", run_id="run-1")))
    transport = httpx.MockTransport(lambda _request: httpx.Response(200, stream=stream))

    async def scenario() -> None:
        async with httpx.AsyncClient(transport=transport) as http_client:
            client = Client(base_url="http://testserver", async_http_client=http_client)
            events = client.stream_events("run-1")
            assert (await anext(events)).type == "run_started"
            assert not stream.closed
            await events.aclose()
            assert stream.closed

    asyncio.run(scenario())


@pytest.mark.parametrize("exit_method", ["close", "throw", "aclose", "athrow"])
@pytest.mark.parametrize(
    ("close_error", "expected_error"),
    [
        (httpx.ReadError, DifyAgentStreamError),
        (httpx.StreamError, DifyAgentStreamError),
        (httpx.ReadTimeout, DifyAgentTimeoutError),
    ],
)
def test_stream_events_does_not_reconnect_when_interrupted_close_fails(
    exit_method: str, close_error: type[httpx.HTTPError], expected_error: type[DifyAgentClientError]
) -> None:
    sync = exit_method in {"close", "throw"}
    stream_type = OpenSyncStream if sync else OpenAsyncStream
    stream = stream_type(
        _event_frame(RunStartedEvent(id="1-0", run_id="run-1")),
        close_error=close_error("response close failed"),
    )
    calls = 0

    def handler(_request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        assert calls == 1, "caller-driven iterator exit must not reconnect the SSE stream"
        return httpx.Response(200, stream=stream)

    async def scenario() -> None:
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http_client:
            client = Client(base_url="http://testserver", async_http_client=http_client)
            async with aclosing(client.stream_events("run-1", reconnect_delay_seconds=0)) as events:
                assert (await anext(events)).type == "run_started"
                assert not stream.closed
                with pytest.raises(expected_error):
                    if exit_method == "aclose":
                        await events.aclose()
                    else:
                        await events.athrow(ValueError("caller stopped"))
                assert stream.closed
                assert calls == 1

    if sync:
        with httpx.Client(transport=httpx.MockTransport(handler)) as http_client:
            client = Client(base_url="http://testserver", sync_http_client=http_client)
            with closing(client.stream_events_sync("run-1", reconnect_delay_seconds=0)) as events:
                assert next(events).type == "run_started"
                assert not stream.closed
                with pytest.raises(expected_error):
                    if exit_method == "close":
                        events.close()
                    else:
                        events.throw(ValueError("caller stopped"))
                assert stream.closed
                assert calls == 1
    else:
        asyncio.run(scenario())


def test_async_stream_events_enforces_total_timeout_before_connecting() -> None:
    calls = 0

    def handler(_request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(200, content="")

    async def scenario() -> None:
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http_client:
            client = Client(base_url="http://testserver", async_http_client=http_client)

            with pytest.raises(DifyAgentTimeoutError, match="exceeded its timeout"):
                _ = [event async for event in client.stream_events("run-1", timeout_seconds=0)]

    asyncio.run(scenario())

    assert calls == 0


@pytest.mark.parametrize("stream_type", [TrackingAsyncStream, DisconnectingAsyncStream], ids=["eof", "disconnect"])
def test_async_stream_events_consumes_response_after_terminal_without_reconnecting(
    stream_type: type[TrackingAsyncStream] | type[DisconnectingAsyncStream],
) -> None:
    terminal_event = _run_succeeded_event()
    trailing_event = RunStartedEvent(id="3-0", run_id="run-1")
    stream = stream_type(_event_frame(terminal_event), _event_frame(trailing_event))
    calls = 0

    def handler(_request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(200, stream=stream)

    async def scenario() -> None:
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http_client:
            client = Client(base_url="http://testserver", async_http_client=http_client)
            async with aclosing(client.stream_events("run-1", until_terminal=False)) as events:
                assert await anext(events) == terminal_event
                assert not stream.closed
                assert await anext(events) == trailing_event
                assert not stream.closed
                with pytest.raises(StopAsyncIteration):
                    _ = await anext(events)
                assert stream.closed
                assert calls == 1

    asyncio.run(scenario())


def test_async_stream_events_reconnects_from_latest_event_after_transport_error() -> None:
    seen_after: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen_after.append(request.url.params["after"])
        if len(seen_after) == 1:
            return httpx.Response(
                200,
                stream=DisconnectingAsyncStream(_event_frame(RunStartedEvent(id="1-0", run_id="run-1"))),
            )
        return httpx.Response(200, content=_event_frame(_run_succeeded_event()))

    async def scenario() -> None:
        http_client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        client = Client(base_url="http://testserver", async_http_client=http_client)

        events = [event async for event in client.stream_events("run-1", reconnect_delay_seconds=0)]

        assert seen_after == ["0-0", "1-0"]
        assert [event.type for event in events] == ["run_started", "run_succeeded"]
        await http_client.aclose()

    asyncio.run(scenario())


def test_async_stream_events_resets_reconnect_budget_after_each_delivered_event() -> None:
    seen_after: list[str] = []
    progress_events = 5

    def handler(request: httpx.Request) -> httpx.Response:
        seen_after.append(request.url.params["after"])
        index = len(seen_after)
        if index <= progress_events:
            return httpx.Response(
                200,
                stream=DisconnectingAsyncStream(_event_frame(RunStartedEvent(id=f"{index}-0", run_id="run-1"))),
            )
        return httpx.Response(200, content=_event_frame(_run_succeeded_event(event_id=f"{index}-0")))

    async def scenario() -> None:
        http_client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        client = Client(base_url="http://testserver", async_http_client=http_client)

        events = [event async for event in client.stream_events("run-1", max_reconnects=1, reconnect_delay_seconds=0)]

        assert seen_after == ["0-0", "1-0", "2-0", "3-0", "4-0", "5-0"]
        assert [event.type for event in events] == ["run_started"] * progress_events + ["run_succeeded"]
        await http_client.aclose()

    asyncio.run(scenario())


def test_async_stream_events_still_bounds_consecutive_reconnects_after_progress() -> None:
    """Only a delivered event restores spent retries; comment-only heartbeats do not."""
    seen_after: list[str] = []
    progress_event = RunStartedEvent(id="1-0", run_id="run-1")

    def handler(request: httpx.Request) -> httpx.Response:
        seen_after.append(request.url.params["after"])
        assert len(seen_after) <= 4, "heartbeats must not restore the reconnect budget"
        if len(seen_after) == 2:
            return httpx.Response(
                200,
                stream=DisconnectingAsyncStream(_event_frame(progress_event)),
            )
        return httpx.Response(200, stream=DisconnectingAsyncStream(": keepalive\n\n"))

    async def scenario() -> None:
        events: list[RunEvent] = []
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http_client:
            client = Client(base_url="http://testserver", async_http_client=http_client)
            with pytest.raises(DifyAgentStreamError, match="^SSE stream reconnect attempts exhausted$"):
                async for event in client.stream_events("run-1", max_reconnects=2, reconnect_delay_seconds=0):
                    events.append(event)

        assert seen_after == ["0-0", "0-0", "1-0", "1-0"]
        assert events == [progress_event]

    asyncio.run(scenario())


def test_async_stream_events_reconnects_after_eof_before_terminal() -> None:
    calls = 0

    def handler(_request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(200, content="")

    async def scenario() -> None:
        http_client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        client = Client(base_url="http://testserver", async_http_client=http_client)

        with pytest.raises(DifyAgentStreamError, match="reconnect attempts exhausted"):
            _ = [
                event
                async for event in client.stream_events(
                    "run-1",
                    max_reconnects=1,
                    reconnect_delay_seconds=0,
                )
            ]

        assert calls == 2
        await http_client.aclose()

    asyncio.run(scenario())


def test_async_sse_parser_preserves_unicode_line_separators() -> None:
    error = "next-line:\x85line-separator:\u2028paragraph-separator:\u2029done"
    body = _event_frame(_run_failed_event(error))

    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=body)

    async def scenario() -> None:
        http_client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        client = Client(base_url="http://testserver", async_http_client=http_client)

        events = [event async for event in client.stream_events("run-1")]

        assert len(events) == 1
        assert isinstance(events[0], RunFailedEvent)
        assert events[0].data.error == error
        await http_client.aclose()

    asyncio.run(scenario())


def test_async_stream_events_reconnects_after_http_5xx_response() -> None:
    seen_after: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen_after.append(request.url.params["after"])
        if len(seen_after) == 1:
            return httpx.Response(502, json={"detail": "bad gateway"})
        return httpx.Response(200, content=_event_frame(_run_succeeded_event()))

    async def scenario() -> None:
        http_client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        client = Client(base_url="http://testserver", async_http_client=http_client)

        events = [event async for event in client.stream_events("run-1", reconnect_delay_seconds=0)]

        assert seen_after == ["0-0", "0-0"]
        assert [event.type for event in events] == ["run_succeeded"]
        await http_client.aclose()

    asyncio.run(scenario())


def test_stream_timeout_can_reconnect_until_terminal() -> None:
    calls = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        if calls == 1:
            raise httpx.ReadTimeout("stream stalled", request=request)
        return httpx.Response(200, content=_event_frame(_run_succeeded_event()))

    client = Client(
        base_url="http://testserver",
        sync_http_client=httpx.Client(transport=httpx.MockTransport(handler)),
    )

    events = list(client.stream_events_sync("run-1", reconnect_delay_seconds=0))

    assert calls == 2
    assert [event.type for event in events] == ["run_succeeded"]


@pytest.mark.parametrize("sync", [False, True], ids=["async", "sync"])
def test_stream_read_timeouts_preserve_timeout_type_when_reconnects_are_exhausted(sync: bool) -> None:
    cursors: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        cursors.append(request.url.params["after"])

        def chunks() -> Iterator[bytes]:
            yield b": heartbeat\n\n"
            raise httpx.ReadTimeout("stream stalled", request=request)

        return httpx.Response(200, stream=ScriptedSSEStream(chunks()))

    transport = httpx.MockTransport(handler)

    async def read_async() -> list[RunEvent]:
        async with httpx.AsyncClient(transport=transport) as http_client:
            client = Client(base_url="http://testserver", async_http_client=http_client)
            return [event async for event in client.stream_events("run-1", max_reconnects=2, reconnect_delay_seconds=0)]

    with pytest.raises(DifyAgentTimeoutError, match=r"^SSE stream reconnect attempts exhausted$") as caught:
        if sync:
            with httpx.Client(transport=transport) as http_client:
                client = Client(base_url="http://testserver", sync_http_client=http_client)
                _ = list(client.stream_events_sync("run-1", max_reconnects=2, reconnect_delay_seconds=0))
        else:
            _ = asyncio.run(read_async())

    cause = caught.value.__cause__
    assert isinstance(cause, DifyAgentTimeoutError)
    assert str(cause) == "SSE stream timed out"
    assert cursors == ["0-0", "0-0", "0-0"]


def test_sync_home_snapshot_client_parses_null_snapshot_ref() -> None:
    """A backend that cannot snapshot reports explicit null; the client must
    preserve it instead of failing or fabricating a ref."""

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "POST"
        assert request.url.path == "/home-snapshots/from-binding"
        return httpx.Response(201, json={"snapshot_ref": None})

    http_client = httpx.Client(transport=httpx.MockTransport(handler))
    client = Client(base_url="http://testserver", sync_http_client=http_client)

    created = client.create_home_snapshot_from_binding_sync(_create_home_snapshot_from_binding_request())

    assert created.snapshot_ref is None
    http_client.close()


def test_async_home_snapshot_client_parses_null_snapshot_ref() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "POST"
        assert request.url.path == "/home-snapshots/from-binding"
        return httpx.Response(201, json={"snapshot_ref": None})

    async def scenario() -> None:
        http_client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        client = Client(base_url="http://testserver", async_http_client=http_client)

        created = await client.create_home_snapshot_from_binding(_create_home_snapshot_from_binding_request())

        assert created.snapshot_ref is None
        await http_client.aclose()

    asyncio.run(scenario())
