from datetime import UTC, datetime, timedelta

import pytest
from celery.exceptions import Retry
from dify_trace_sdk.events import MessageCompleted, TraceCorrelation, TraceEvent
from dify_trace_sdk.testing import message_trace

from services.tracing.assembly import SourceNotFoundError, SourceNotReadyError
from services.tracing.delivery import ExportJob, TraceCollectorUnavailableError
from services.tracing.emitter import payload_key
from tasks import trace_delivery_task
from tasks.trace_delivery_task import deliver_trace_event, retry_trace_export, sweep_trace_payloads


class _Storage:
    def __init__(self, files: dict[str, bytes]) -> None:
        self.files = dict(files)

    def load(self, key: str) -> bytes:
        return self.files[key]

    def save(self, key: str, data: bytes) -> None:
        self.files[key] = data

    def delete(self, key: str) -> None:
        self.files.pop(key, None)

    def scan(self, path: str, files: bool = True) -> list[str]:
        keys: list[str] = [key for key in self.files if key.startswith(path)] if files else []
        if not keys:
            raise FileNotFoundError(path)
        return keys


class _Delivery:
    def __init__(self, failure: Exception | None) -> None:
        self.failure = failure
        self.delivered: list[tuple[TraceEvent, bool]] = []
        self.retried: list[ExportJob] = []

    def deliver(self, event: TraceEvent, *, enterprise_delivered: bool) -> None:
        self.delivered.append((event, enterprise_delivered))
        if self.failure is not None:
            raise self.failure

    def retry(self, job: ExportJob) -> None:
        self.retried.append(job)


class _RetryRequests:
    def __init__(self) -> None:
        self.calls: list[dict[str, object]] = []

    def __call__(self, **kwargs: object) -> Retry:
        self.calls.append(kwargs)
        raise Retry("redelivery scheduled", None)


def _event() -> TraceEvent:
    return TraceEvent(
        event_id="event-1",
        tenant_id="tenant-1",
        app_id="app-1",
        user_id=None,
        occurred_at=datetime.now(UTC),
        correlation=TraceCorrelation(
            external_trace_id=None, session_id=None, parent_workflow_run_id=None, parent_node_execution_id=None
        ),
        payload=MessageCompleted(message_id="message-1", conversation_id=None),
    )


@pytest.fixture
def storage(monkeypatch: pytest.MonkeyPatch) -> _Storage:
    fake = _Storage({})
    monkeypatch.setattr(trace_delivery_task, "storage", fake)
    return fake


def _use_delivery(monkeypatch: pytest.MonkeyPatch, failure: Exception | None) -> _Delivery:
    delivery = _Delivery(failure)
    monkeypatch.setattr(trace_delivery_task, "trace_delivery_service", lambda: delivery)
    return delivery


@pytest.mark.usefixtures("storage")
def test_inline_events_are_delivered(monkeypatch: pytest.MonkeyPatch) -> None:
    delivery = _use_delivery(monkeypatch, None)

    deliver_trace_event.run({"event": _event().model_dump_json()})

    ((event, enterprise_delivered),) = delivery.delivered
    assert (event.event_id, enterprise_delivered) == ("event-1", False)


def test_stored_events_are_loaded_and_their_payload_removed(monkeypatch: pytest.MonkeyPatch, storage: _Storage) -> None:
    delivery = _use_delivery(monkeypatch, None)
    key = payload_key(datetime.now(UTC), "events", "event-1")
    storage.save(key, _event().model_dump_json().encode())

    deliver_trace_event.run({"payload_key": key})

    assert len(delivery.delivered) == 1
    assert key not in storage.files


def test_unreadable_events_are_dropped(monkeypatch: pytest.MonkeyPatch, storage: _Storage) -> None:
    delivery = _use_delivery(monkeypatch, None)
    storage.save("trace_payloads/2026-01-01/events/bad.json", b"not json")

    deliver_trace_event.run({"payload_key": "trace_payloads/2026-01-01/events/bad.json"})

    assert delivery.delivered == []
    assert storage.files == {}


@pytest.mark.usefixtures("storage")
def test_missing_sources_are_dropped(monkeypatch: pytest.MonkeyPatch) -> None:
    _use_delivery(monkeypatch, SourceNotFoundError())

    deliver_trace_event.run({"event": _event().model_dump_json()})


def test_sources_not_ready_are_redelivered_and_keep_their_payload(
    monkeypatch: pytest.MonkeyPatch, storage: _Storage
) -> None:
    _use_delivery(monkeypatch, SourceNotReadyError())
    retries = _RetryRequests()
    monkeypatch.setattr(deliver_trace_event, "retry", retries)
    key = payload_key(datetime.now(UTC), "events", "event-1")
    storage.save(key, _event().model_dump_json().encode())

    with pytest.raises(Retry):
        deliver_trace_event.run({"payload_key": key})

    assert retries.calls == [{"args": ({"payload_key": key},), "countdown": 5}]
    assert key in storage.files


@pytest.mark.usefixtures("storage")
def test_collector_outages_redeliver_without_repeating_enterprise_telemetry(monkeypatch: pytest.MonkeyPatch) -> None:
    _use_delivery(monkeypatch, TraceCollectorUnavailableError())
    retries = _RetryRequests()
    monkeypatch.setattr(deliver_trace_event, "retry", retries)
    envelope = {"event": _event().model_dump_json()}

    with pytest.raises(Retry):
        deliver_trace_event.run(envelope)

    assert retries.calls[0]["args"] == ({**envelope, "enterprise_delivered": True},)


def test_export_retries_run_the_stored_job_once(monkeypatch: pytest.MonkeyPatch, storage: _Storage) -> None:
    delivery = _use_delivery(monkeypatch, None)
    job = ExportJob(tenant_id="tenant-1", app_id="app-1", provider_id="langfuse", attempt=2, trace=message_trace())
    key = payload_key(datetime.now(UTC), "exports", "job-1")
    storage.save(key, job.model_dump_json().encode())

    retry_trace_export.run(key)

    assert delivery.retried == [job]
    assert key not in storage.files


def test_unreadable_export_jobs_are_dropped(monkeypatch: pytest.MonkeyPatch, storage: _Storage) -> None:
    delivery = _use_delivery(monkeypatch, None)
    storage.save("trace_payloads/2026-01-01/exports/bad.json", b"{}")

    retry_trace_export.run("trace_payloads/2026-01-01/exports/bad.json")

    assert delivery.retried == []
    assert storage.files == {}


def test_sweep_removes_expired_and_legacy_payloads_only(storage: _Storage) -> None:
    today = datetime.now(UTC)
    fresh = payload_key(today, "events", "fresh")
    expired = payload_key(today - timedelta(days=3), "events", "expired")
    for key in (fresh, expired, "trace_payloads/not-a-date/x.json", "ops_trace/app-1/legacy.json", "other/keep.json"):
        storage.save(key, b"{}")

    sweep_trace_payloads.run()

    assert sorted(storage.files) == sorted([fresh, "trace_payloads/not-a-date/x.json", "other/keep.json"])
