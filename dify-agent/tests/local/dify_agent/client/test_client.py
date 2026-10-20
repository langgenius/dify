from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator, Iterator
from datetime import UTC, datetime
from typing import cast, override

import httpx
import pytest

from dify_agent.protocol.snapshot import SessionSnapshot
from dify_agent.layers.execution_context import DifyExecutionContextLayerConfig
from dify_agent.client import _client as client_module
from dify_agent.client import (
    Client,
    DifyAgentHTTPError,
    DifyAgentNotFoundError,
    DifyAgentStreamError,
    DifyAgentTimeoutError,
    DifyAgentValidationError,
)
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

    @override
    async def __aiter__(self) -> AsyncIterator[bytes]:
        for chunk in self.chunks:
            yield chunk
        raise httpx.ReadError("stream disconnected")


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


def test_cancel_run_and_wait_async_returns_cancelled_terminal() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "POST":
            return httpx.Response(202, json={"run_id": "run-1", "status": "cancelled"})
        if request.url.path == "/runs/run-1":
            return httpx.Response(200, json=_run_status_json("running"))
        assert request.url.params["after"] == "1-0"
        return httpx.Response(200, content=_event_frame(RunCancelledEvent(id="2-0", run_id="run-1")))

    async def scenario() -> None:
        http_client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        client = Client(base_url="http://testserver", async_http_client=http_client)
        event = await client.cancel_run_and_wait("run-1", after="1-0")
        assert event.type == "run_cancelled"
        await http_client.aclose()

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


def test_stream_events_observes_caller_stop_on_heartbeat() -> None:
    stop_checks = 0

    def should_stop() -> bool:
        nonlocal stop_checks
        stop_checks += 1
        return stop_checks >= 2

    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=": keepalive\n\n")

    client = Client(
        base_url="http://testserver",
        sync_http_client=httpx.Client(transport=httpx.MockTransport(handler)),
    )

    with pytest.raises(DifyAgentStreamError, match="cancelled by the caller"):
        _ = list(client.stream_events_sync("run-1", should_stop=should_stop))
    assert stop_checks == 2


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


def test_async_stream_events_does_not_reconnect_after_terminal_when_until_terminal_is_false() -> None:
    calls = 0

    def handler(_request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(200, content=_event_frame(_run_succeeded_event()))

    async def scenario() -> None:
        http_client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        client = Client(base_url="http://testserver", async_http_client=http_client)

        events = [event async for event in client.stream_events("run-1", until_terminal=False)]

        assert [event.type for event in events] == ["run_succeeded"]
        assert calls == 1
        await http_client.aclose()

    asyncio.run(scenario())


def test_async_stream_events_does_not_reconnect_after_terminal_transport_error() -> None:
    calls = 0

    def handler(_request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(200, stream=DisconnectingAsyncStream(_event_frame(_run_succeeded_event())))

    async def scenario() -> None:
        http_client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        client = Client(base_url="http://testserver", async_http_client=http_client)

        events = [event async for event in client.stream_events("run-1", until_terminal=False)]

        assert [event.type for event in events] == ["run_succeeded"]
        assert calls == 1
        await http_client.aclose()

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


# Private checkpoint readback tests use real HTTPX streams; no backend ACK claim.
def _private_checkpoint_request():
    from dify_agent.protocol.native_continuation import ReadNativeCheckpointRequest

    return ReadNativeCheckpointRequest.model_validate(
        {
            "ref": {
                "policy_version": "builder-native-test-v1",
                "request_id": "req",
                "invocation_id": "inv",
                "context_digest": "a" * 64,
            },
            "expected_generation": 7,
            "waiting_event_id": "123-1",
            "config_ref": "config",
            "config_digest": "b" * 64,
        }
    )


def _private_checkpoint_response():
    from dify_agent.protocol.native_continuation import AgentCheckpoint

    cp = AgentCheckpoint.model_validate(
        {
            "run_id": "run-1",
            "generation": 7,
            "ref": _private_checkpoint_request().ref.model_dump(mode="json"),
            "stage": "bootstrap",
            "pending_calls": [
                {
                    "call_id": "c",
                    "tool_name": "boot",
                    "stage": "bootstrap",
                    "pending_operation_id": "p",
                    "wait_reason": "configuration",
                    "intent": {
                        "key": {"invocation_id": "inv", "occurrence_path": ["boot"], "cursor": 0},
                        "kind": "bootstrap",
                        "resource_ref": "r",
                        "implementation_revision": "v",
                        "account_ref": None,
                        "target": {},
                        "parameters": [True, 1],
                        "input_digest": "c" * 64,
                        "capability_digest": "d" * 64,
                    },
                }
            ],
            "history": [],
            "operation_cursor": 0,
            "result_refs": {},
            "job_refs": [],
            "config_ref": "config",
            "config_digest": "b" * 64,
            "session_snapshot": {"schema_version": 2, "layers": {}},
        }
    )
    return {
        "checkpoint": cp.model_dump(mode="json"),
        "waiting_event": cp.waiting_event().model_copy(update={"id": "123-1"}).model_dump(mode="json"),
    }


@pytest.mark.parametrize("asynchronous", [False, True])
def test_private_checkpoint_read_sends_exact_selection_once_and_preserves_types(asynchronous):
    calls = []

    def handler(request):
        calls.append(request)
        assert request.url.path == "/runs/run-1/native-checkpoint"
        assert request.method == "POST"
        assert request.headers["Authorization"] == "Bearer synthetic-service-token"
        assert json.loads(request.content)["expected_generation"] == 7
        return httpx.Response(200, json=_private_checkpoint_response())

    if asynchronous:

        async def run():
            async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
                async with Client(
                    base_url="http://synthetic.invalid",
                    async_http_client=http,
                    headers={"Authorization": "Bearer synthetic-service-token"},
                ) as client:
                    return await client.read_native_checkpoint("run-1", _private_checkpoint_request())

        result = asyncio.run(run())
    else:
        with httpx.Client(transport=httpx.MockTransport(handler)) as http:
            with Client(
                base_url="http://synthetic.invalid",
                sync_http_client=http,
                headers={"Authorization": "Bearer synthetic-service-token"},
            ) as client:
                result = client.read_native_checkpoint_sync("run-1", _private_checkpoint_request())
    assert result.checkpoint.generation == 7
    assert result.checkpoint.pending_calls[0].intent.parameters == [True, 1]
    assert result.waiting_event.id == "123-1"
    assert len(calls) == 1


@pytest.mark.parametrize("asynchronous", [False, True])
@pytest.mark.parametrize(
    "failure",
    [
        "timeout",
        "connect",
        "error",
        "invalid",
        "oversize",
        "wrong_run",
        "wrong_event",
        "wrong_generation",
        "wrong_config",
        "wrong_ref",
    ],
)
def test_private_checkpoint_client_refuses_without_retry_or_history_leak(asynchronous, failure):
    calls = []

    def handler(request):
        calls.append(request)
        if failure == "timeout":
            raise httpx.ReadTimeout("private-canary", request=request)
        if failure == "connect":
            raise httpx.ConnectError("private-canary", request=request)
        if failure == "error":
            return httpx.Response(409, json={"history": "private-canary"})
        if failure == "invalid":
            return httpx.Response(200, content=b'{"private-canary":true}')
        if failure == "oversize":
            return httpx.Response(200, content=b"private-canary" * 200000)
        body = _private_checkpoint_response()
        if failure == "wrong_run":
            body["checkpoint"]["run_id"] = "foreign"
        if failure == "wrong_event":
            body["waiting_event"]["id"] = "124-1"
        if failure == "wrong_generation":
            body["checkpoint"]["generation"] = 6
            body["waiting_event"]["data"]["generation"] = 6
        if failure == "wrong_config":
            body["checkpoint"]["config_ref"] = "other"
        if failure == "wrong_ref":
            body["checkpoint"]["ref"]["request_id"] = "other"
        return httpx.Response(200, json=body)

    if asynchronous:

        async def run():
            async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
                async with Client(base_url="http://synthetic.invalid", async_http_client=http) as client:
                    await client.read_native_checkpoint("run-1", _private_checkpoint_request())

        with pytest.raises((DifyAgentHTTPError, client_module.DifyAgentClientError)) as caught:
            asyncio.run(run())
    else:
        with httpx.Client(transport=httpx.MockTransport(handler)) as http:
            with Client(base_url="http://synthetic.invalid", sync_http_client=http) as client:
                with pytest.raises((DifyAgentHTTPError, client_module.DifyAgentClientError)) as caught:
                    client.read_native_checkpoint_sync("run-1", _private_checkpoint_request())
    assert "private-canary" not in str(caught.value)
    assert "private-canary" not in str(getattr(caught.value, "detail", ""))
    assert len(calls) == 1


@pytest.mark.parametrize("asynchronous", [False, True])
def test_private_checkpoint_stream_bound_counts_actual_bytes_without_content_length(asynchronous):
    pulls = []

    class SyncChunks(httpx.SyncByteStream):
        def __iter__(self):
            for index in range(100):
                pulls.append(index)
                yield b"x" * 65536

    class AsyncChunks(httpx.AsyncByteStream):
        async def __aiter__(self):
            for index in range(100):
                pulls.append(index)
                yield b"x" * 65536

    def handler(request):
        return httpx.Response(200, stream=AsyncChunks() if asynchronous else SyncChunks())

    if asynchronous:

        async def run():
            async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
                async with Client(base_url="http://synthetic.invalid", async_http_client=http) as client:
                    await client.read_native_checkpoint("run-1", _private_checkpoint_request())

        with pytest.raises(DifyAgentValidationError):
            asyncio.run(run())
    else:
        with httpx.Client(transport=httpx.MockTransport(handler)) as http:
            with Client(base_url="http://synthetic.invalid", sync_http_client=http) as client:
                with pytest.raises(DifyAgentValidationError):
                    client.read_native_checkpoint_sync("run-1", _private_checkpoint_request())
    assert len(pulls) == 33  # Read the bounded excess chunk, then close; never drain the 100 chunks.


@pytest.mark.parametrize("asynchronous", [False, True])
def test_private_checkpoint_never_follows_transport_redirects(asynchronous):
    requests = []

    def handler(request):
        requests.append(request)
        if len(requests) == 1:
            return httpx.Response(307, headers={"Location": "http://foreign.invalid/private"})
        return httpx.Response(200, json=_private_checkpoint_response())

    if asynchronous:

        async def run():
            async with httpx.AsyncClient(transport=httpx.MockTransport(handler), follow_redirects=True) as http:
                async with Client(base_url="http://synthetic.invalid", async_http_client=http) as client:
                    await client.read_native_checkpoint("run-1", _private_checkpoint_request())

        with pytest.raises(DifyAgentValidationError):
            asyncio.run(run())
    else:
        with httpx.Client(transport=httpx.MockTransport(handler), follow_redirects=True) as http:
            with Client(base_url="http://synthetic.invalid", sync_http_client=http) as client:
                with pytest.raises(DifyAgentValidationError):
                    client.read_native_checkpoint_sync("run-1", _private_checkpoint_request())
    assert len(requests) == 1


def test_private_checkpoint_invalid_copied_request_refuses_without_serializer_warning():
    import warnings

    attempts = []

    def handler(request):
        attempts.append(request)
        return httpx.Response(500)

    invalid = _private_checkpoint_request().model_copy(update={"config_ref": {"private-canary": True}})
    with httpx.Client(transport=httpx.MockTransport(handler)) as http:
        with Client(base_url="http://synthetic.invalid", sync_http_client=http) as client:
            with warnings.catch_warnings(record=True) as emitted:
                warnings.simplefilter("always")
                with pytest.raises(DifyAgentValidationError) as caught:
                    client.read_native_checkpoint_sync("run-1", invalid)
    assert "private-canary" not in str(caught.value)
    assert emitted == []
    assert attempts == []
