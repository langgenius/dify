from collections.abc import Iterator
from datetime import UTC, datetime
from multiprocessing import get_context
from pathlib import Path
from queue import Empty
from threading import Event, Thread
from typing import override
from uuid import uuid4

import pytest
from celery import Celery
from celery.contrib.testing.app import TestApp, setup_default_app
from celery.signals import before_task_publish, worker_process_shutdown
from dify_trace_sdk.events import ModerationChecked, TraceCorrelation, TraceEvent, WorkflowRunCompleted
from dify_trace_sdk.model import Span, SpanKind, SpanStatus, Trace
from kombu.message import Message
from kombu.simple import SimpleQueue

from extensions.storage.opendal_storage import OpenDALStorage
from services.app_tracing_config_service import AppTraceSettings
from services.tracing import adapters
from services.tracing.adapters import (
    AGENT_TRACE_EXPORT_TASK,
    DELIVER_TASK,
    INLINE_EVENT_BYTES,
    PENDING_EVENT_LIMIT,
    RETRY_TASK,
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
def broker() -> Iterator[Celery]:
    app = TestApp(config={"task_default_queue": f"tracing-{uuid4().hex}"})
    with setup_default_app(app):
        app.set_current()
        app.set_default()
        yield app


@pytest.fixture
def storage(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> OpenDALStorage:
    local = OpenDALStorage(scheme="fs", root=str(tmp_path))
    monkeypatch.setattr(adapters, "storage", local)
    return local


def published(broker: Celery) -> list[Message]:
    messages: list[Message] = []
    with broker.connection_for_read() as connection, SimpleQueue(connection, broker.conf.task_default_queue) as inbox:
        while True:
            try:
                message = inbox.get(block=False)
            except Empty:
                return messages
            message.ack()
            messages.append(message)


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


def test_small_events_travel_inline(broker: Celery, storage: OpenDALStorage) -> None:
    event = _event("hello")

    emitter = CeleryTraceEmitter()
    emitter.emit(event)
    emitter.shutdown()

    (message,) = published(broker)
    assert message.headers["task"] == DELIVER_TASK
    (envelope,) = message.payload[0]
    assert isinstance(envelope, dict)
    assert TraceEvent.model_validate_json(envelope["event"]) == event
    assert not storage.exists("trace_payloads")


def test_large_events_travel_through_storage(broker: Celery, storage: OpenDALStorage) -> None:
    event = _event("x" * INLINE_EVENT_BYTES)

    emitter = CeleryTraceEmitter()
    emitter.emit(event)
    emitter.shutdown()

    (message,) = published(broker)
    (envelope,) = message.payload[0]
    assert envelope == {"payload_key": payload_key(event.occurred_at, "events", "event-1")}
    assert payload_key(event.occurred_at, "events", "event-1") == "trace_payloads/2026-03-04/events/event-1.json"
    assert TraceEvent.model_validate_json(storage.load_once("trace_payloads/2026-03-04/events/event-1.json")) == event


@pytest.mark.usefixtures("storage")
def test_inline_size_is_measured_in_bytes(broker: Celery) -> None:
    emitter = CeleryTraceEmitter()
    emitter.emit(_event("中" * (INLINE_EVENT_BYTES // 2)))
    emitter.shutdown()

    (message,) = published(broker)
    (envelope,) = message.payload[0]
    assert isinstance(envelope, dict)
    assert "payload_key" in envelope


@pytest.mark.usefixtures("storage")
def test_workflow_runs_wait_for_node_executions_to_land(broker: Celery) -> None:
    workflow = _event("hello").model_copy(
        update={"payload": WorkflowRunCompleted(workflow_run_id="run-1", conversation_id=None, total_tokens=0)}
    )

    emitter = CeleryTraceEmitter()
    emitter.emit(_event("hello"))
    before = datetime.now(UTC)
    emitter.emit(workflow)
    emitter.shutdown()

    immediate, delayed = published(broker)
    assert immediate.headers["eta"] is None
    eta = datetime.fromisoformat(delayed.headers["eta"])
    assert (eta - before).total_seconds() >= WORKFLOW_SETTLE_SECONDS


def test_export_retries_persist_the_trace_and_run_after_their_delay(broker: Celery, storage: OpenDALStorage) -> None:
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

    (message,) = published(broker)
    (key,) = message.payload[0]
    assert message.headers["task"] == RETRY_TASK
    assert message.headers["eta"] is not None
    assert isinstance(key, str)
    assert key.startswith("trace_payloads/")
    assert "/exports/" in key
    assert ExportJob.model_validate_json(storage.load_once(key)) == job


def test_agent_trace_exports_run_on_the_trace_queue(broker: Celery) -> None:
    schedule_agent_trace_export("run-1")

    (message,) = published(broker)
    assert message.headers["task"] == AGENT_TRACE_EXPORT_TASK
    assert message.payload[0] == ["run-1"]


def test_blocked_publisher_does_not_block_producers_and_bounds_pending_events(
    broker: Celery, caplog: pytest.LogCaptureFixture
) -> None:
    entered, release, returned = Event(), Event(), Event()

    def hold_publication(**_: object) -> None:
        entered.set()
        assert release.wait(10)

    emitter = CeleryTraceEmitter()

    def produce() -> None:
        broker.set_current()
        emitter.emit(_event("first"))
        returned.set()

    before_task_publish.connect(hold_publication, sender=DELIVER_TASK, weak=False)
    producer = Thread(target=produce)
    try:
        producer.start()
        assert entered.wait(5)
        assert returned.wait(1), "emit waited for broker publication"
        for _ in range(PENDING_EVENT_LIMIT - 1):
            emitter.emit(_event("buffered"))
        emitter.emit(_event("overflow"))
        assert "buffer full" in caplog.text
        assert published(broker) == []
    finally:
        release.set()
        producer.join(timeout=5)
        emitter.shutdown()
        before_task_publish.disconnect(hold_publication, sender=DELIVER_TASK)  # type: ignore[attr-defined]  # Missing from celery-types.

    assert len(published(broker)) == PENDING_EVENT_LIMIT


def test_publication_snapshots_payload_and_preserves_callers_celery_app(broker: Celery) -> None:
    entered, release = Event(), Event()

    def hold_publication(**_: object) -> None:
        entered.set()
        assert release.wait(10)

    other = TestApp(config={"task_default_queue": f"other-{uuid4().hex}"})
    other.set_default()
    emitter = CeleryTraceEmitter()
    event = _event("second")
    before_task_publish.connect(hold_publication, sender=DELIVER_TASK, weak=False)
    try:
        emitter.emit(_event("first"))
        assert entered.wait(5)
        emitter.emit(event)
        assert isinstance(event.payload, ModerationChecked)
        event.payload.inputs["changed_after_emit"] = True
    finally:
        release.set()
        emitter.shutdown()
        before_task_publish.disconnect(hold_publication, sender=DELIVER_TASK)  # type: ignore[attr-defined]  # Missing from celery-types.
        other.close()

    first, second = published(broker)
    assert TraceEvent.model_validate_json(first.payload[0][0]["event"]).payload == _event("first").payload
    captured = TraceEvent.model_validate_json(second.payload[0][0]["event"])
    assert isinstance(captured.payload, ModerationChecked)
    assert captured.payload.inputs == {}


def test_failed_storage_publication_releases_capacity_and_later_events_continue(
    broker: Celery, storage: OpenDALStorage, caplog: pytest.LogCaptureFixture
) -> None:
    # A file in place of the payload directory makes the real filesystem write fail.
    storage.save("trace_payloads", b"not a directory")
    emitter = CeleryTraceEmitter()
    emitter.emit(_event("x" * INLINE_EVENT_BYTES))
    emitter.emit(_event("next"))
    emitter.shutdown()

    assert "Trace publication failed" in caplog.text
    (message,) = published(broker)
    event = TraceEvent.model_validate_json(message.payload[0][0]["event"])
    assert isinstance(event.payload, ModerationChecked)
    assert event.payload.query == "next"
    for _ in range(PENDING_EVENT_LIMIT):
        assert emitter._slots.acquire(blocking=False)


def test_forked_worker_has_its_own_publisher_and_drains_on_shutdown(broker: Celery) -> None:
    emitter = CeleryTraceEmitter()
    emitter.emit(_event("parent"))
    with broker.connection_for_read() as connection, SimpleQueue(connection, broker.conf.task_default_queue) as inbox:
        message = inbox.get(block=True, timeout=5)
        message.ack()

    context = get_context("fork")
    reader, writer = context.Pipe(duplex=False)

    def publish_from_child() -> None:
        reader.close()
        emitter.emit(_event("child"))
        worker_process_shutdown.send(sender=None)
        assert emitter._closed, "worker shutdown did not close the publisher"
        (message,) = published(broker)
        event = TraceEvent.model_validate_json(message.payload[0][0]["event"])
        assert isinstance(event.payload, ModerationChecked)
        writer.send(event.payload.query)
        writer.close()

    child = context.Process(target=publish_from_child)
    try:
        child.start()
        writer.close()
        assert reader.poll(10), "the child inherited an unusable publisher"
        assert reader.recv() == "child"
        child.join(timeout=5)
        assert child.exitcode == 0
        assert published(broker) == []
        emitter.emit(_event("parent after fork"))
    finally:
        if child.is_alive():
            child.terminate()
            child.join(timeout=5)
        reader.close()
        writer.close()
        emitter.shutdown()

    (message,) = published(broker)
    event = TraceEvent.model_validate_json(message.payload[0][0]["event"])
    assert isinstance(event.payload, ModerationChecked)
    assert event.payload.query == "parent after fork"


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
