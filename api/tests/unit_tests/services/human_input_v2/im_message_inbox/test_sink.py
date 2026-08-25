"""SQLite-backed tests for the Integration-bound durable IM event sink."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
import sqlalchemy as sa
from sqlalchemy import event as sqlalchemy_event
from sqlalchemy.engine import Engine
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session, sessionmaker

from core.human_input_v2.entities import IMProvider
from core.human_input_v2.im_integration.adapters import (
    AuthenticatedIMEvent,
    EventAcceptance,
    IMEventConsumer,
    IMEventIngressKind,
)
from core.human_input_v2.im_message_inbox import IMInboxRecordId, InboxEventValidationError, InboxProcessingPolicy
from core.human_input_v2.shared import IntegrationId
from models.human_input_v2 import IMMessageInbox
from repositories.human_input_v2.im_message_inbox.repository import SQLAlchemyIMMessageInboxRepository
from services.human_input_v2.im_message_inbox.sink import IMMessageInboxSink
from services.human_input_v2.im_message_inbox.telemetry import IMInboxMetricKind
from services.human_input_v2.im_message_inbox.wakeup import InboxWakeup, InboxWakeupError

_NOW = datetime(2026, 8, 2, 8, tzinfo=UTC)
_PAYLOAD = ' {"secret":"must-not-log"}\n'


def _policy() -> InboxProcessingPolicy:
    return InboxProcessingPolicy(
        maximum_attempts=3,
        lease_duration=timedelta(seconds=30),
        retry_backoff_minimum=timedelta(seconds=5),
        retry_backoff_maximum=timedelta(seconds=20),
    )


class _FixedClock:
    def now(self) -> datetime:
        return _NOW


class _RecordingWakeup:
    record_ids: list[IMInboxRecordId]
    fail: bool

    def __init__(self, *, fail: bool = False) -> None:
        self.record_ids = []
        self.fail = fail

    def publish(self, record_id: IMInboxRecordId) -> None:
        self.record_ids.append(record_id)
        if self.fail:
            raise InboxWakeupError("broker credential must-not-log")


class _CommitObservingWakeup:
    _session_maker: sessionmaker[Session]
    committed_record_ids: list[IMInboxRecordId]

    def __init__(self, session_maker: sessionmaker[Session]) -> None:
        self._session_maker = session_maker
        self.committed_record_ids = []

    def publish(self, record_id: IMInboxRecordId) -> None:
        with self._session_maker() as session:
            assert session.get(IMMessageInbox, str(record_id)) is not None
        self.committed_record_ids.append(record_id)


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

    def record_backlog(self, *, status: str, count: int, oldest_age_seconds: float | None) -> None:
        pass


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


def _sink(
    sqlite_engine: Engine, *, wakeup: InboxWakeup | None
) -> tuple[IMMessageInboxSink, sessionmaker[Session], _RecordingMetrics]:
    inbox_table = IMMessageInbox.metadata.tables[IMMessageInbox.__tablename__]
    IMMessageInbox.metadata.create_all(sqlite_engine, tables=[inbox_table])
    session_maker = sessionmaker(bind=sqlite_engine, expire_on_commit=False)
    repository = SQLAlchemyIMMessageInboxRepository(session_maker, _policy())
    metrics = _RecordingMetrics()
    return (
        IMMessageInboxSink(
            integration_id=IntegrationId("integration-1"),
            expected_provider=IMProvider.FEISHU,
            expected_provider_tenant_id="tenant-1",
            repository=repository,
            clock=_FixedClock(),
            wakeup=wakeup,
            metrics=metrics,
        ),
        session_maker,
        metrics,
    )


def test_sink_implements_provider_event_consumer_contract() -> None:
    assert IMEventConsumer in IMMessageInboxSink.__mro__


def test_wakeup_contract_is_owned_by_the_inbox_feature_not_the_sink_adapter() -> None:
    from services.human_input_v2.im_message_inbox import sink
    from services.human_input_v2.im_message_inbox.wakeup import InboxWakeup, InboxWakeupError

    assert InboxWakeup.__module__.endswith(".wakeup")
    assert InboxWakeupError.__module__.endswith(".wakeup")
    assert not hasattr(sink, "InboxWakeup")
    assert not hasattr(sink, "InboxWakeupError")


def test_sink_returns_accepted_only_after_commit_and_publishes_only_record_id(sqlite_engine: Engine) -> None:
    wakeup = _RecordingWakeup()
    sink, session_maker, metrics = _sink(sqlite_engine, wakeup=wakeup)

    acceptance = sink.accept(_event())

    assert acceptance is EventAcceptance.ACCEPTED
    assert metrics.events == [(IMInboxMetricKind.ACCEPTANCE, IMProvider.FEISHU, "new")]
    assert len(wakeup.record_ids) == 1
    with session_maker() as session:
        stored = session.get_one(IMMessageInbox, str(wakeup.record_ids[0]))
        assert stored.integration_id == "integration-1"
        assert stored.payload == _PAYLOAD


def test_sink_publish_observes_the_committed_record(sqlite_engine: Engine) -> None:
    _, session_maker, _ = _sink(sqlite_engine, wakeup=None)
    wakeup = _CommitObservingWakeup(session_maker)
    sink, _, _ = _sink(sqlite_engine, wakeup=wakeup)

    acceptance = sink.accept(_event())

    assert acceptance is EventAcceptance.ACCEPTED
    assert len(wakeup.committed_record_ids) == 1


def test_sink_accepts_identified_duplicate_without_resetting_processing_state(sqlite_engine: Engine) -> None:
    sink, session_maker, metrics = _sink(sqlite_engine, wakeup=None)
    assert sink.accept(_event()) is EventAcceptance.ACCEPTED
    with session_maker.begin() as session:
        stored = session.scalar(sa.select(IMMessageInbox))
        assert stored is not None
        stored.attempt_count = 2

    duplicate = sink.accept(_event())

    assert duplicate is EventAcceptance.ACCEPTED
    assert metrics.events[-2:] == [
        (IMInboxMetricKind.ACCEPTANCE, IMProvider.FEISHU, "duplicate"),
        (IMInboxMetricKind.DUPLICATE, IMProvider.FEISHU, None),
    ]
    with session_maker() as session:
        records = list(session.scalars(sa.select(IMMessageInbox)))
        assert len(records) == 1
        assert records[0].attempt_count == 2


def test_sink_rejects_conflicting_bound_provider_identity_without_insert(sqlite_engine: Engine) -> None:
    sink, session_maker, metrics = _sink(sqlite_engine, wakeup=None)

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


def test_sink_accepts_and_preserves_max_length_provider_metadata(sqlite_engine: Engine) -> None:
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
        repository=SQLAlchemyIMMessageInboxRepository(session_maker, _policy()),
        clock=_FixedClock(),
        wakeup=None,
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


def test_sink_canonicalizes_oversized_blank_event_id_before_validation(sqlite_engine: Engine) -> None:
    sink, session_maker, _ = _sink(sqlite_engine, wakeup=None)

    acceptance = sink.accept(_event(event_id=" " * 129))

    assert acceptance is EventAcceptance.ACCEPTED
    with session_maker() as session:
        stored = session.scalar(sa.select(IMMessageInbox))
        assert stored is not None
        assert stored.provider_event_id is None
        assert stored.payload == _PAYLOAD


def test_sink_preserves_nonblank_event_id_verbatim(sqlite_engine: Engine) -> None:
    sink, session_maker, _ = _sink(sqlite_engine, wakeup=None)
    event_id = " event-1 "

    acceptance = sink.accept(_event(event_id=event_id))

    assert acceptance is EventAcceptance.ACCEPTED
    with session_maker() as session:
        stored = session.scalar(sa.select(IMMessageInbox))
        assert stored is not None
        assert stored.provider_event_id == event_id


def test_sink_rejects_oversized_bound_integration_identity_during_construction(sqlite_engine: Engine) -> None:
    inbox_table = IMMessageInbox.metadata.tables[IMMessageInbox.__tablename__]
    IMMessageInbox.metadata.create_all(sqlite_engine, tables=[inbox_table])
    session_maker = sessionmaker(bind=sqlite_engine, expire_on_commit=False)

    with pytest.raises(InboxEventValidationError, match="provider tenant id"):
        IMMessageInboxSink(
            integration_id=IntegrationId("integration-1"),
            expected_provider=IMProvider.FEISHU,
            expected_provider_tenant_id="t" * 129,
            repository=SQLAlchemyIMMessageInboxRepository(session_maker, _policy()),
            clock=_FixedClock(),
            wakeup=None,
            metrics=_RecordingMetrics(),
        )

    with session_maker() as session:
        assert session.scalar(sa.select(sa.func.count(IMMessageInbox.id))) == 0


@pytest.mark.parametrize(
    ("tenant_id", "event_id", "event_type", "field_name"),
    [
        ("t" * 129, "event-1", None, "provider tenant id"),
        ("tenant-1", "e" * 129, None, "provider event id"),
        ("tenant-1", "event-1", "y" * 129, "provider event type"),
    ],
)
def test_sink_rejects_oversized_event_metadata_without_persisting(
    sqlite_engine: Engine,
    tenant_id: str,
    event_id: str,
    event_type: str | None,
    field_name: str,
) -> None:
    sink, session_maker, _ = _sink(sqlite_engine, wakeup=None)

    with pytest.raises(InboxEventValidationError, match=field_name):
        sink.accept(_event(tenant_id=tenant_id, event_id=event_id, event_type=event_type))

    with session_maker() as session:
        assert session.scalar(sa.select(sa.func.count(IMMessageInbox.id))) == 0


def test_sink_accepts_committed_event_when_downstream_processing_is_unavailable(sqlite_engine: Engine) -> None:
    sink, session_maker, metrics = _sink(sqlite_engine, wakeup=None)

    acceptance = sink.accept(_event())

    assert acceptance is EventAcceptance.ACCEPTED
    assert metrics.events == [(IMInboxMetricKind.ACCEPTANCE, IMProvider.FEISHU, "new")]
    with session_maker() as session:
        stored = session.scalar(sa.select(IMMessageInbox))
        assert stored is not None
        assert stored.status.value == "pending"
        assert stored.attempt_count == 0


def test_sink_keeps_committed_acceptance_when_post_commit_wakeup_fails(
    sqlite_engine: Engine, caplog: pytest.LogCaptureFixture
) -> None:
    wakeup = _RecordingWakeup(fail=True)
    sink, session_maker, metrics = _sink(sqlite_engine, wakeup=wakeup)

    acceptance = sink.accept(_event())

    assert acceptance is EventAcceptance.ACCEPTED
    assert metrics.events == [
        (IMInboxMetricKind.ACCEPTANCE, IMProvider.FEISHU, "new"),
        (IMInboxMetricKind.DISPATCH_FAILURE, IMProvider.FEISHU, "broker_unavailable"),
    ]
    assert "must-not-log" not in caplog.text
    assert len(wakeup.record_ids) == 1
    with session_maker() as session:
        assert session.scalar(sa.select(sa.func.count(IMMessageInbox.id))) == 1


def test_sink_returns_not_accepted_when_database_insert_fails(
    sqlite_engine: Engine, caplog: pytest.LogCaptureFixture
) -> None:
    sink, session_maker, metrics = _sink(sqlite_engine, wakeup=None)

    def fail_inbox_insert(
        _connection: sa.Connection,
        _cursor: object,
        statement: str,
        _parameters: object,
        _context: object,
        _executemany: bool,
    ) -> None:
        if statement.lstrip().startswith("INSERT INTO im_message_inbox"):
            raise OperationalError(statement, {}, RuntimeError("injected database failure"))

    sqlalchemy_event.listen(sqlite_engine, "before_cursor_execute", fail_inbox_insert)
    try:
        acceptance = sink.accept(_event())
    finally:
        sqlalchemy_event.remove(sqlite_engine, "before_cursor_execute", fail_inbox_insert)

    assert acceptance is EventAcceptance.NOT_ACCEPTED
    assert metrics.events == [(IMInboxMetricKind.ACCEPTANCE_FAILURE, IMProvider.FEISHU, "persistence_failure")]
    assert "must-not-log" not in caplog.text
    with session_maker() as session:
        assert session.scalar(sa.select(sa.func.count(IMMessageInbox.id))) == 0


def test_sink_returns_not_accepted_when_database_commit_fails(
    sqlite_engine: Engine, caplog: pytest.LogCaptureFixture
) -> None:
    sink, session_maker, metrics = _sink(sqlite_engine, wakeup=None)

    def fail_commit(_connection: sa.Connection) -> None:
        raise OperationalError("COMMIT", {}, RuntimeError("credential must-not-log"))

    sqlalchemy_event.listen(sqlite_engine, "commit", fail_commit, once=True)

    acceptance = sink.accept(_event())

    assert acceptance is EventAcceptance.NOT_ACCEPTED
    assert metrics.events == [(IMInboxMetricKind.ACCEPTANCE_FAILURE, IMProvider.FEISHU, "persistence_failure")]
    assert "must-not-log" not in caplog.text
    with session_maker() as session:
        assert session.scalar(sa.select(sa.func.count(IMMessageInbox.id))) == 0
