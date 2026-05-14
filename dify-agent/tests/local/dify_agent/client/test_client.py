from __future__ import annotations

import asyncio
import json
from collections.abc import Iterator
from datetime import UTC, datetime
from typing import cast, override

import httpx
import pytest

from agenton.compositor import CompositorSessionSnapshot
from agenton_collections.layers.plain import PLAIN_PROMPT_LAYER_TYPE_ID
from dify_agent.client import (
    Client,
    DifyAgentHTTPError,
    DifyAgentNotFoundError,
    DifyAgentStreamError,
    DifyAgentTimeoutError,
    DifyAgentValidationError,
)
from dify_agent.protocol.schemas import (
    CreateRunRequest,
    RUN_EVENT_ADAPTER,
    RunEvent,
    RunEventsResponse,
    RunStartedEvent,
    RunSucceededEvent,
    RunSucceededEventData,
)


def _create_run_payload() -> dict[str, object]:
    return {
        "composition": {
            "schema_version": 1,
            "layers": [{"name": "prompt", "type": PLAIN_PROMPT_LAYER_TYPE_ID, "config": {"user": "hello"}}],
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
        data=RunSucceededEventData(output="done", session_snapshot=CompositorSessionSnapshot(layers=[])),
    )


def _run_status_json(status: str) -> dict[str, object]:
    now = datetime(2026, 5, 11, tzinfo=UTC).isoformat()
    return {"run_id": "run-1", "status": status, "created_at": now, "updated_at": now, "error": None}


class DisconnectingSyncStream(httpx.SyncByteStream):
    chunks: list[bytes]

    def __init__(self, *chunks: str) -> None:
        self.chunks = [chunk.encode() for chunk in chunks]

    @override
    def __iter__(self) -> Iterator[bytes]:
        yield from self.chunks
        raise httpx.ReadError("stream disconnected")


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
        raise AssertionError(f"unexpected request: {request.method} {request.url}")

    http_client = httpx.Client(transport=httpx.MockTransport(handler))
    client = Client(base_url="http://testserver", sync_http_client=http_client)

    created = client.create_run_sync(CreateRunRequest.model_validate(_create_run_payload()))
    status = client.get_run_sync(created.run_id)
    events = client.get_events_sync(created.run_id, after="0-0", limit=10)

    assert created.status == "running"
    assert status.status == "running"
    assert isinstance(events, RunEventsResponse)
    assert [event.type for event in events.events] == ["run_started"]


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


def test_stream_events_reconnects_from_latest_event_id() -> None:
    seen_after: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen_after.append(request.url.params["after"])
        if len(seen_after) == 1:
            return httpx.Response(
                200,
                stream=DisconnectingSyncStream(_event_frame(RunStartedEvent(id="1-0", run_id="run-1"))),
            )
        return httpx.Response(200, content=_event_frame(_run_succeeded_event()))

    client = Client(
        base_url="http://testserver",
        sync_http_client=httpx.Client(transport=httpx.MockTransport(handler)),
    )

    events = list(client.stream_events_sync("run-1", reconnect_delay_seconds=0))

    assert seen_after == ["0-0", "1-0"]
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


def test_async_stream_events_yields_terminal_event() -> None:
    body = _event_frame(_run_succeeded_event())

    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=body)

    async def scenario() -> None:
        http_client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        client = Client(base_url="http://testserver", async_http_client=http_client)

        events = [event async for event in client.stream_events("run-1")]

        assert [event.type for event in events] == ["run_succeeded"]
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
