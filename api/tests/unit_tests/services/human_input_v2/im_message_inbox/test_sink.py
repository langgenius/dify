"""SQLite-backed tests for durable callback acceptance and task publication."""

from __future__ import annotations

from collections.abc import Callable
from datetime import UTC, datetime

import pytest
import sqlalchemy as sa
from sqlalchemy import event as sqlalchemy_event
from sqlalchemy.engine import Engine
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session, sessionmaker

from core.human_input_v2.entities import IMProvider
from core.human_input_v2.im_integration.adapters import AuthenticatedIMEvent, EventAcceptance, IMEventIngressKind
from core.human_input_v2.im_message_inbox import IMInboxRecordId, InboxEventValidationError
from core.human_input_v2.shared import IntegrationId
from models.human_input_v2 import IMMessageInbox
from repositories.human_input_v2.im_message_inbox.repository import SQLAlchemyIMMessageInboxRepository
from services.human_input_v2.im_message_inbox.sink import IMMessageInboxSink
from services.human_input_v2.im_message_inbox.telemetry import IMInboxMetricKind

_NOW = datetime(2026, 8, 2, 8, tzinfo=UTC)
_PAYLOAD = ' {"secret":"must-not-log"}\n'


class _TaskPublisher:
    record_ids: list[IMInboxRecordId]
    fail: bool
    observer: Callable[[IMInboxRecordId], None] | None

    def __init__(self) -> None:
        self.record_ids = []
        self.fail = False
        self.observer = None

    def apply_async(self, args: tuple[str, ...], *, retry: bool) -> object:
        assert retry is False
        record_id = IMInboxRecordId(args[0])
        self.record_ids.append(record_id)
        if self.observer is not None:
            self.observer(record_id)
        if self.fail:
            raise RuntimeError("broker credential must-not-log")
        return object()


class _RecordingMetrics:
    events: list[tuple[IMInboxMetricKind, IMProvider | None, str | None]]

    def __init__(self) -> None:
        self.events = []

    def record(
        self,
        kind: IMInboxMetricKind,
        *,
        provider: IMProvider | None,
        outcome: str | None = None,
    ) -> None:
        self.events.append((kind, provider, outcome))


@pytest.fixture(autouse=True)
def task_publisher(monkeypatch: pytest.MonkeyPatch) -> _TaskPublisher:
    publisher = _TaskPublisher()
    monkeypatch.setattr(
        "services.human_input_v2.im_message_inbox.sink.process_im_message_inbox_record.apply_async",
        publisher.apply_async,
    )
    return publisher


def _event(
    *,
    provider: IMProvider = IMProvider.FEISHU,
    tenant_id: str = "tenant-1",
    event_id: str | None = "event-1",
    event_type: str | None = None,
) -> AuthenticatedIMEvent:
    return AuthenticatedIMEvent(
        provider=provider,
        provider_tenant_id=tenant_id,
        event_id=event_id,
        event_type=event_type,
        occurred_at=None,
        received_at=datetime(2026, 8, 2, 8),
        ingress_kind=IMEventIngressKind.WEBHOOK,
        payload=_PAYLOAD,
    )


def _sink(sqlite_engine: Engine) -> tuple[IMMessageInboxSink, sessionmaker[Session], _RecordingMetrics]:
    inbox_table = IMMessageInbox.metadata.tables[IMMessageInbox.__tablename__]
    IMMessageInbox.metadata.create_all(sqlite_engine, tables=[inbox_table])
    session_maker = sessionmaker(bind=sqlite_engine, expire_on_commit=False)
    metrics = _RecordingMetrics()
    return (
        IMMessageInboxSink(
            integration_id=IntegrationId("integration-1"),
            expected_provider=IMProvider.FEISHU,
            expected_provider_tenant_id="tenant-1",
            repository=SQLAlchemyIMMessageInboxRepository(session_maker),
            clock=lambda: _NOW,
            metrics=metrics,
        ),
        session_maker,
        metrics,
    )


def test_sink_commits_before_enqueuing_record_id(sqlite_engine: Engine, task_publisher: _TaskPublisher) -> None:
    sink, session_maker, metrics = _sink(sqlite_engine)

    def observe_commit(record_id: IMInboxRecordId) -> None:
        with session_maker() as session:
            assert session.get(IMMessageInbox, str(record_id)) is not None

    task_publisher.observer = observe_commit

    acceptance = sink.accept(_event())

    assert acceptance is EventAcceptance.ACCEPTED
    assert metrics.events == [(IMInboxMetricKind.ACCEPTANCE, IMProvider.FEISHU, "new")]
    assert len(task_publisher.record_ids) == 1


def test_identified_redelivery_reenqueues_same_record_without_mutating_facts(
    sqlite_engine: Engine, task_publisher: _TaskPublisher
) -> None:
    sink, session_maker, metrics = _sink(sqlite_engine)
    assert sink.accept(_event()) is EventAcceptance.ACCEPTED
    with session_maker.begin() as session:
        stored = session.scalar(sa.select(IMMessageInbox))
        assert stored is not None
        stored.processed_at = datetime(2026, 8, 2, 8, 1)

    duplicate = sink.accept(_event())

    assert duplicate is EventAcceptance.ACCEPTED
    assert metrics.events[-2:] == [
        (IMInboxMetricKind.ACCEPTANCE, IMProvider.FEISHU, "duplicate"),
        (IMInboxMetricKind.DUPLICATE, IMProvider.FEISHU, None),
    ]
    assert len(task_publisher.record_ids) == 2
    assert task_publisher.record_ids[0] == task_publisher.record_ids[1]
    with session_maker() as session:
        records = list(session.scalars(sa.select(IMMessageInbox)))
        assert len(records) == 1
        assert records[0].processed_at == datetime(2026, 8, 2, 8, 1)


def test_enqueue_failure_rejects_identified_callback_and_redelivery_retries_same_record(
    sqlite_engine: Engine,
    task_publisher: _TaskPublisher,
    caplog: pytest.LogCaptureFixture,
) -> None:
    sink, session_maker, metrics = _sink(sqlite_engine)
    task_publisher.fail = True

    first_acceptance = sink.accept(_event())
    task_publisher.fail = False
    second_acceptance = sink.accept(_event())

    assert first_acceptance is EventAcceptance.NOT_ACCEPTED
    assert second_acceptance is EventAcceptance.ACCEPTED
    assert task_publisher.record_ids[0] == task_publisher.record_ids[1]
    assert metrics.events == [
        (IMInboxMetricKind.ACCEPTANCE, IMProvider.FEISHU, "new"),
        (IMInboxMetricKind.DISPATCH_FAILURE, IMProvider.FEISHU, "broker_unavailable"),
        (IMInboxMetricKind.ACCEPTANCE, IMProvider.FEISHU, "duplicate"),
        (IMInboxMetricKind.DUPLICATE, IMProvider.FEISHU, None),
    ]
    assert "must-not-log" not in caplog.text
    with session_maker() as session:
        assert session.scalar(sa.select(sa.func.count(IMMessageInbox.id))) == 1


def test_enqueue_failure_for_unidentified_callback_creates_new_record_on_redelivery(
    sqlite_engine: Engine,
    task_publisher: _TaskPublisher,
) -> None:
    sink, session_maker, _ = _sink(sqlite_engine)
    task_publisher.fail = True

    first_acceptance = sink.accept(_event(event_id=None))
    task_publisher.fail = False
    second_acceptance = sink.accept(_event(event_id=None))

    assert first_acceptance is EventAcceptance.NOT_ACCEPTED
    assert second_acceptance is EventAcceptance.ACCEPTED
    assert task_publisher.record_ids[0] != task_publisher.record_ids[1]
    with session_maker() as session:
        assert session.scalar(sa.select(sa.func.count(IMMessageInbox.id))) == 2


def test_sink_rejects_conflicting_bound_provider_identity_without_insert(sqlite_engine: Engine) -> None:
    sink, session_maker, metrics = _sink(sqlite_engine)

    provider_conflict = sink.accept(_event(provider=IMProvider.SLACK))
    tenant_conflict = sink.accept(_event(tenant_id="tenant-2"))

    assert provider_conflict is EventAcceptance.NOT_ACCEPTED
    assert tenant_conflict is EventAcceptance.NOT_ACCEPTED
    assert metrics.events == [
        (IMInboxMetricKind.ACCEPTANCE_FAILURE, IMProvider.SLACK, "identity_conflict"),
        (IMInboxMetricKind.ACCEPTANCE_FAILURE, IMProvider.FEISHU, "identity_conflict"),
    ]
    with session_maker() as session:
        assert session.scalar(sa.select(sa.func.count(IMMessageInbox.id))) == 0


def test_sink_preserves_provider_metadata_and_payload(sqlite_engine: Engine) -> None:
    maximum_tenant_id = "t" * 128
    maximum_event_id = "e" * 128
    maximum_event_type = "y" * 128
    inbox_table = IMMessageInbox.metadata.tables[IMMessageInbox.__tablename__]
    IMMessageInbox.metadata.create_all(sqlite_engine, tables=[inbox_table])
    session_maker = sessionmaker(bind=sqlite_engine, expire_on_commit=False)
    sink = IMMessageInboxSink(
        integration_id=IntegrationId("integration-1"),
        expected_provider=IMProvider.FEISHU,
        expected_provider_tenant_id=maximum_tenant_id,
        repository=SQLAlchemyIMMessageInboxRepository(session_maker),
        clock=lambda: _NOW,
        metrics=_RecordingMetrics(),
    )

    acceptance = sink.accept(
        _event(tenant_id=maximum_tenant_id, event_id=maximum_event_id, event_type=maximum_event_type)
    )

    assert acceptance is EventAcceptance.ACCEPTED
    with session_maker() as session:
        stored = session.scalar(sa.select(IMMessageInbox))
        assert stored is not None
        assert stored.provider_tenant_id == maximum_tenant_id
        assert stored.provider_event_id == maximum_event_id
        assert stored.provider_event_type == maximum_event_type
        assert stored.payload == _PAYLOAD


def test_sink_canonicalizes_blank_event_id_before_validation(sqlite_engine: Engine) -> None:
    sink, session_maker, _ = _sink(sqlite_engine)

    acceptance = sink.accept(_event(event_id=" " * 129))

    assert acceptance is EventAcceptance.ACCEPTED
    with session_maker() as session:
        stored = session.scalar(sa.select(IMMessageInbox))
        assert stored is not None
        assert stored.provider_event_id is None


def test_sink_rejects_oversized_bound_provider_identity(sqlite_engine: Engine) -> None:
    inbox_table = IMMessageInbox.metadata.tables[IMMessageInbox.__tablename__]
    IMMessageInbox.metadata.create_all(sqlite_engine, tables=[inbox_table])
    session_maker = sessionmaker(bind=sqlite_engine, expire_on_commit=False)

    with pytest.raises(InboxEventValidationError, match="provider tenant id"):
        IMMessageInboxSink(
            integration_id=IntegrationId("integration-1"),
            expected_provider=IMProvider.FEISHU,
            expected_provider_tenant_id="t" * 129,
            repository=SQLAlchemyIMMessageInboxRepository(session_maker),
            clock=lambda: _NOW,
            metrics=_RecordingMetrics(),
        )


def test_sink_returns_not_accepted_when_database_commit_fails(
    sqlite_engine: Engine, caplog: pytest.LogCaptureFixture
) -> None:
    sink, session_maker, metrics = _sink(sqlite_engine)

    def fail_commit(_connection: sa.Connection) -> None:
        raise OperationalError("COMMIT", {}, RuntimeError("credential must-not-log"))

    sqlalchemy_event.listen(sqlite_engine, "commit", fail_commit, once=True)

    acceptance = sink.accept(_event())

    assert acceptance is EventAcceptance.NOT_ACCEPTED
    assert metrics.events == [(IMInboxMetricKind.ACCEPTANCE_FAILURE, IMProvider.FEISHU, "persistence_failure")]
    assert "must-not-log" not in caplog.text
    with session_maker() as session:
        assert session.scalar(sa.select(sa.func.count(IMMessageInbox.id))) == 0
