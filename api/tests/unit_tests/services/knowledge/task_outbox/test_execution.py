from dataclasses import dataclass, field
from datetime import datetime, timedelta
from threading import Event
from typing import override

import pytest
from sqlalchemy.orm import Session, sessionmaker

from models.knowledge_task import KnowledgeTaskOutbox
from repositories.knowledge.task_outbox_repository import (
    SQLAlchemyKnowledgeTaskStore,
    enqueue_knowledge_task,
)
from services.knowledge.task_outbox.application import KnowledgeTaskOutboxDispatcher
from services.knowledge.task_outbox.contracts import (
    KnowledgeTaskExecutionDeferredError,
    KnowledgeTaskExecutionLeaseLostError,
    KnowledgeTaskFailureDisposition,
    KnowledgeTaskIntent,
    KnowledgeTaskKind,
    KnowledgeTaskPermanentError,
    KnowledgeTaskRequeuedError,
    KnowledgeTaskRetriesExhaustedError,
)
from services.knowledge.task_outbox.execution import knowledge_task_execution


@dataclass
class WakeRecorder:
    result: bool
    calls: int = 0

    def __call__(self) -> bool:
        self.calls += 1
        return self.result


class FailingRequeueStore(SQLAlchemyKnowledgeTaskStore):
    @override
    def requeue_task_failure(
        self, *, intent_id: str, execution_id: str, available_at: datetime, error: str
    ) -> KnowledgeTaskFailureDisposition:
        del intent_id, execution_id, available_at, error
        raise RuntimeError("database unavailable")


class FailingCompletionStore(SQLAlchemyKnowledgeTaskStore):
    @override
    def mark_task_completed(self, *, intent_id: str, execution_id: str) -> bool:
        del intent_id, execution_id
        raise RuntimeError("database unavailable")


@dataclass
class RecordingPublisher:
    calls: list[str] = field(default_factory=list)
    fail: bool = False

    def publish(self, intent: KnowledgeTaskIntent) -> None:
        self.calls.append(intent.id)
        if self.fail:
            raise ConnectionError("broker unavailable")


@dataclass
class Clock:
    value: datetime

    def __call__(self) -> datetime:
        return self.value


def _claim_task(
    *,
    session: Session,
    store: SQLAlchemyKnowledgeTaskStore,
    now: datetime,
    kind: KnowledgeTaskKind = KnowledgeTaskKind.DOCUMENT_CLEANUP,
) -> KnowledgeTaskIntent:
    intent_id = enqueue_knowledge_task(
        session,
        kind=kind,
        tenant_id="tenant-1",
        dataset_id="dataset-1",
        document_id="document-1",
        payload={"document_id": "document-1"},
    )
    row = session.get(KnowledgeTaskOutbox, intent_id)
    assert row is not None
    row.available_at = now
    session.commit()
    claimed = store.claim_pending(
        now=now,
        lease_expired_before=now - timedelta(minutes=5),
        dispatched_expired_before=now - timedelta(hours=1),
        limit=1,
    )
    assert len(claimed) == 1
    return claimed[0]


def test_repeated_resource_contention_does_not_spend_execution_budget(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    now = datetime(2026, 10, 19, 12, 0)
    store = SQLAlchemyKnowledgeTaskStore(session_factory=sqlite_session_factory)
    intent = _claim_task(
        session=sqlite_session,
        store=store,
        now=now,
        kind=KnowledgeTaskKind.DOCUMENT_INDEX_RETRY,
    )

    for attempt in range(15):
        if attempt % 2:
            assert store.mark_dispatched(intent_id=intent.id, claim_id=intent.claim_id, dispatched_at=now)
        retry_at = now + timedelta(seconds=5)
        assert store.defer_task_delivery(intent_id=intent.id, available_at=retry_at, error="dataset lock busy")
        assert not store.mark_dispatched(intent_id=intent.id, claim_id=intent.claim_id, dispatched_at=now)
        assert (
            store.claim_pending(
                now=retry_at - timedelta(microseconds=1),
                lease_expired_before=now - timedelta(minutes=5),
                dispatched_expired_before=now - timedelta(hours=1),
                limit=1,
            )
            == ()
        )
        sqlite_session.expire_all()
        row = sqlite_session.get(KnowledgeTaskOutbox, intent.id)
        assert row is not None
        assert row.execution_attempts == 0
        assert row.status == "pending"
        assert row.last_error == "dataset lock busy"
        now = retry_at
        (intent,) = store.claim_pending(
            now=now,
            lease_expired_before=now - timedelta(minutes=5),
            dispatched_expired_before=now - timedelta(hours=1),
            limit=1,
        )

    executions = 0
    with knowledge_task_execution(intent.id, store=store, clock=lambda: now, wake=WakeRecorder(True)) as lease:
        assert lease is not None
        executions += 1

    sqlite_session.expire_all()
    row = sqlite_session.get(KnowledgeTaskOutbox, intent.id)
    assert row is not None
    assert row.attempts == 16
    assert row.execution_attempts == 1
    assert row.status == "completed"
    assert executions == 1


@pytest.mark.parametrize("status", ["pending", "executing", "completed", "failed"])
def test_contention_cannot_reopen_another_execution_or_terminal_intent(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
    status: str,
) -> None:
    now = datetime(2026, 10, 19, 12, 0)
    store = SQLAlchemyKnowledgeTaskStore(session_factory=sqlite_session_factory)
    intent = _claim_task(session=sqlite_session, store=store, now=now)
    row = sqlite_session.get(KnowledgeTaskOutbox, intent.id)
    assert row is not None
    row.status = status
    row.claim_id = "current-owner"
    row.claimed_at = now
    row.available_at = now + timedelta(minutes=5)
    row.execution_attempts = 3
    row.last_error = "current state"
    sqlite_session.commit()

    assert not store.defer_task_delivery(
        intent_id=intent.id, available_at=now + timedelta(seconds=5), error="stale delivery"
    )

    sqlite_session.refresh(row)
    assert row.status == status
    assert row.claim_id == "current-owner"
    assert row.claimed_at == now
    assert row.available_at == now + timedelta(minutes=5)
    assert row.execution_attempts == 3
    assert row.last_error == "current state"


@pytest.mark.parametrize("kind", list(KnowledgeTaskKind))
def test_fast_consumer_completion_wins_over_dispatch_mark_and_is_never_reclaimed(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
    kind: KnowledgeTaskKind,
) -> None:
    now = datetime(2026, 10, 19, 12, 0)
    store = SQLAlchemyKnowledgeTaskStore(session_factory=sqlite_session_factory)
    intent = _claim_task(session=sqlite_session, store=store, now=now, kind=kind)
    wake = WakeRecorder(result=True)

    with knowledge_task_execution(intent.id, store=store, clock=lambda: now, wake=wake):
        pass

    assert wake.calls == 0
    assert not store.mark_dispatched(intent_id=intent.id, claim_id=intent.claim_id, dispatched_at=now)
    sqlite_session.expire_all()
    row = sqlite_session.get(KnowledgeTaskOutbox, intent.id)
    assert row is not None
    assert row.status == "completed"
    assert (
        store.claim_pending(
            now=now + timedelta(days=1),
            lease_expired_before=now + timedelta(hours=23),
            dispatched_expired_before=now + timedelta(hours=23),
            limit=1,
        )
        == ()
    )


@pytest.mark.parametrize("kind", list(KnowledgeTaskKind))
def test_fast_consumer_failure_stays_pending_when_dispatcher_wake_fails(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
    kind: KnowledgeTaskKind,
) -> None:
    now = datetime(2026, 10, 19, 12, 0)
    store = SQLAlchemyKnowledgeTaskStore(session_factory=sqlite_session_factory)
    intent = _claim_task(session=sqlite_session, store=store, now=now, kind=kind)
    wake = WakeRecorder(result=False)

    with pytest.raises(KnowledgeTaskRequeuedError, match="durably requeued"):
        with knowledge_task_execution(intent.id, store=store, clock=lambda: now, wake=wake):
            raise RuntimeError("storage unavailable")

    assert wake.calls == 1
    assert not store.mark_dispatched(intent_id=intent.id, claim_id=intent.claim_id, dispatched_at=now)
    sqlite_session.expire_all()
    row = sqlite_session.get(KnowledgeTaskOutbox, intent.id)
    assert row is not None
    assert row.status == "pending"
    assert row.available_at == now + timedelta(seconds=5)
    assert row.last_error == "storage unavailable"
    assert row.claim_id is None
    assert row.claimed_at is None
    assert row.dispatched_at is None


def test_bookkeeping_failure_preserves_original_error_until_database_recovers(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    now = datetime(2026, 10, 19, 12, 0)
    healthy_store = SQLAlchemyKnowledgeTaskStore(session_factory=sqlite_session_factory)
    intent = _claim_task(session=sqlite_session, store=healthy_store, now=now)
    failing_store = FailingRequeueStore(session_factory=sqlite_session_factory)
    wake = WakeRecorder(result=True)

    with pytest.raises(ValueError, match="task failed"):
        with knowledge_task_execution(intent.id, store=failing_store, clock=lambda: now, wake=wake):
            raise ValueError("task failed")

    sqlite_session.expire_all()
    row = sqlite_session.get(KnowledgeTaskOutbox, intent.id)
    assert row is not None
    assert row.status == "executing"
    assert wake.calls == 0

    with pytest.raises(KnowledgeTaskRequeuedError):
        with knowledge_task_execution(
            intent.id, store=healthy_store, clock=lambda: now + timedelta(minutes=6), wake=wake
        ):
            raise ValueError("task failed")

    sqlite_session.expire_all()
    row = sqlite_session.get(KnowledgeTaskOutbox, intent.id)
    assert row is not None
    assert row.status == "pending"
    assert wake.calls == 1


def test_failed_duplicate_does_not_reopen_completed_task(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    now = datetime(2026, 10, 19, 12, 0)
    store = SQLAlchemyKnowledgeTaskStore(session_factory=sqlite_session_factory)
    intent = _claim_task(session=sqlite_session, store=store, now=now)
    wake = WakeRecorder(result=True)
    with knowledge_task_execution(intent.id, store=store, clock=lambda: now, wake=wake):
        pass

    with knowledge_task_execution(intent.id, store=store, clock=lambda: now, wake=wake) as duplicate:
        assert duplicate is None

    sqlite_session.expire_all()
    row = sqlite_session.get(KnowledgeTaskOutbox, intent.id)
    assert row is not None
    assert row.status == "completed"
    assert wake.calls == 0


def test_stale_dispatch_recovers_after_completion_bookkeeping_failure(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    now = datetime(2026, 10, 19, 12, 0)
    healthy_store = SQLAlchemyKnowledgeTaskStore(session_factory=sqlite_session_factory)
    intent = _claim_task(session=sqlite_session, store=healthy_store, now=now)
    assert healthy_store.mark_dispatched(intent_id=intent.id, claim_id=intent.claim_id, dispatched_at=now)
    failing_store = FailingCompletionStore(session_factory=sqlite_session_factory)

    execution = knowledge_task_execution(
        intent.id,
        store=failing_store,
        clock=lambda: now,
        wake=WakeRecorder(result=True),
    )
    with pytest.raises(RuntimeError, match="database unavailable"):
        with execution:
            pass

    sqlite_session.expire_all()
    row = sqlite_session.get(KnowledgeTaskOutbox, intent.id)
    assert row is not None
    assert row.status == "executing"

    publisher = RecordingPublisher()
    dispatcher = KnowledgeTaskOutboxDispatcher(
        store=healthy_store,
        publisher=publisher,
        clock=lambda: now + timedelta(hours=2),
        execution_recovery_seconds=3600,
    )
    result = dispatcher.dispatch_pending(limit=1)

    assert result.claimed == 1
    assert publisher.calls == [intent.id]


def test_permanent_resource_state_fails_intent_without_requeue(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    now = datetime(2026, 10, 19, 12, 0)
    store = SQLAlchemyKnowledgeTaskStore(session_factory=sqlite_session_factory)
    intent = _claim_task(session=sqlite_session, store=store, now=now, kind=KnowledgeTaskKind.SEGMENT_INDEX_ENABLE)
    wake = WakeRecorder(result=True)
    with pytest.raises(KnowledgeTaskPermanentError, match="archived"):
        with knowledge_task_execution(intent.id, store=store, clock=lambda: now, wake=wake):
            raise KnowledgeTaskPermanentError("document is archived")
    sqlite_session.expire_all()
    row = sqlite_session.get(KnowledgeTaskOutbox, intent.id)
    assert row is not None
    assert row.status == "failed"
    assert row.last_error == "document is archived"
    assert wake.calls == 0
    assert not store.mark_dispatched(intent_id=intent.id, claim_id=intent.claim_id, dispatched_at=now)
    assert (
        store.claim_pending(
            now=now + timedelta(days=1),
            lease_expired_before=now + timedelta(hours=23),
            dispatched_expired_before=now + timedelta(hours=23),
            limit=1,
        )
        == ()
    )


def test_index_failure_budget_is_terminal_and_preserves_last_error(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    now = datetime(2026, 10, 19, 12, 0)
    store = SQLAlchemyKnowledgeTaskStore(session_factory=sqlite_session_factory)
    intent = _claim_task(session=sqlite_session, store=store, now=now, kind=KnowledgeTaskKind.SEGMENT_INDEX_ENABLE)
    row = sqlite_session.get(KnowledgeTaskOutbox, intent.id)
    assert row is not None
    row.execution_attempts = 9
    sqlite_session.commit()
    wake = WakeRecorder(result=True)
    with pytest.raises(KnowledgeTaskRetriesExhaustedError):
        with knowledge_task_execution(intent.id, store=store, clock=lambda: now, wake=wake):
            raise RuntimeError("provider unavailable")
    sqlite_session.expire_all()
    row = sqlite_session.get(KnowledgeTaskOutbox, intent.id)
    assert row is not None
    assert row.status == "failed"
    assert row.last_error == "provider unavailable"
    assert wake.calls == 0


def test_cleanup_keeps_recoverable_intent_with_capped_exponential_backoff(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    now = datetime(2026, 10, 19, 12, 0)
    store = SQLAlchemyKnowledgeTaskStore(session_factory=sqlite_session_factory)
    intent = _claim_task(session=sqlite_session, store=store, now=now)
    row = sqlite_session.get(KnowledgeTaskOutbox, intent.id)
    assert row is not None
    row.execution_attempts = 20
    sqlite_session.commit()
    with pytest.raises(KnowledgeTaskRequeuedError):
        with knowledge_task_execution(intent.id, store=store, clock=lambda: now, wake=WakeRecorder(result=True)):
            raise RuntimeError("storage unavailable")
    sqlite_session.expire_all()
    row = sqlite_session.get(KnowledgeTaskOutbox, intent.id)
    assert row is not None
    assert row.status == "pending"
    assert row.available_at == now + timedelta(minutes=15)


def test_active_execution_renews_past_dispatch_recovery_window_and_rejects_duplicate(
    sqlite_session: Session, sqlite_session_factory: sessionmaker[Session]
) -> None:
    clock = Clock(datetime(2026, 10, 19, 12))
    store = SQLAlchemyKnowledgeTaskStore(session_factory=sqlite_session_factory)
    intent = _claim_task(session=sqlite_session, store=store, now=clock())
    publisher = RecordingPublisher()
    dispatcher = KnowledgeTaskOutboxDispatcher(store=store, publisher=publisher, clock=clock)

    with knowledge_task_execution(intent.id, store=store, clock=clock, wake=lambda: True) as execution:
        assert execution is not None
        for _ in range(40):
            clock.value += timedelta(minutes=1)
            execution.assert_owned()
        assert dispatcher.dispatch_pending(limit=10).claimed == 0
        with knowledge_task_execution(intent.id, store=store, clock=clock, wake=lambda: True) as duplicate:
            assert duplicate is None
        sqlite_session.expire_all()
        row = sqlite_session.get(KnowledgeTaskOutbox, intent.id)
        assert row is not None
        assert row.execution_attempts == 1

    assert publisher.calls == []


def test_expired_execution_cannot_complete_fail_or_requeue_its_successor(
    sqlite_session: Session, sqlite_session_factory: sessionmaker[Session]
) -> None:
    now = datetime(2026, 10, 19, 12)
    store = SQLAlchemyKnowledgeTaskStore(session_factory=sqlite_session_factory)
    intent = _claim_task(session=sqlite_session, store=store, now=now)
    previous = store.begin_task_execution(intent_id=intent.id, now=now, lease_until=now + timedelta(minutes=5))
    assert previous is not None
    recovered = store.claim_pending(
        now=now + timedelta(minutes=6),
        lease_expired_before=now + timedelta(minutes=1),
        dispatched_expired_before=now - timedelta(minutes=9),
        limit=1,
    )
    assert len(recovered) == 1
    successor = store.begin_task_execution(
        intent_id=intent.id, now=now + timedelta(minutes=6), lease_until=now + timedelta(minutes=11)
    )
    assert successor is not None
    assert successor != previous
    assert store.is_recovered_task_execution(intent_id=intent.id, execution_id=successor)
    assert not store.mark_task_completed(intent_id=intent.id, execution_id=previous)
    assert not store.mark_task_failed(intent_id=intent.id, execution_id=previous, error="stale")
    assert (
        store.requeue_task_failure(
            intent_id=intent.id, execution_id=previous, available_at=now + timedelta(minutes=7), error="stale"
        )
        == KnowledgeTaskFailureDisposition.MISSING
    )
    sqlite_session.expire_all()
    row = sqlite_session.get(KnowledgeTaskOutbox, intent.id)
    assert row is not None
    assert row.status == "executing"
    assert row.claim_id == successor
    assert row.execution_attempts == 2


def test_direct_delivery_takeover_marks_an_expired_execution_as_recovered(
    sqlite_session: Session, sqlite_session_factory: sessionmaker[Session]
) -> None:
    now = datetime(2026, 10, 19, 12)
    store = SQLAlchemyKnowledgeTaskStore(session_factory=sqlite_session_factory)
    intent = _claim_task(
        session=sqlite_session,
        store=store,
        now=now,
        kind=KnowledgeTaskKind.DOCUMENT_INDEX_RETRY,
    )
    previous = store.begin_task_execution(intent_id=intent.id, now=now, lease_until=now + timedelta(minutes=5))
    assert previous is not None

    successor = store.begin_task_execution(
        intent_id=intent.id,
        now=now + timedelta(minutes=6),
        lease_until=now + timedelta(minutes=11),
    )

    assert successor is not None
    assert successor != previous
    assert store.is_recovered_task_execution(intent_id=intent.id, execution_id=successor)
    assert not store.mark_task_completed(intent_id=intent.id, execution_id=previous)


def test_active_execution_deferral_preserves_execution_budget_and_wakes_dispatcher(
    sqlite_session: Session, sqlite_session_factory: sessionmaker[Session]
) -> None:
    now = datetime(2026, 10, 19, 12)
    store = SQLAlchemyKnowledgeTaskStore(session_factory=sqlite_session_factory)
    intent = _claim_task(session=sqlite_session, store=store, now=now)
    wake = WakeRecorder(True)

    def defer_execution() -> None:
        with knowledge_task_execution(intent.id, store=store, clock=lambda: now, wake=wake) as execution:
            assert execution is not None
            execution.defer(error="cleanup gate closed", delay_seconds=30)

    with pytest.raises(KnowledgeTaskExecutionDeferredError, match="durably deferred"):
        defer_execution()

    sqlite_session.expire_all()
    row = sqlite_session.get(KnowledgeTaskOutbox, intent.id)
    assert row is not None
    assert row.status == "pending"
    assert row.execution_attempts == 0
    assert row.available_at == now + timedelta(seconds=30)
    assert row.last_error == "cleanup gate closed"
    assert wake.calls == 1


def test_broker_failures_do_not_consume_first_execution_retry_budget(
    sqlite_session: Session, sqlite_session_factory: sessionmaker[Session]
) -> None:
    clock = Clock(datetime(2026, 10, 19, 12))
    store = SQLAlchemyKnowledgeTaskStore(session_factory=sqlite_session_factory)
    intent = _claim_task(session=sqlite_session, store=store, now=clock(), kind=KnowledgeTaskKind.DOCUMENT_INDEX_CREATE)
    assert store.release_for_retry(intent_id=intent.id, claim_id=intent.claim_id, available_at=clock(), error="broker")
    dispatcher = KnowledgeTaskOutboxDispatcher(store=store, publisher=RecordingPublisher(fail=True), clock=clock)
    for _ in range(12):
        assert dispatcher.dispatch_pending(limit=1).deferred == 1
        clock.value += timedelta(minutes=10)

    def execute_with_provider_failure() -> None:
        with knowledge_task_execution(intent.id, store=store, clock=clock, wake=lambda: True) as execution:
            assert execution is not None
            raise RuntimeError("temporary provider failure")

    with pytest.raises(KnowledgeTaskRequeuedError):
        execute_with_provider_failure()
    sqlite_session.expire_all()
    row = sqlite_session.get(KnowledgeTaskOutbox, intent.id)
    assert row is not None
    assert row.status == "pending"
    assert row.attempts == 13
    assert row.execution_attempts == 1
    assert row.available_at == clock() + timedelta(seconds=5)


def test_execution_heartbeat_renews_using_short_sessions(
    sqlite_session: Session, sqlite_session_factory: sessionmaker[Session]
) -> None:
    renewed = Event()

    class HeartbeatStore(SQLAlchemyKnowledgeTaskStore):
        @override
        def renew_task_execution(
            self, *, intent_id: str, execution_id: str, now: datetime, lease_until: datetime
        ) -> bool:
            result = super().renew_task_execution(
                intent_id=intent_id, execution_id=execution_id, now=now, lease_until=lease_until
            )
            renewed.set()
            return result

    now = datetime(2026, 10, 19, 12)
    store = HeartbeatStore(session_factory=sqlite_session_factory)
    intent = _claim_task(session=sqlite_session, store=store, now=now)
    with knowledge_task_execution(
        intent.id, store=store, clock=lambda: now, wake=lambda: True, heartbeat_interval=0.01
    ) as execution:
        assert execution is not None
        assert renewed.wait(timeout=2)


def test_lost_tenant_admission_stops_database_execution_renewal(
    sqlite_session: Session, sqlite_session_factory: sessionmaker[Session]
) -> None:
    clock = Clock(datetime(2026, 10, 19, 12))
    store = SQLAlchemyKnowledgeTaskStore(session_factory=sqlite_session_factory)
    intent = _claim_task(session=sqlite_session, store=store, now=clock())
    admitted = True

    def assert_admitted() -> None:
        if not admitted:
            raise RuntimeError("tenant capacity claim expired")

    def execute_after_admission_loss() -> None:
        nonlocal admitted
        with knowledge_task_execution(
            intent.id, store=store, clock=clock, wake=lambda: True, assert_admitted=assert_admitted
        ) as execution:
            assert execution is not None
            execution.assert_owned()
            clock.value += timedelta(minutes=1)
            admitted = False
            execution.assert_owned()

    with pytest.raises(KnowledgeTaskExecutionLeaseLostError):
        execute_after_admission_loss()

    sqlite_session.expire_all()
    row = sqlite_session.get(KnowledgeTaskOutbox, intent.id)
    assert row is not None
    assert row.status == "executing"
    assert row.execution_attempts == 1
    assert row.available_at == datetime(2026, 10, 19, 12, 5)


def test_exhausted_redelivery_repeats_terminal_notification_without_running_body(
    sqlite_session: Session, sqlite_session_factory: sessionmaker[Session]
) -> None:
    now = datetime(2026, 10, 19, 12)
    store = SQLAlchemyKnowledgeTaskStore(session_factory=sqlite_session_factory)
    intent = _claim_task(session=sqlite_session, store=store, now=now, kind=KnowledgeTaskKind.DOCUMENT_INDEX_CREATE)
    row = sqlite_session.get(KnowledgeTaskOutbox, intent.id)
    assert row is not None
    row.status = "failed"
    row.execution_attempts = 10
    row.last_error = "provider unavailable"
    sqlite_session.commit()
    executed: list[str] = []

    with pytest.raises(KnowledgeTaskRetriesExhaustedError, match="provider unavailable"):
        with knowledge_task_execution(intent.id, store=store, clock=lambda: now, wake=lambda: True):
            executed.append(intent.id)

    sqlite_session.expire_all()
    assert executed == []
    row = sqlite_session.get(KnowledgeTaskOutbox, intent.id)
    assert row is not None
    assert row.status == "failed"
    assert row.execution_attempts == 10
