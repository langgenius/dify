import logging

import pytest
from dify_trace_sdk.emitter import TraceScope
from dify_trace_sdk.events import MessageCompleted, TraceCorrelation, TraceEvent

CORRELATION = TraceCorrelation(external_trace_id="caller-1", session_id=None, parent=None)


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
