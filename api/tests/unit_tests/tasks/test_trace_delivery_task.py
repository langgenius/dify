from dataclasses import replace
from datetime import UTC, datetime, timedelta
from typing import override

import pytest
from celery.exceptions import Retry
from dify_trace_sdk.events import MessageCompleted, TraceCorrelation, TraceEvent
from dify_trace_sdk.testing import RecordingEgress, message_trace
from flask import Flask
from sqlalchemy.orm import Session, sessionmaker

from enums import DeploymentEdition
from extensions.ext_application_services import build_application_services
from extensions.ext_redis import redis_client
from services.tracing.adapters import payload_key
from services.tracing.canonical import CanonicalTraceBuilder
from services.tracing.delivery import (
    ExportJob,
    ExportRetryQueue,
    StoredTraceDestination,
    TraceCollector,
    TraceDeliveryService,
    TraceDestinationQuery,
    TraceRecordSource,
)
from services.tracing.errors import SourceNotFoundError, SourceNotReadyError
from services.tracing.providers import ProviderConfigCodec
from services.tracing.records import BaseTraceInfo, GenerateNameTraceInfo, WorkflowTraceInfo
from tasks import trace_delivery_task
from tasks.trace_delivery_task import deliver_trace_event, retry_trace_export, sweep_trace_payloads
from tests.helpers.unit.services.tracing_ports import InstalledTraceProviders, WorkspaceBoundCipher


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


class _Records(TraceRecordSource):
    """Answers every assembly with the scripted record or error after recording the event."""

    def __init__(self) -> None:
        self.result: BaseTraceInfo | Exception = SourceNotFoundError()
        self.events: list[TraceEvent] = []

    @override
    def assemble(self, event: TraceEvent) -> BaseTraceInfo:
        self.events.append(event)
        if isinstance(self.result, Exception):
            raise self.result
        return self.result


class _NoDestinations(TraceDestinationQuery):
    def __init__(self) -> None:
        self.lookups: list[tuple[str, str]] = []

    @override
    def active_destination(self, *, tenant_id: str, app_id: str) -> StoredTraceDestination | None:
        self.lookups.append((tenant_id, app_id))
        return None


class _NoRetries(ExportRetryQueue):
    @override
    def schedule(self, job: ExportJob, *, delay_seconds: int) -> None:
        raise AssertionError("no send is attempted")


class _UnavailableCollector(TraceCollector):
    @override
    def capture_terminal(self, *, tenant_id: str, info: BaseTraceInfo) -> bool:
        raise RuntimeError("ledger unavailable")

    @override
    def link_managed_parent(self, *, tenant_id: str, info: WorkflowTraceInfo) -> WorkflowTraceInfo:
        return info


class _Delivery:
    def __init__(self) -> None:
        self.records = _Records()
        self.destinations = _NoDestinations()

    def service(self, collector: TraceCollector | None) -> TraceDeliveryService:
        return TraceDeliveryService(
            records=self.records,
            destinations=self.destinations,
            providers=InstalledTraceProviders(),
            codec=ProviderConfigCodec(WorkspaceBoundCipher()),
            builder=CanonicalTraceBuilder(),
            egress=RecordingEgress([], grpc_target=None),
            retries=_NoRetries(),
            enterprise_sink=None,
            collector=collector,
            max_export_attempts=3,
        )


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


def _install(
    monkeypatch: pytest.MonkeyPatch,
    app: Flask,
    sessions: sessionmaker[Session],
    delivery: _Delivery,
    collector: TraceCollector | None,
) -> None:
    services = build_application_services(
        database_client=sessions,
        deployment_edition=DeploymentEdition.COMMUNITY,
        initialization_password="",
        redis=redis_client,
    )
    tracing = replace(services.tracing, delivery=delivery.service(collector))
    monkeypatch.setitem(app.extensions, "application_services", replace(services, tracing=tracing))


@pytest.fixture
def delivery(monkeypatch: pytest.MonkeyPatch, app: Flask, sqlite_session_factory: sessionmaker[Session]) -> _Delivery:
    delivery = _Delivery()
    _install(monkeypatch, app, sqlite_session_factory, delivery, None)
    return delivery


@pytest.mark.usefixtures("storage")
def test_inline_events_are_delivered(delivery: _Delivery) -> None:
    deliver_trace_event.run({"event": _event().model_dump_json()})

    assert [event.event_id for event in delivery.records.events] == ["event-1"]


def test_stored_events_are_loaded_and_their_payload_removed(delivery: _Delivery, storage: _Storage) -> None:
    key = payload_key(datetime.now(UTC), "events", "event-1")
    storage.save(key, _event().model_dump_json().encode())

    deliver_trace_event.run({"payload_key": key})

    assert len(delivery.records.events) == 1
    assert key not in storage.files


def test_unreadable_events_are_dropped(delivery: _Delivery, storage: _Storage) -> None:
    storage.save("trace_payloads/2026-01-01/events/bad.json", b"not json")

    deliver_trace_event.run({"payload_key": "trace_payloads/2026-01-01/events/bad.json"})

    assert delivery.records.events == []
    assert storage.files == {}


@pytest.mark.usefixtures("storage")
def test_missing_sources_are_dropped(delivery: _Delivery) -> None:
    deliver_trace_event.run({"event": _event().model_dump_json()})

    assert len(delivery.records.events) == 1


def test_sources_not_ready_are_redelivered_and_keep_their_payload(
    monkeypatch: pytest.MonkeyPatch, delivery: _Delivery, storage: _Storage
) -> None:
    delivery.records.result = SourceNotReadyError()
    retries = _RetryRequests()
    monkeypatch.setattr(deliver_trace_event, "retry", retries)
    key = payload_key(datetime.now(UTC), "events", "event-1")
    storage.save(key, _event().model_dump_json().encode())

    with pytest.raises(Retry):
        deliver_trace_event.run({"payload_key": key})

    assert retries.calls == [{"args": ({"payload_key": key},), "countdown": 5}]
    assert key in storage.files


@pytest.mark.usefixtures("storage")
def test_collector_outages_redeliver_without_repeating_enterprise_telemetry(
    monkeypatch: pytest.MonkeyPatch, app: Flask, sqlite_session_factory: sessionmaker[Session]
) -> None:
    delivery = _Delivery()
    delivery.records.result = GenerateNameTraceInfo(
        message_id=None,
        message_data=None,
        inputs="hello",
        outputs="Greeting",
        start_time=datetime(2026, 1, 1),
        end_time=datetime(2026, 1, 1),
        metadata={"trace_event_id": "event-1"},
        conversation_id=None,
        tenant_id="tenant-1",
    )
    _install(monkeypatch, app, sqlite_session_factory, delivery, _UnavailableCollector())
    retries = _RetryRequests()
    monkeypatch.setattr(deliver_trace_event, "retry", retries)
    envelope = {"event": _event().model_dump_json()}

    with pytest.raises(Retry):
        deliver_trace_event.run(envelope)

    assert retries.calls[0]["args"] == ({**envelope, "enterprise_delivered": True},)


def test_export_retries_run_the_stored_job_once(delivery: _Delivery, storage: _Storage) -> None:
    job = ExportJob(tenant_id="tenant-1", app_id="app-1", provider_id="langfuse", attempt=2, trace=message_trace())
    key = payload_key(datetime.now(UTC), "exports", "job-1")
    storage.save(key, job.model_dump_json().encode())

    retry_trace_export.run(key)

    assert delivery.destinations.lookups == [("tenant-1", "app-1")]
    assert key not in storage.files


def test_unreadable_export_jobs_are_dropped(delivery: _Delivery, storage: _Storage) -> None:
    storage.save("trace_payloads/2026-01-01/exports/bad.json", b"{}")

    retry_trace_export.run("trace_payloads/2026-01-01/exports/bad.json")

    assert delivery.destinations.lookups == []
    assert storage.files == {}


def test_sweep_removes_expired_and_legacy_payloads_only(storage: _Storage) -> None:
    today = datetime.now(UTC)
    fresh = payload_key(today, "events", "fresh")
    expired = payload_key(today - timedelta(days=3), "events", "expired")
    for key in (fresh, expired, "trace_payloads/not-a-date/x.json", "ops_trace/app-1/legacy.json", "other/keep.json"):
        storage.save(key, b"{}")

    sweep_trace_payloads.run()

    assert sorted(storage.files) == sorted([fresh, "trace_payloads/not-a-date/x.json", "other/keep.json"])
