from __future__ import annotations

import time
from collections.abc import Iterator
from threading import Event

import httpx
import pytest

from clients.a2a import (
    A2AAgentInterface,
    A2AClient,
    A2AProtocolError,
    A2ARemoteError,
    A2ATaskState,
    A2ATransportError,
)
from clients.a2a import client as client_module


def _response(status_code: int, *, json: object | None = None, content: bytes | None = None) -> httpx.Response:
    request = httpx.Request("GET", "https://agent.example")
    if json is not None:
        return httpx.Response(status_code, json=json, request=request)
    return httpx.Response(status_code, content=content or b"", request=request)


class FakeHTTPClient:
    def __init__(self, responses: Iterator[httpx.Response]) -> None:
        self._responses = responses
        self.calls: list[tuple[str, str, dict[str, object]]] = []

    def get(self, url: str, max_retries: int = 0, **kwargs: object) -> httpx.Response:
        del max_retries
        self.calls.append(("GET", url, kwargs))
        return next(self._responses)

    def post(self, url: str, max_retries: int = 0, **kwargs: object) -> httpx.Response:
        del max_retries
        self.calls.append(("POST", url, kwargs))
        return next(self._responses)


class BlockingByteStream(httpx.SyncByteStream):
    def __init__(self) -> None:
        self.started = Event()
        self.closed = Event()

    def __iter__(self) -> Iterator[bytes]:
        self.started.set()
        self.closed.wait(timeout=5)
        if not self.closed.is_set():
            yield b""

    def close(self) -> None:
        self.closed.set()


def _card() -> dict[str, object]:
    return {
        "name": "Codex",
        "description": "Local coding agent",
        "supportedInterfaces": [
            {
                "url": "http://127.0.0.1:8765",
                "protocolBinding": "HTTP+JSON",
                "protocolVersion": "1.0",
            }
        ],
        "version": "1.0.0",
        "capabilities": {"streaming": True},
        "defaultInputModes": ["text/plain"],
        "defaultOutputModes": ["text/plain", "application/json"],
        "skills": [
            {
                "id": "coding",
                "name": "Coding",
                "description": "Work in a local repository",
                "tags": ["code"],
            }
        ],
    }


def test_discover_agent_card_from_base_url() -> None:
    transport = FakeHTTPClient(iter([_response(200, json=_card())]))
    client = A2AClient("https://agent.example/a2a", http_client=transport)

    card = client.discover()

    assert card.name == "Codex"
    assert card.preferred_http_interface().protocol_version == "1.0"
    assert transport.calls[0][1] == "https://agent.example/a2a/.well-known/agent-card.json"


def test_stream_message_parses_protojson_sse_events() -> None:
    stream = b"".join(
        [
            b'data: {"task":{"id":"task-1","contextId":"ctx-1","status":{"state":"TASK_STATE_WORKING"}}}\n\n',
            b'data: {"artifactUpdate":{"taskId":"task-1","contextId":"ctx-1",'
            b'"artifact":{"artifactId":"answer","parts":[{"text":"done","mediaType":"text/plain"}]},'
            b'"lastChunk":true}}\n\n',
            b'data: {"statusUpdate":{"taskId":"task-1","contextId":"ctx-1",'
            b'"status":{"state":"TASK_STATE_COMPLETED"}}}\n\n',
        ]
    )
    transport = FakeHTTPClient(iter([_response(200, content=stream)]))
    client = A2AClient("https://agent.example", bearer_token="secret", http_client=transport)
    interface = _interface()

    events = list(client.stream_message(interface=interface, text="Fix the tests"))

    assert events[0].task is not None
    assert events[0].task.status.state == A2ATaskState.WORKING
    assert events[1].artifact_update is not None
    assert events[1].artifact_update.artifact.parts[0].text == "done"
    assert events[2].status_update is not None
    assert events[2].status_update.status.state == A2ATaskState.COMPLETED
    _, url, kwargs = transport.calls[0]
    assert url == "http://127.0.0.1:8765/message:stream"
    assert kwargs["headers"]["Authorization"] == "Bearer secret"
    assert kwargs["headers"]["Accept-Encoding"] == "identity"
    assert kwargs["headers"]["Content-Type"] == "application/a2a+json"
    assert kwargs["json"]["message"]["parts"][0]["text"] == "Fix the tests"


def test_stream_message_maps_streaming_http_error_without_reading_unbounded_body() -> None:
    request = httpx.Request("POST", "https://agent.example/message:stream")
    response = httpx.Response(
        401,
        stream=httpx.ByteStream(b"invalid token"),
        request=request,
    )
    transport = FakeHTTPClient(iter([response]))
    client = A2AClient("https://agent.example", http_client=transport)

    with pytest.raises(A2ARemoteError, match="HTTP 401") as exc_info:
        list(client.stream_message(interface=_interface(), text="hello"))
    assert "invalid token" not in str(exc_info.value)


def test_stream_message_rejects_non_identity_content_encoding() -> None:
    request = httpx.Request("POST", "https://agent.example/message:stream")
    response = httpx.Response(
        200,
        headers={"Content-Encoding": "gzip"},
        stream=httpx.ByteStream(b"not actually gzip"),
        request=request,
    )
    transport = FakeHTTPClient(iter([response]))
    client = A2AClient("https://agent.example", http_client=transport)

    with pytest.raises(A2AProtocolError, match="non-identity Content-Encoding"):
        list(client.stream_message(interface=_interface(), text="hello"))
    assert response.is_closed


def test_stream_message_rejects_oversized_sse_event() -> None:
    stream = b"data: " + (b"x" * (1024 * 1024 + 1)) + b"\n\n"
    transport = FakeHTTPClient(iter([_response(200, content=stream)]))
    client = A2AClient("https://agent.example", http_client=transport)

    with pytest.raises(A2AProtocolError, match="oversized"):
        list(client.stream_message(interface=_interface(), text="hello"))


def test_stream_message_enforces_total_stream_size(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(client_module, "_SSE_STREAM_MAX_BYTES", 32)
    stream = b": heartbeat that is deliberately too large\n\n"
    transport = FakeHTTPClient(iter([_response(200, content=stream)]))
    client = A2AClient("https://agent.example", http_client=transport)

    with pytest.raises(A2AProtocolError, match="event stream"):
        list(client.stream_message(interface=_interface(), text="hello"))


def test_stream_message_checks_deadline_before_heartbeat_activity() -> None:
    stream = b": heartbeat\n\n"
    transport = FakeHTTPClient(iter([_response(200, content=stream)]))
    client = A2AClient("https://agent.example", http_client=transport)
    activities: list[bool] = []

    with pytest.raises(A2ATransportError, match="deadline"):
        list(
            client.stream_message(
                interface=_interface(),
                text="hello",
                deadline_monotonic=0,
                on_activity=lambda: activities.append(True),
            )
        )
    assert activities == []


def test_stream_message_deadline_interrupts_silent_peer() -> None:
    stream = BlockingByteStream()
    request = httpx.Request("POST", "https://agent.example/message:stream")
    response = httpx.Response(200, stream=stream, request=request)
    transport = FakeHTTPClient(iter([response]))
    client = A2AClient("https://agent.example", http_client=transport)
    started_at = time.monotonic()

    with pytest.raises(A2ATransportError, match="deadline"):
        list(
            client.stream_message(
                interface=_interface(),
                text="hello",
                deadline_monotonic=time.monotonic() + 0.05,
            )
        )

    assert time.monotonic() - started_at < 1
    assert stream.started.is_set()
    assert stream.closed.wait(timeout=0.5)


def test_stream_message_stop_check_interrupts_silent_peer() -> None:
    class StopRequestedError(Exception):
        pass

    stream = BlockingByteStream()
    request = httpx.Request("POST", "https://agent.example/message:stream")
    response = httpx.Response(200, stream=stream, request=request)
    transport = FakeHTTPClient(iter([response]))
    client = A2AClient("https://agent.example", http_client=transport)
    stop_at = time.monotonic() + 0.05
    started_at = time.monotonic()

    def check_stop() -> None:
        if time.monotonic() >= stop_at:
            raise StopRequestedError

    with pytest.raises(StopRequestedError):
        list(
            client.stream_message(
                interface=_interface(),
                text="hello",
                deadline_monotonic=time.monotonic() + 5,
                on_activity=check_stop,
            )
        )

    assert time.monotonic() - started_at < 1
    assert stream.started.is_set()
    assert stream.closed.wait(timeout=0.5)


def test_tenant_is_sent_in_request_field_and_http_binding_path() -> None:
    response = _response(
        200,
        json={
            "task": {
                "id": "task-1",
                "contextId": "context-1",
                "status": {"state": "TASK_STATE_COMPLETED"},
            }
        },
    )
    transport = FakeHTTPClient(iter([response]))
    client = A2AClient("https://agent.example", http_client=transport)
    interface = _interface().model_copy(update={"tenant": "tenant-a"})

    client.send_message(interface=interface, text="hello", return_immediately=True)

    _, url, kwargs = transport.calls[0]
    assert url == "http://127.0.0.1:8765/tenant-a/message:send"
    assert kwargs["json"]["tenant"] == "tenant-a"
    assert kwargs["json"]["configuration"]["returnImmediately"] is True


def _interface() -> A2AAgentInterface:
    return A2AAgentInterface(
        url="http://127.0.0.1:8765",
        protocolBinding="HTTP+JSON",
        protocolVersion="1.0",
    )
