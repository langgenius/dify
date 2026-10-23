import logging

import httpx
import pytest
from dify_trace_sdk.emitter import TraceScope
from dify_trace_sdk.events import MessageCompleted, TraceCorrelation, TraceEvent
from dify_trace_sdk.testing import RecordingEgress, response
from dify_trace_sdk.transports import EgressHttpxTransport, EgressRequestsSession

CORRELATION = TraceCorrelation(
    external_trace_id="caller-1", session_id=None, parent_workflow_run_id=None, parent_node_execution_id=None
)


def test_httpx_transport_routes_sdk_requests_through_egress() -> None:
    egress = RecordingEgress([response(201, {"ok": True})], grpc_target=None)
    with httpx.Client(transport=EgressHttpxTransport(egress)) as client:
        result = client.post("https://api.example.com/v1/items", json={"a": 1})
    assert result.status_code == 201
    assert result.json() == {"ok": True}
    (sent,) = egress.requests
    assert sent.method == "POST"
    assert sent.json() == {"a": 1}


def test_requests_session_routes_sdk_requests_through_egress() -> None:
    egress = RecordingEgress([response(200, {"ok": True})], grpc_target=None)
    session = EgressRequestsSession(egress)
    result = session.post("https://api.example.com/v1/items", json={"a": 1})
    assert result.json() == {"ok": True}
    assert egress.requests[0].url == "https://api.example.com/v1/items"
    assert session.trust_env is False


class _CollectingEmitter:
    def __init__(self) -> None:
        self.events: list[TraceEvent] = []

    def emit(self, event: TraceEvent) -> None:
        self.events.append(event)


class _BrokenEmitter:
    def emit(self, event: TraceEvent) -> None:
        raise RuntimeError("broker down")


def test_scope_stamps_owner_and_correlation() -> None:
    emitter = _CollectingEmitter()
    scope = TraceScope(emitter=emitter, tenant_id="t", app_id="a", user_id="u", correlation=CORRELATION)
    scope.emit(MessageCompleted(message_id="m", conversation_id="c"))
    (event,) = emitter.events
    assert (event.tenant_id, event.app_id, event.user_id) == ("t", "a", "u")
    assert event.correlation == CORRELATION
    assert event.payload == MessageCompleted(message_id="m", conversation_id="c")
    assert TraceEvent.model_validate_json(event.model_dump_json()) == event


def test_scope_never_raises_into_the_producer(caplog: pytest.LogCaptureFixture) -> None:
    scope = TraceScope(emitter=_BrokenEmitter(), tenant_id="t", app_id="a", user_id=None, correlation=CORRELATION)
    with caplog.at_level(logging.WARNING):
        scope.emit(MessageCompleted(message_id="m", conversation_id=None))
    assert "Trace event dropped" in caplog.text
