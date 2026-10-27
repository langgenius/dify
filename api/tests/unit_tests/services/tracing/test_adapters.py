from datetime import UTC, datetime
from typing import override

import pytest
from dify_trace_sdk.events import ModerationChecked, TraceCorrelation, TraceEvent, WorkflowRunCompleted
from dify_trace_sdk.model import Span, SpanKind, SpanStatus, Trace

from services.app_tracing_config_service import AppTraceSettings
from services.tracing import adapters
from services.tracing.adapters import (
    AGENT_TRACE_EXPORT_TASK,
    DELIVER_TASK,
    INLINE_EVENT_BYTES,
    RETRY_TASK,
    TRACE_QUEUE,
    WORKFLOW_SETTLE_SECONDS,
    CeleryExportRetryQueue,
    CeleryTraceEmitter,
    StoredPolicyTraceScopes,
    payload_key,
    schedule_agent_trace_export,
)
from services.tracing.delivery import ExportJob
from services.tracing.scopes import TraceScopes, TracingPolicyQuery

STARTED_AT = datetime(2026, 3, 4, 5, 6, tzinfo=UTC)
CORRELATION = TraceCorrelation(
    external_trace_id=None, session_id=None, parent_workflow_run_id=None, parent_node_execution_id=None
)


class _Broker:
    def __init__(self) -> None:
        self.sent: list[tuple[str, tuple[object, ...], str]] = []
        self.countdowns: list[int] = []

    def send_task(self, name: str, *, args: tuple[object, ...], queue: str, countdown: int = 0) -> None:
        self.sent.append((name, args, queue))
        self.countdowns.append(countdown)


class _Storage:
    def __init__(self) -> None:
        self.files: dict[str, bytes] = {}

    def save(self, key: str, data: bytes) -> None:
        self.files[key] = data


class _Recorder:
    def __init__(self) -> None:
        self.events: list[TraceEvent] = []

    def emit(self, event: TraceEvent) -> None:
        self.events.append(event)


class _NoPolicies(TracingPolicyQuery):
    @override
    def policy(self, *, tenant_id: str, app_id: str) -> AppTraceSettings | None:
        raise AssertionError("an execution that holds its policy must not read it again")


@pytest.fixture
def broker(monkeypatch: pytest.MonkeyPatch) -> _Broker:
    broker = _Broker()
    monkeypatch.setattr(adapters, "celery_app", broker)
    return broker


@pytest.fixture
def storage(monkeypatch: pytest.MonkeyPatch) -> _Storage:
    storage = _Storage()
    monkeypatch.setattr(adapters, "storage", storage)
    return storage


def _event(query: str) -> TraceEvent:
    return TraceEvent(
        event_id="event-1",
        tenant_id="tenant-1",
        app_id="app-1",
        user_id=None,
        occurred_at=STARTED_AT,
        correlation=CORRELATION,
        payload=ModerationChecked(
            message_id="message-1",
            inputs={},
            query=query,
            flagged=False,
            action="direct_output",
            preset_response="",
            started_at=STARTED_AT,
            ended_at=STARTED_AT,
        ),
    )


def test_small_events_travel_inline(broker: _Broker, storage: _Storage) -> None:
    event = _event("hello")

    CeleryTraceEmitter().emit(event)

    ((name, (envelope,), queue),) = broker.sent
    assert (name, queue) == (DELIVER_TASK, TRACE_QUEUE)
    assert isinstance(envelope, dict)
    assert TraceEvent.model_validate_json(envelope["event"]) == event
    assert storage.files == {}


def test_large_events_travel_through_storage(broker: _Broker, storage: _Storage) -> None:
    event = _event("x" * INLINE_EVENT_BYTES)

    CeleryTraceEmitter().emit(event)

    ((_, (envelope,), _),) = broker.sent
    assert envelope == {"payload_key": payload_key(event.occurred_at, "events", "event-1")}
    assert payload_key(event.occurred_at, "events", "event-1") == "trace_payloads/2026-03-04/events/event-1.json"
    assert TraceEvent.model_validate_json(storage.files["trace_payloads/2026-03-04/events/event-1.json"]) == event


@pytest.mark.usefixtures("storage")
def test_inline_size_is_measured_in_bytes(broker: _Broker) -> None:
    CeleryTraceEmitter().emit(_event("中" * (INLINE_EVENT_BYTES // 2)))

    ((_, (envelope,), _),) = broker.sent
    assert isinstance(envelope, dict)
    assert "payload_key" in envelope


@pytest.mark.usefixtures("storage")
def test_workflow_runs_wait_for_node_executions_to_land(broker: _Broker) -> None:
    workflow = _event("hello").model_copy(
        update={"payload": WorkflowRunCompleted(workflow_run_id="run-1", conversation_id=None, total_tokens=0)}
    )

    CeleryTraceEmitter().emit(_event("hello"))
    CeleryTraceEmitter().emit(workflow)

    assert broker.countdowns == [0, WORKFLOW_SETTLE_SECONDS]


def test_export_retries_persist_the_trace_and_run_after_their_delay(broker: _Broker, storage: _Storage) -> None:
    job = ExportJob(
        tenant_id="tenant-1",
        app_id="app-1",
        provider_id="langfuse",
        attempt=2,
        trace=Trace(
            trace_id="a" * 32,
            external_trace_id=None,
            session_id=None,
            user_id=None,
            parent=None,
            spans=(
                Span(
                    span_id="b" * 16,
                    parent_span_id=None,
                    name="message",
                    kind=SpanKind.CHAIN,
                    start_time=STARTED_AT,
                    end_time=STARTED_AT,
                    status=SpanStatus.OK,
                ),
            ),
        ),
    )

    CeleryExportRetryQueue().schedule(job, delay_seconds=20)

    ((name, (key,), queue),) = broker.sent
    assert (name, queue, broker.countdowns) == (RETRY_TASK, TRACE_QUEUE, [20])
    assert isinstance(key, str)
    assert key.startswith("trace_payloads/")
    assert "/exports/" in key
    assert ExportJob.model_validate_json(storage.files[key]) == job


def test_agent_trace_exports_run_on_the_trace_queue(broker: _Broker) -> None:
    schedule_agent_trace_export("run-1")

    assert broker.sent == [(AGENT_TRACE_EXPORT_TASK, ("run-1",), TRACE_QUEUE)]


@pytest.mark.parametrize(
    ("stored", "traced"),
    [
        ('{"enabled": true, "tracing_provider": "langfuse"}', True),
        ('{"enabled": "true", "tracing_provider": "langfuse"}', False),
        ("not json", False),
        (None, False),
    ],
    ids=["enabled", "not-a-boolean", "unparsable", "unset"],
)
def test_legacy_producers_hand_over_the_raw_stored_policy(stored: str | None, traced: bool) -> None:
    recorder = _Recorder()
    scopes = StoredPolicyTraceScopes(
        TraceScopes(emitter=recorder, policies=_NoPolicies(), enterprise_enabled=lambda: False)
    )

    scope = scopes.for_execution(
        tenant_id="tenant-1", app_id="app-1", app_tracing=stored, user_id=None, correlation=CORRELATION
    )

    assert (scope is not None) is traced
