from datetime import UTC, datetime

import pytest
from dify_trace_sdk.events import ModerationChecked, TraceCorrelation, TraceEvent, WorkflowRunCompleted
from sqlalchemy.orm import sessionmaker

from core.helper.trace_id_helper import ParentTraceContext
from services.tracing import emitter
from services.tracing.emitter import (
    DELIVER_TASK,
    INLINE_EVENT_BYTES,
    TRACE_QUEUE,
    WORKFLOW_SETTLE_SECONDS,
    CeleryTraceEmitter,
    TraceScopes,
    correlation_from_extras,
    payload_key,
    tracing_policy_enabled,
)


class _Broker:
    def __init__(self) -> None:
        self.sent: list[tuple[str, tuple[dict[str, str]], str]] = []
        self.countdowns: list[int] = []

    def send_task(self, name: str, *, args: tuple[dict[str, str]], queue: str, countdown: int) -> None:
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


def _event(query: str) -> TraceEvent:
    started_at = datetime(2026, 3, 4, 5, 6, tzinfo=UTC)
    return TraceEvent(
        event_id="event-1",
        tenant_id="tenant-1",
        app_id="app-1",
        user_id=None,
        occurred_at=started_at,
        correlation=TraceCorrelation(
            external_trace_id=None, session_id=None, parent_workflow_run_id=None, parent_node_execution_id=None
        ),
        payload=ModerationChecked(
            message_id="message-1",
            inputs={},
            query=query,
            flagged=False,
            action="direct_output",
            preset_response="",
            started_at=started_at,
            ended_at=started_at,
        ),
    )


@pytest.mark.parametrize(
    ("policy", "enabled"),
    [
        ('{"enabled": true, "tracing_provider": "langfuse"}', True),
        ('{"enabled": false, "tracing_provider": "langfuse"}', False),
        ('{"enabled": true, "tracing_provider": null}', False),
        ("not json", False),
        (None, False),
    ],
)
def test_tracing_policy(policy: str | None, enabled: bool) -> None:
    assert tracing_policy_enabled(policy) is enabled


def test_correlation_reads_the_caller_extras() -> None:
    nested = correlation_from_extras(
        {
            "external_trace_id": "caller-trace",
            "trace_session_id": "session-1",
            "parent_trace_context": {"parent_workflow_run_id": "outer-run", "parent_node_execution_id": "outer-node"},
        }
    )
    typed = correlation_from_extras(
        {"parent_trace_context": ParentTraceContext(parent_workflow_run_id="outer-run", parent_node_execution_id=None)}
    )

    assert nested == TraceCorrelation(
        external_trace_id="caller-trace",
        session_id="session-1",
        parent_workflow_run_id="outer-run",
        parent_node_execution_id="outer-node",
    )
    assert typed.parent_workflow_run_id == "outer-run"
    assert correlation_from_extras({"external_trace_id": "", "parent_trace_context": {"x": 1}}) == TraceCorrelation(
        external_trace_id=None, session_id=None, parent_workflow_run_id=None, parent_node_execution_id=None
    )


def test_small_events_travel_inline(monkeypatch: pytest.MonkeyPatch) -> None:
    broker, storage = _Broker(), _Storage()
    monkeypatch.setattr(emitter, "celery_app", broker)
    monkeypatch.setattr(emitter, "storage", storage)
    event = _event("hello")

    CeleryTraceEmitter().emit(event)

    ((name, (envelope,), queue),) = broker.sent
    assert (name, queue) == (DELIVER_TASK, TRACE_QUEUE)
    assert TraceEvent.model_validate_json(envelope["event"]) == event
    assert storage.files == {}


def test_large_events_travel_through_storage(monkeypatch: pytest.MonkeyPatch) -> None:
    broker, storage = _Broker(), _Storage()
    monkeypatch.setattr(emitter, "celery_app", broker)
    monkeypatch.setattr(emitter, "storage", storage)
    event = _event("x" * INLINE_EVENT_BYTES)

    CeleryTraceEmitter().emit(event)

    ((_, (envelope,), _),) = broker.sent
    assert envelope == {"payload_key": payload_key(event.occurred_at, "events", "event-1")}
    assert envelope["payload_key"] == "trace_payloads/2026-03-04/events/event-1.json"
    assert TraceEvent.model_validate_json(storage.files[envelope["payload_key"]]) == event


def _scopes(*, enterprise: bool) -> tuple[TraceScopes, _Recorder]:
    recorder = _Recorder()
    return TraceScopes(
        emitter=recorder, session_factory=sessionmaker(), enterprise_enabled=lambda: enterprise
    ), recorder


def test_no_scope_exists_when_nothing_consumes_the_events() -> None:
    scopes, _ = _scopes(enterprise=False)

    assert scopes(tenant_id="tenant-1", app_id="app-1", app_tracing=None, user_id=None, extras={}) is None


@pytest.mark.parametrize(
    ("policy", "enterprise"),
    [('{"enabled": true, "tracing_provider": "langfuse"}', False), (None, True)],
)
def test_scopes_stamp_owner_and_correlation(policy: str | None, enterprise: bool) -> None:
    scopes, recorder = _scopes(enterprise=enterprise)

    scope = scopes(
        tenant_id="tenant-1",
        app_id="app-1",
        app_tracing=policy,
        user_id="end-user-session",
        extras={"external_trace_id": "caller-trace"},
    )

    assert scope is not None
    assert (scope.tenant_id, scope.app_id, scope.user_id) == ("tenant-1", "app-1", "end-user-session")
    assert scope.correlation.external_trace_id == "caller-trace"
    assert scope.emitter is recorder


def test_app_scopes_without_an_app_depend_on_enterprise_telemetry() -> None:
    scopes, _ = _scopes(enterprise=True)

    scope = scopes.for_app(tenant_id="tenant-1", app_id=None, user_id=None, extras={})

    assert scope is not None
    assert scope.app_id is None


def test_workflow_runs_wait_for_node_executions_to_land(monkeypatch: pytest.MonkeyPatch) -> None:
    broker = _Broker()
    monkeypatch.setattr(emitter, "celery_app", broker)
    workflow = _event("hello").model_copy(
        update={"payload": WorkflowRunCompleted(workflow_run_id="run-1", conversation_id=None, total_tokens=0)}
    )

    CeleryTraceEmitter().emit(_event("hello"))
    CeleryTraceEmitter().emit(workflow)

    assert broker.countdowns == [0, WORKFLOW_SETTLE_SECONDS]


def test_inline_size_is_measured_in_bytes(monkeypatch: pytest.MonkeyPatch) -> None:
    broker, storage = _Broker(), _Storage()
    monkeypatch.setattr(emitter, "celery_app", broker)
    monkeypatch.setattr(emitter, "storage", storage)

    CeleryTraceEmitter().emit(_event("\u4e2d" * (INLINE_EVENT_BYTES // 2)))

    ((_, (envelope,), _),) = broker.sent
    assert "payload_key" in envelope
