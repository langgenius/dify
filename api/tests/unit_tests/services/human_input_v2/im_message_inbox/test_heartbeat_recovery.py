"""SQLite-backed tests for lease heartbeat and backlog recovery."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from threading import Event
from typing import override

import sqlalchemy as sa
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from core.human_input_v2.entities import IMProvider
from core.human_input_v2.im_message_inbox import (
    ClaimToken,
    ConsumerDecision,
    IMInboxDelivery,
    IMInboxRecordId,
    InboxProcessingPolicy,
    InboxProcessingStatus,
    TransitionResult,
)
from core.human_input_v2.im_provider import AuthenticatedIMEvent, IMEventIngressKind
from core.human_input_v2.shared import IntegrationId
from models.human_input_v2 import IMMessageInbox
from repositories.human_input_v2.im_message_inbox.repository import SQLAlchemyIMMessageInboxRepository
from services.human_input_v2.im_message_inbox.heartbeat import RenewableLeaseHeartbeat
from services.human_input_v2.im_message_inbox.recovery import IMInboxRecovery
from services.human_input_v2.im_message_inbox.telemetry import (
    IMInboxMetricKind,
    IMInboxMetrics,
)
from services.human_input_v2.im_message_inbox.wakeup import InboxWakeupError


def _policy(*, lease_duration: timedelta = timedelta(seconds=1)) -> InboxProcessingPolicy:
    return InboxProcessingPolicy(
        maximum_attempts=3,
        lease_duration=lease_duration,
        retry_backoff_minimum=timedelta(seconds=5),
        retry_backoff_maximum=timedelta(seconds=20),
    )


class _SystemClock:
    def now(self) -> datetime:
        return datetime.now(UTC)


class _TrackingRepository(SQLAlchemyIMMessageInboxRepository):
    renewed: Event

    def __init__(self, session_maker: sessionmaker[Session], policy: InboxProcessingPolicy) -> None:
        super().__init__(session_maker, policy)
        self.renewed = Event()

    @override
    def renew(
        self,
        record_id: IMInboxRecordId,
        claim_token: ClaimToken,
        *,
        now: datetime,
    ) -> TransitionResult:
        result = super().renew(
            record_id,
            claim_token,
            now=now,
        )
        self.renewed.set()
        return result


class _Wakeup:
    record_ids: list[IMInboxRecordId]
    fail: bool

    def __init__(self, *, fail: bool = False) -> None:
        self.record_ids = []
        self.fail = fail

    def publish(self, record_id: IMInboxRecordId) -> None:
        self.record_ids.append(record_id)
        if self.fail:
            raise InboxWakeupError("broker unavailable")


class _Metrics:
    events: list[tuple[IMInboxMetricKind, IMProvider | None, str | None]]
    backlog: list[tuple[str, int, float | None]]

    def __init__(self) -> None:
        self.events = []
        self.backlog = []

    def record(
        self,
        kind: IMInboxMetricKind,
        *,
        provider: IMProvider | None,
        outcome: str | None = None,
    ) -> None:
        self.events.append((kind, provider, outcome))

    def record_backlog(self, *, status: str, count: int, oldest_age_seconds: float | None) -> None:
        self.backlog.append((status, count, oldest_age_seconds))


def _event(event_id: str) -> AuthenticatedIMEvent:
    return AuthenticatedIMEvent(
        provider=IMProvider.FEISHU,
        provider_tenant_id="tenant-1",
        event_id=event_id,
        event_type=None,
        occurred_at=None,
        received_at=datetime.now(UTC).replace(tzinfo=None),
        ingress_kind=IMEventIngressKind.WEBHOOK,
        payload=' {"secret":"must-not-log"}\n',
    )


def test_renewable_heartbeat_extends_lease_while_consumer_runs() -> None:
    engine = sa.create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    inbox_table = IMMessageInbox.metadata.tables[IMMessageInbox.__tablename__]
    IMMessageInbox.metadata.create_all(engine, tables=[inbox_table])
    session_maker = sessionmaker(bind=engine, expire_on_commit=False)
    repository = _TrackingRepository(session_maker, _policy())
    clock = _SystemClock()
    accepted = repository.insert_or_resolve(IntegrationId("integration-1"), _event("event-1"), now=clock.now())
    delivery = repository.claim_by_id(
        accepted.record_id,
        now=clock.now(),
    )
    assert isinstance(delivery, IMInboxDelivery)
    heartbeat = RenewableLeaseHeartbeat(
        repository=repository,
        clock=clock,
        heartbeat_interval=timedelta(milliseconds=10),
    )

    def consume() -> ConsumerDecision:
        assert repository.renewed.wait(timeout=1)
        return ConsumerDecision.SUCCEEDED

    execution = heartbeat.execute(delivery, consume)

    assert execution.lease_held is True
    assert execution.decision is ConsumerDecision.SUCCEEDED
    engine.dispose()


def test_recovery_is_bounded_and_broker_failure_preserves_database_backlog(sqlite_engine: sa.Engine) -> None:
    inbox_table = IMMessageInbox.metadata.tables[IMMessageInbox.__tablename__]
    IMMessageInbox.metadata.create_all(sqlite_engine, tables=[inbox_table])
    session_maker = sessionmaker(bind=sqlite_engine, expire_on_commit=False)
    repository = SQLAlchemyIMMessageInboxRepository(
        session_maker,
        _policy(lease_duration=timedelta(seconds=5)),
    )
    now = datetime(2026, 8, 2, 8, tzinfo=UTC)
    accepted = [
        repository.insert_or_resolve(IntegrationId("integration-1"), _event(f"event-{index}"), now=now)
        for index in range(3)
    ]
    wakeup = _Wakeup(fail=True)
    metrics: IMInboxMetrics = _Metrics()
    recovery = IMInboxRecovery(
        repository=repository,
        wakeup=wakeup,
        clock=lambda: now,
        batch_size=2,
        metrics=metrics,
    )

    result = recovery.dispatch_available()

    assert result.discovered == 2
    assert result.dispatched == 0
    assert len(set(wakeup.record_ids)) == 2
    assert set(wakeup.record_ids).issubset({item.record_id for item in accepted})
    assert set(
        repository.recoverable_record_ids(
            now=now,
            limit=10,
        )
    ) == {item.record_id for item in accepted}
    assert isinstance(metrics, _Metrics)
    assert metrics.events == [
        (IMInboxMetricKind.DISPATCH_FAILURE, None, "broker_unavailable"),
        (IMInboxMetricKind.DISPATCH_FAILURE, None, "broker_unavailable"),
    ]
    assert metrics.backlog == [
        (InboxProcessingStatus.PENDING.value, 3, 0.0),
        (InboxProcessingStatus.PROCESSING.value, 0, None),
        (InboxProcessingStatus.SUCCEEDED.value, 0, None),
        (InboxProcessingStatus.IGNORED.value, 0, None),
        (InboxProcessingStatus.FAILED.value, 0, None),
    ]
