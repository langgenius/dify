"""SQLite-backed tests for reliable IM inbox consumer handoff."""

from __future__ import annotations

from collections.abc import Callable
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from core.human_input_v2.entities import IMProvider
from core.human_input_v2.im_message_inbox import (
    ConsumerDecision,
    IMInboxDelivery,
    IMInboxRecordId,
    InboxProcessingPolicy,
)
from core.human_input_v2.im_provider import AuthenticatedIMEvent, IMEventIngressKind
from core.human_input_v2.shared import IntegrationId
from models.human_input_v2 import IMMessageInbox
from repositories.human_input_v2.im_message_inbox.repository import SQLAlchemyIMMessageInboxRepository
from services.human_input_v2.im_message_inbox.recovery import IMInboxRecovery
from services.human_input_v2.im_message_inbox.telemetry import (
    IMInboxMetricKind,
    IMInboxMetrics,
    NoopIMInboxMetrics,
)
from services.human_input_v2.im_message_inbox.worker import (
    HeartbeatExecution,
    IMInboxWorker,
    InboxWorkerOutcome,
)

_NOW = datetime(2026, 8, 2, 8, tzinfo=UTC)


def _policy(*, maximum_attempts: int = 3) -> InboxProcessingPolicy:
    return InboxProcessingPolicy(
        maximum_attempts=maximum_attempts,
        lease_duration=timedelta(seconds=30),
        retry_backoff_minimum=timedelta(seconds=5),
        retry_backoff_maximum=timedelta(seconds=20),
    )


class _MutableClock:
    current: datetime

    def __init__(self, current: datetime = _NOW) -> None:
        self.current = current

    def now(self) -> datetime:
        return self.current


class _Consumer:
    decision: ConsumerDecision
    calls: list[IMInboxDelivery]
    failure: RuntimeError | None

    def __init__(self, decision: ConsumerDecision, *, failure: RuntimeError | None = None) -> None:
        self.decision = decision
        self.calls = []
        self.failure = failure

    def consume(self, delivery: IMInboxDelivery) -> ConsumerDecision:
        self.calls.append(delivery)
        if self.failure is not None:
            raise self.failure
        return self.decision


class _Heartbeat:
    lease_held: bool
    calls: list[IMInboxDelivery]

    def __init__(self, *, lease_held: bool = True) -> None:
        self.lease_held = lease_held
        self.calls = []

    def execute(self, delivery: IMInboxDelivery, operation: Callable[[], ConsumerDecision]) -> HeartbeatExecution:
        self.calls.append(delivery)
        decision = operation()
        return HeartbeatExecution(decision=decision, lease_held=self.lease_held)


class _Metrics:
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
        del status, count, oldest_age_seconds


class _Wakeup:
    record_ids: list[IMInboxRecordId]

    def __init__(self, record_ids: list[IMInboxRecordId]) -> None:
        self.record_ids = record_ids

    def publish(self, record_id: IMInboxRecordId) -> None:
        self.record_ids.append(record_id)


def _event(event_id: str = "event-1") -> AuthenticatedIMEvent:
    return AuthenticatedIMEvent(
        provider=IMProvider.FEISHU,
        provider_tenant_id="tenant-1",
        event_id=event_id,
        event_type=None,
        occurred_at=None,
        received_at=datetime(2026, 8, 2, 8),
        ingress_kind=IMEventIngressKind.WEBHOOK,
        payload=' {"secret":"must-not-log"}\n',
    )


def _context(
    sqlite_engine: Engine,
    decision: ConsumerDecision,
    *,
    maximum_attempts: int = 3,
    heartbeat: _Heartbeat | None = None,
    failure: RuntimeError | None = None,
    metrics: IMInboxMetrics | None = None,
) -> tuple[IMInboxWorker, SQLAlchemyIMMessageInboxRepository, _Consumer, _MutableClock, sessionmaker[Session]]:
    inbox_table = IMMessageInbox.metadata.tables[IMMessageInbox.__tablename__]
    IMMessageInbox.metadata.create_all(sqlite_engine, tables=[inbox_table])
    session_maker = sessionmaker(bind=sqlite_engine, expire_on_commit=False)
    repository = SQLAlchemyIMMessageInboxRepository(
        session_maker,
        _policy(maximum_attempts=maximum_attempts),
    )
    consumer = _Consumer(decision, failure=failure)
    clock = _MutableClock()
    worker = IMInboxWorker(
        repository=repository,
        consumer=consumer,
        clock=clock,
        heartbeat=heartbeat or _Heartbeat(),
        metrics=metrics or NoopIMInboxMetrics(),
    )
    return worker, repository, consumer, clock, session_maker


def _accept(repository: SQLAlchemyIMMessageInboxRepository, event_id: str = "event-1") -> IMInboxRecordId:
    return repository.insert_or_resolve(IntegrationId("integration-1"), _event(event_id), now=_NOW).record_id


def test_processing_policy_caps_exponential_retry_backoff() -> None:
    policy = _policy()

    assert tuple(policy.retry_delay(attempt) for attempt in range(1, 5)) == (
        timedelta(seconds=5),
        timedelta(seconds=10),
        timedelta(seconds=20),
        timedelta(seconds=20),
    )


def test_worker_claim_miss_does_not_call_consumer(sqlite_engine: Engine) -> None:
    worker, _, consumer, _, _ = _context(sqlite_engine, ConsumerDecision.SUCCEEDED)

    outcome = worker.process(IMInboxRecordId("missing"))

    assert outcome is InboxWorkerOutcome.CLAIM_MISS
    assert consumer.calls == []


@pytest.mark.parametrize(
    ("decision", "expected_outcome", "expected_status"),
    [
        (ConsumerDecision.SUCCEEDED, InboxWorkerOutcome.SUCCEEDED, "succeeded"),
        (ConsumerDecision.IGNORED, InboxWorkerOutcome.IGNORED, "ignored"),
        (ConsumerDecision.FAILED, InboxWorkerOutcome.FAILED, "failed"),
        (ConsumerDecision.RETRY, InboxWorkerOutcome.RETRIED, "pending"),
    ],
)
def test_worker_maps_consumer_decisions_to_fenced_transitions(
    sqlite_engine: Engine,
    decision: ConsumerDecision,
    expected_outcome: InboxWorkerOutcome,
    expected_status: str,
) -> None:
    worker, repository, consumer, _, session_maker = _context(sqlite_engine, decision)
    record_id = _accept(repository)

    outcome = worker.process(record_id)

    assert outcome is expected_outcome
    assert len(consumer.calls) == 1
    assert consumer.calls[0].event == _event()
    with session_maker() as session:
        stored = session.get_one(IMMessageInbox, str(record_id))
        assert stored.status.value == expected_status


def test_unexpected_consumer_exception_retries_without_logging_payload(
    sqlite_engine: Engine, caplog: pytest.LogCaptureFixture
) -> None:
    worker, repository, _, _, session_maker = _context(
        sqlite_engine,
        ConsumerDecision.SUCCEEDED,
        failure=RuntimeError("must-not-log"),
    )
    record_id = _accept(repository)

    outcome = worker.process(record_id)

    assert outcome is InboxWorkerOutcome.RETRIED
    assert "must-not-log" not in caplog.text
    with session_maker() as session:
        stored = session.get_one(IMMessageInbox, str(record_id))
        assert stored.status.value == "pending"
        assert stored.completed_at is None


def test_lost_lease_prevents_stale_terminal_write_and_allows_reclaim(sqlite_engine: Engine) -> None:
    metrics = _Metrics()
    worker, repository, _, clock, session_maker = _context(
        sqlite_engine,
        ConsumerDecision.SUCCEEDED,
        heartbeat=_Heartbeat(lease_held=False),
        metrics=metrics,
    )
    record_id = _accept(repository)

    outcome = worker.process(record_id)
    clock.current = _NOW + timedelta(seconds=31)
    reclaimed = repository.claim_by_id(record_id, now=clock.current)

    assert outcome is InboxWorkerOutcome.LOST_LEASE
    assert metrics.events == [
        (IMInboxMetricKind.CLAIM, IMProvider.FEISHU, "first_claim"),
        (IMInboxMetricKind.LOST_LEASE, IMProvider.FEISHU, "heartbeat"),
    ]
    assert reclaimed is not None
    assert reclaimed.attempt == 2
    with session_maker() as session:
        stored = session.get_one(IMMessageInbox, str(record_id))
        assert stored.status.value == "processing"


def test_retry_exhaustion_is_terminal_and_not_automatically_replayed(sqlite_engine: Engine) -> None:
    worker, repository, _, clock, session_maker = _context(
        sqlite_engine,
        ConsumerDecision.RETRY,
        maximum_attempts=1,
    )
    record_id = _accept(repository)

    first = worker.process(record_id)
    clock.current = _NOW + timedelta(hours=1)
    replay = worker.process(record_id)

    assert first is InboxWorkerOutcome.FAILED
    assert replay is InboxWorkerOutcome.CLAIM_MISS
    with session_maker() as session:
        assert session.get_one(IMMessageInbox, str(record_id)).status.value == "failed"


def test_worker_records_pending_retry_metric(sqlite_engine: Engine) -> None:
    metrics = _Metrics()
    worker, repository, _, _, _ = _context(
        sqlite_engine,
        ConsumerDecision.RETRY,
        metrics=metrics,
    )
    record_id = _accept(repository)

    outcome = worker.process(record_id)

    assert outcome is InboxWorkerOutcome.RETRIED
    assert metrics.events == [
        (IMInboxMetricKind.CLAIM, IMProvider.FEISHU, "first_claim"),
        (IMInboxMetricKind.RETRY, IMProvider.FEISHU, "pending"),
    ]


def test_pending_retry_is_not_reported_as_expired_lease_reclaim(sqlite_engine: Engine) -> None:
    metrics = _Metrics()
    worker, repository, consumer, clock, _ = _context(
        sqlite_engine,
        ConsumerDecision.RETRY,
        metrics=metrics,
    )
    record_id = _accept(repository)
    assert worker.process(record_id) is InboxWorkerOutcome.RETRIED
    consumer.decision = ConsumerDecision.SUCCEEDED
    clock.current = _NOW + timedelta(seconds=5)

    outcome = worker.process(record_id)

    assert outcome is InboxWorkerOutcome.SUCCEEDED
    assert all(kind is not IMInboxMetricKind.LEASE_RECLAIM for kind, _, _ in metrics.events)


def test_side_effect_before_lost_finalize_can_be_delivered_again(sqlite_engine: Engine) -> None:
    worker, repository, first_consumer, clock, _ = _context(
        sqlite_engine,
        ConsumerDecision.SUCCEEDED,
        heartbeat=_Heartbeat(lease_held=False),
    )
    record_id = _accept(repository)
    first = worker.process(record_id)
    clock.current = _NOW + timedelta(seconds=31)
    second_consumer = _Consumer(ConsumerDecision.SUCCEEDED)
    metrics = _Metrics()
    second_worker = IMInboxWorker(
        repository=repository,
        consumer=second_consumer,
        clock=clock,
        heartbeat=_Heartbeat(),
        metrics=metrics,
    )

    second = second_worker.process(record_id)

    assert first is InboxWorkerOutcome.LOST_LEASE
    assert second is InboxWorkerOutcome.SUCCEEDED
    assert len(first_consumer.calls) == 1
    assert len(second_consumer.calls) == 1
    assert metrics.events == [
        (IMInboxMetricKind.LEASE_RECLAIM, IMProvider.FEISHU, "reclaimed"),
        (IMInboxMetricKind.TERMINAL, IMProvider.FEISHU, "succeeded"),
    ]


def test_worker_crash_is_recovered_after_the_claim_lease_expires(sqlite_engine: Engine) -> None:
    metrics = _Metrics()
    worker, repository, consumer, clock, _ = _context(
        sqlite_engine,
        ConsumerDecision.SUCCEEDED,
        metrics=metrics,
    )
    record_id = _accept(repository)
    abandoned = repository.claim_by_id(
        record_id,
        now=clock.now(),
    )
    assert abandoned is not None
    clock.current = _NOW + timedelta(seconds=31)

    outcome = worker.process(record_id)

    assert outcome is InboxWorkerOutcome.SUCCEEDED
    assert len(consumer.calls) == 1
    assert metrics.events == [
        (IMInboxMetricKind.LEASE_RECLAIM, IMProvider.FEISHU, "reclaimed"),
        (IMInboxMetricKind.TERMINAL, IMProvider.FEISHU, "succeeded"),
    ]


def test_worker_atomically_fails_expired_claim_at_attempt_limit_without_calling_consumer(
    sqlite_engine: Engine,
) -> None:
    metrics = _Metrics()
    heartbeat = _Heartbeat()
    worker, repository, consumer, clock, session_maker = _context(
        sqlite_engine,
        ConsumerDecision.SUCCEEDED,
        maximum_attempts=1,
        heartbeat=heartbeat,
        metrics=metrics,
    )
    record_id = _accept(repository)
    abandoned = repository.claim_by_id(record_id, now=clock.now())
    assert abandoned is not None
    clock.current = _NOW + timedelta(seconds=31)
    wakeup_record_ids: list[IMInboxRecordId] = []
    recovery = IMInboxRecovery(
        repository=repository,
        wakeup=_Wakeup(wakeup_record_ids),
        clock=clock.now,
        batch_size=10,
        metrics=NoopIMInboxMetrics(),
    )

    recovery_result = recovery.dispatch_available()
    assert recovery_result.discovered == 1
    assert recovery_result.dispatched == 1
    assert wakeup_record_ids == [record_id]

    outcome = worker.process(wakeup_record_ids[0])

    assert outcome is InboxWorkerOutcome.ATTEMPTS_EXHAUSTED
    assert heartbeat.calls == []
    assert consumer.calls == []
    assert metrics.events == [
        (IMInboxMetricKind.RETRY, IMProvider.FEISHU, "exhausted"),
        (IMInboxMetricKind.TERMINAL, IMProvider.FEISHU, "failed"),
    ]
    with session_maker() as session:
        stored = session.get_one(IMMessageInbox, str(record_id))
        assert stored.status.value == "failed"
        assert stored.attempt_count == 1
        assert stored.claim_token is None
        assert stored.lease_expires_at is None
        assert stored.completed_at == datetime(2026, 8, 2, 8, 0, 31)


def test_duplicate_direct_and_recovery_wakeups_share_the_claim_path(sqlite_engine: Engine) -> None:
    worker, repository, consumer, clock, _ = _context(sqlite_engine, ConsumerDecision.SUCCEEDED)
    record_id = _accept(repository)
    wakeup_record_ids = [record_id]
    recovery = IMInboxRecovery(
        repository=repository,
        wakeup=_Wakeup(wakeup_record_ids),
        clock=clock.now,
        batch_size=10,
        metrics=NoopIMInboxMetrics(),
    )

    recovery.dispatch_available()
    outcomes = [worker.process(candidate) for candidate in wakeup_record_ids]

    assert wakeup_record_ids == [record_id, record_id]
    assert outcomes == [InboxWorkerOutcome.SUCCEEDED, InboxWorkerOutcome.CLAIM_MISS]
    assert len(consumer.calls) == 1


def test_worker_emits_claim_retry_and_terminal_metrics(sqlite_engine: Engine) -> None:
    metrics = _Metrics()
    worker, repository, _, _, _ = _context(
        sqlite_engine,
        ConsumerDecision.RETRY,
        maximum_attempts=1,
        metrics=metrics,
    )
    record_id = _accept(repository)

    outcome = worker.process(record_id)

    assert outcome is InboxWorkerOutcome.FAILED
    assert metrics.events == [
        (IMInboxMetricKind.CLAIM, IMProvider.FEISHU, "first_claim"),
        (IMInboxMetricKind.RETRY, IMProvider.FEISHU, "exhausted"),
        (IMInboxMetricKind.TERMINAL, IMProvider.FEISHU, "failed"),
    ]
