from __future__ import annotations

import threading
from collections.abc import Callable, Generator
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Never

import pytest
from sqlalchemy.orm import Session, sessionmaker

from libs import acknowledged_task_queue as acknowledged_queue
from libs.acknowledged_task_queue import (
    AcknowledgedTaskClaim,
    AcknowledgedTaskClaimAlreadyActiveError,
    AcknowledgedTaskClaimLostError,
    AcknowledgedTaskCompletion,
)
from models.knowledge_task import KnowledgeTaskOutbox
from repositories.knowledge.task_outbox_repository import SQLAlchemyKnowledgeTaskStore, enqueue_knowledge_task
from services.knowledge.task_outbox import tenant_queue as queue_module
from services.knowledge.task_outbox.application import KnowledgeTaskOutboxDispatcher
from services.knowledge.task_outbox.contracts import KnowledgeTaskIntent, KnowledgeTaskKind, KnowledgeTaskRequeuedError
from services.knowledge.task_outbox.execution import EXECUTION_LEASE_SECONDS, knowledge_task_execution
from services.knowledge.task_outbox.tenant_queue import (
    KnowledgeTenantTask,
    KnowledgeTenantTaskAlreadyEnqueuedError,
    KnowledgeTenantTaskQueue,
    dispatch_knowledge_task_claims,
    enqueue_knowledge_tenant_task,
    knowledge_tenant_task_admission,
)


@dataclass
class _Queue:
    start_error: Exception | None = None
    renew_result: bool = True
    completion_failures: int = 0
    started: list[str] = field(default_factory=list)
    active: set[str] = field(default_factory=set)
    renewed: list[str] = field(default_factory=list)
    completed: list[tuple[str, int]] = field(default_factory=list)
    reset: list[str] = field(default_factory=list)
    released: list[str] = field(default_factory=list)

    def start(self, receipt: str) -> None:
        if self.start_error is not None:
            raise self.start_error
        if receipt in self.active:
            raise AcknowledgedTaskClaimAlreadyActiveError(receipt)
        self.active.add(receipt)
        self.started.append(receipt)

    @contextmanager
    def heartbeat(self, receipt: str) -> Generator[None]:
        assert receipt in self.started
        yield

    def complete(self, receipt: str, *, concurrency: int) -> AcknowledgedTaskCompletion[KnowledgeTenantTask]:
        if self.completion_failures:
            self.completion_failures -= 1
            raise ConnectionError("completion unavailable")
        self.active.discard(receipt)
        self.completed.append((receipt, concurrency))
        return AcknowledgedTaskCompletion(owned=True, next_claims=())

    def renew(self, receipt: str) -> bool:
        self.renewed.append(receipt)
        return self.renew_result and receipt in self.active

    def reset_active(self, receipt: str) -> bool:
        self.active.discard(receipt)
        self.reset.append(receipt)
        return True

    def release(self, receipt: str) -> bool:
        self.released.append(receipt)
        return True


@dataclass(frozen=True)
class _Published:
    task_name: str
    queue_name: str
    args: tuple[object, ...]
    kwargs: dict[str, object]
    task_id: str


class _Signature:
    def __init__(self, factory: _SignatureFactory, task_name: str, queue_name: str) -> None:
        self._factory = factory
        self._task_name = task_name
        self._queue_name = queue_name

    def apply_async(self, *, args: tuple[object, ...], kwargs: dict[str, object], task_id: str) -> None:
        self._factory.published.append(
            _Published(
                task_name=self._task_name,
                queue_name=self._queue_name,
                args=args,
                kwargs=kwargs,
                task_id=task_id,
            )
        )


class _SignatureFactory:
    def __init__(self) -> None:
        self.published: list[_Published] = []

    def __call__(self, task_name: str, *, queue: str) -> _Signature:
        return _Signature(self, task_name, queue)


class _UnusedRedis:
    def register_script(self, _script: str) -> Never:
        raise AssertionError("constructor must not access Redis")


@dataclass
class _RedisState:
    pending: list[str] = field(default_factory=list)
    claims: dict[str, str] = field(default_factory=dict)
    active: set[str] = field(default_factory=set)
    identities: set[str] = field(default_factory=set)


class _StateRedis:
    """Small atomic Redis model for the durable SQL-to-Redis handoff."""

    def __init__(self) -> None:
        self.state = _RedisState()
        self._lock = threading.Lock()

    def register_script(self, script: str) -> Callable[..., object]:
        def execute(*, keys: list[str], args: list[object]) -> object:
            del keys
            with self._lock:
                if script == acknowledged_queue.REGISTER_SCOPE_LUA:
                    return 1
                if script == acknowledged_queue.ENQUEUE_AND_CLAIM_LUA:
                    identity = str(args[3])
                    accepted = int(identity not in self.state.identities)
                    if accepted:
                        self.state.identities.add(identity)
                        self.state.pending.insert(0, f"{identity}\0{args[0]}")
                    return [accepted, *self._claim(_as_int(args[1]), args[4:])]
                if script == acknowledged_queue.COMPLETE_AND_CLAIM_LUA:
                    receipt = str(args[0])
                    payload = self.state.claims.pop(receipt, None)
                    self.state.active.discard(receipt)
                    if payload is not None:
                        self.state.identities.discard(payload.partition("\0")[0])
                    return [int(payload is not None), *self._claim(_as_int(args[1]), args[3:])]
                if script == acknowledged_queue.START_CLAIM_LUA:
                    receipt = str(args[0])
                    if receipt not in self.state.claims:
                        return 0
                    if receipt in self.state.active:
                        return 2
                    self.state.active.add(receipt)
                    return 1
                if script == acknowledged_queue.RENEW_CLAIM_LUA:
                    receipt = str(args[0])
                    return int(receipt in self.state.claims and receipt in self.state.active)
                if script == acknowledged_queue.RESET_ACTIVE_CLAIM_LUA:
                    receipt = str(args[0])
                    if receipt not in self.state.claims:
                        return 0
                    self.state.active.discard(receipt)
                    return 1
                if script == acknowledged_queue.RELEASE_CLAIM_LUA:
                    receipt = str(args[0])
                    payload = self.state.claims.pop(receipt, None)
                    self.state.active.discard(receipt)
                    if payload is None:
                        return 0
                    self.state.pending.insert(0, payload)
                    return 1
                raise AssertionError("unexpected Redis script")

        return execute

    def _claim(self, concurrency: int, receipts: list[object]) -> list[str]:
        result: list[str] = []
        for receipt_value in receipts[: max(0, concurrency - len(self.state.claims))]:
            if not self.state.pending:
                break
            receipt = str(receipt_value)
            payload = self.state.pending.pop()
            self.state.claims[receipt] = payload
            result.extend((receipt, payload))
        return result


class _Tokens:
    def __init__(self) -> None:
        self._value = 0

    def __call__(self) -> str:
        self._value += 1
        return f"receipt-{self._value}"


def _as_int(value: object) -> int:
    assert isinstance(value, int)
    return value


@dataclass
class _Clock:
    value: datetime

    def __call__(self) -> datetime:
        return self.value


@dataclass
class _TenantQueuePublisher:
    task: KnowledgeTenantTask

    def publish(self, intent: KnowledgeTaskIntent) -> None:
        enqueue_knowledge_tenant_task(
            intent.tenant_id,
            KnowledgeTenantTask(
                task_name=self.task.task_name,
                queue_name=self.task.queue_name,
                args=self.task.args,
                task_id=f"knowledge-outbox:{intent.id}",
            ),
            concurrency=1,
        )


def _task() -> KnowledgeTenantTask:
    return KnowledgeTenantTask(
        task_name="tasks.document_indexing_task.priority_document_indexing_task",
        queue_name="priority_dataset",
        args=("tenant-1", "dataset-1", ["document-1"], {"document-1": "generation-1"}, "outbox-1"),
        task_id="knowledge-outbox:outbox-1",
    )


def test_task_round_trip_preserves_durable_indexing_arguments() -> None:
    task = _task()

    assert KnowledgeTenantTask.deserialize(task.serialize()) == task


def test_knowledge_claim_outlives_database_execution_lease_by_a_bounded_margin() -> None:
    queue = KnowledgeTenantTaskQueue("tenant-1", redis=_UnusedRedis())  # type: ignore[arg-type]

    assert queue._lease_seconds == EXECUTION_LEASE_SECONDS + 60
    assert queue._heartbeat_seconds <= 30


def test_dispatch_adds_only_the_queue_receipt_to_the_worker_call(monkeypatch: pytest.MonkeyPatch) -> None:
    task = _task()
    queue = _Queue()
    publisher = _SignatureFactory()
    monkeypatch.setattr(queue_module, "signature", publisher)

    dispatched = dispatch_knowledge_task_claims(
        tenant_id="tenant-1",
        queue=queue,  # type: ignore[arg-type]
        claims=(AcknowledgedTaskClaim(receipt="receipt-1", task=task),),
    )

    assert dispatched == 1
    assert publisher.published == [
        _Published(
            task_name=task.task_name,
            queue_name="priority_dataset",
            args=task.args,
            kwargs={"tenant_queue_receipt": "receipt-1"},
            task_id="knowledge-outbox:outbox-1",
        )
    ]


def test_admission_completes_capacity_after_success(monkeypatch: pytest.MonkeyPatch) -> None:
    queue = _Queue()
    monkeypatch.setattr(queue_module, "KnowledgeTenantTaskQueue", lambda _tenant_id: queue)

    with knowledge_tenant_task_admission("tenant-1", "receipt-1", concurrency=1) as admitted:
        assert admitted is not None
        admitted.assert_owned()

    assert queue.started == ["receipt-1"]
    assert queue.renewed == ["receipt-1"]
    assert queue.completed == [("receipt-1", 1)]
    assert queue.reset == []


def test_admission_skips_duplicate_delivery_before_work(monkeypatch: pytest.MonkeyPatch) -> None:
    queue = _Queue(start_error=AcknowledgedTaskClaimAlreadyActiveError("active"))
    monkeypatch.setattr(queue_module, "KnowledgeTenantTaskQueue", lambda _tenant_id: queue)

    with knowledge_tenant_task_admission("tenant-1", "receipt-1", concurrency=1) as admitted:
        assert admitted is None

    assert queue.completed == []


def test_legacy_admission_returns_noop_lease() -> None:
    with knowledge_tenant_task_admission("tenant-1", None, concurrency=1) as admitted:
        assert admitted is not None
        admitted.assert_owned()


def test_lease_detects_lost_redis_ownership(monkeypatch: pytest.MonkeyPatch) -> None:
    queue = _Queue(renew_result=False)
    monkeypatch.setattr(queue_module, "KnowledgeTenantTaskQueue", lambda _tenant_id: queue)

    def assert_admitted() -> None:
        with knowledge_tenant_task_admission("tenant-1", "receipt-1", concurrency=1) as admitted:
            assert admitted is not None
            admitted.assert_owned()

    with pytest.raises(AcknowledgedTaskClaimLostError, match="no longer owned"):
        assert_admitted()

    assert queue.reset == ["receipt-1"]


def test_admission_resets_active_marker_for_celery_retry(monkeypatch: pytest.MonkeyPatch) -> None:
    queue = _Queue()
    monkeypatch.setattr(queue_module, "KnowledgeTenantTaskQueue", lambda _tenant_id: queue)

    with pytest.raises(ConnectionError, match="database unavailable"):
        with knowledge_tenant_task_admission("tenant-1", "receipt-1", concurrency=1):
            raise ConnectionError("database unavailable")

    assert queue.reset == ["receipt-1"]
    assert queue.completed == []


def test_admission_releases_capacity_after_durable_requeue(monkeypatch: pytest.MonkeyPatch) -> None:
    queue = _Queue()
    monkeypatch.setattr(queue_module, "KnowledgeTenantTaskQueue", lambda _tenant_id: queue)

    with pytest.raises(KnowledgeTaskRequeuedError, match="requeued"):
        with knowledge_tenant_task_admission("tenant-1", "receipt-1", concurrency=1):
            raise KnowledgeTaskRequeuedError("requeued")

    assert queue.completed == [("receipt-1", 1)]
    assert queue.reset == []


def test_sql_retry_waits_for_previous_redis_identity_handoff(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    now = datetime(2026, 10, 20, 12)
    store = SQLAlchemyKnowledgeTaskStore(session_factory=sqlite_session_factory)
    intent_id = enqueue_knowledge_task(
        sqlite_session,
        kind=KnowledgeTaskKind.DOCUMENT_INDEX_CREATE,
        tenant_id="tenant-1",
        dataset_id="dataset-1",
        document_id="document-1",
        payload={"document_id": "document-1"},
    )
    row = sqlite_session.get(KnowledgeTaskOutbox, intent_id)
    assert row is not None
    row.available_at = now
    sqlite_session.commit()
    (initial_intent,) = store.claim_pending(
        now=now,
        lease_expired_before=now - timedelta(minutes=5),
        dispatched_expired_before=now - timedelta(hours=1),
        limit=1,
    )

    redis = _StateRedis()
    queue = KnowledgeTenantTaskQueue(
        "tenant-1",
        redis=redis,
        token_factory=_Tokens(),
        lease_seconds=10,
        heartbeat_seconds=2,
    )
    signatures = _SignatureFactory()
    monkeypatch.setattr(queue_module, "KnowledgeTenantTaskQueue", lambda _tenant_id: queue)
    monkeypatch.setattr(queue_module, "signature", signatures)
    publisher = _TenantQueuePublisher(task=_task())

    publisher.publish(initial_intent)
    assert store.mark_dispatched(intent_id=intent_id, claim_id=initial_intent.claim_id, dispatched_at=now)
    original_receipt = str(signatures.published[0].kwargs["tenant_queue_receipt"])
    queue.start(original_receipt)

    clock = _Clock(now)
    with pytest.raises(KnowledgeTaskRequeuedError, match="durably requeued"):
        with knowledge_task_execution(intent_id, store=store, clock=clock, wake=lambda: True):
            raise RuntimeError("provider unavailable")

    # The SQL retry becomes due while the old worker's Redis heartbeat is
    # shutting down. Redis rejects the duplicate identity, so this delivery
    # must stay pending rather than being recorded as dispatched without a
    # corresponding broker message.
    clock.value += timedelta(seconds=5)
    dispatcher = KnowledgeTaskOutboxDispatcher(store=store, publisher=publisher, clock=clock)
    duplicate = dispatcher.dispatch_pending(limit=1)
    sqlite_session.expire_all()
    row = sqlite_session.get(KnowledgeTaskOutbox, intent_id)
    assert duplicate.deferred == 1
    assert row is not None
    assert row.status == "pending"
    assert row.dispatched_at is None
    assert row.execution_attempts == 1
    assert len(signatures.published) == 1

    completion = queue.complete(original_receipt, concurrency=1)
    assert completion.owned is True
    clock.value = row.available_at
    recovered = dispatcher.dispatch_pending(limit=1)

    sqlite_session.expire_all()
    row = sqlite_session.get(KnowledgeTaskOutbox, intent_id)
    assert recovered.dispatched == 1
    assert row is not None
    assert row.status == "dispatched"
    assert row.attempts == 3
    assert row.execution_attempts == 1
    assert len(signatures.published) == 2
    assert signatures.published[1].kwargs["tenant_queue_receipt"] != original_receipt


def test_duplicate_redis_identity_is_a_retryable_publisher_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    redis = _StateRedis()
    queue = KnowledgeTenantTaskQueue(
        "tenant-1", redis=redis, token_factory=_Tokens(), lease_seconds=10, heartbeat_seconds=2
    )
    monkeypatch.setattr(queue_module, "KnowledgeTenantTaskQueue", lambda _tenant_id: queue)
    monkeypatch.setattr(queue_module, "signature", _SignatureFactory())

    assert enqueue_knowledge_tenant_task("tenant-1", _task(), concurrency=1) == 1
    with pytest.raises(KnowledgeTenantTaskAlreadyEnqueuedError, match="still owned"):
        enqueue_knowledge_tenant_task("tenant-1", _task(), concurrency=1)


def test_completion_failure_resets_active_receipt_and_retry_finishes_ack(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    queue = _Queue(completion_failures=1)
    monkeypatch.setattr(queue_module, "KnowledgeTenantTaskQueue", lambda _tenant_id: queue)

    with pytest.raises(ConnectionError, match="completion unavailable"):
        with knowledge_tenant_task_admission("tenant-1", "receipt-1", concurrency=1) as admitted:
            assert admitted is not None

    with knowledge_tenant_task_admission("tenant-1", "receipt-1", concurrency=1) as admitted:
        assert admitted is not None

    assert queue.started == ["receipt-1", "receipt-1"]
    assert queue.reset == ["receipt-1"]
    assert queue.completed == [("receipt-1", 1)]
