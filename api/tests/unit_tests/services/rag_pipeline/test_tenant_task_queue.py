from __future__ import annotations

import threading
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field

import pytest

from libs import acknowledged_task_queue as acknowledged_queue
from services.rag_pipeline import tenant_task_queue as queue_module
from services.rag_pipeline.entities import RagPipelineDocumentRecovery
from services.rag_pipeline.tenant_task_queue import (
    RAG_PIPELINE_PRIORITY_V2_QUEUE,
    RagPipelineTaskClaimAlreadyActiveError,
    RagPipelineTaskClaimLostError,
    RagPipelineTaskProtocol,
    RagPipelineTaskTarget,
    RagPipelineTenantTask,
    RagPipelineTenantTaskQueue,
    dispatch_rag_pipeline_claims,
)


@dataclass
class _QueueState:
    pending: list[str] = field(default_factory=list)
    claims: dict[str, str] = field(default_factory=dict)
    deadlines: dict[str, int] = field(default_factory=dict)
    active: set[str] = field(default_factory=set)
    identities: set[str] = field(default_factory=set)
    execution_attempts: dict[str, int] = field(default_factory=dict)
    deferred: set[str] = field(default_factory=set)
    latest_dead_letter: tuple[str, int, str, int] | None = None


class _StateRedis:
    """Atomic in-memory implementation of the Lua transitions used by the owner."""

    def __init__(self) -> None:
        self.now = 1_000
        self.tenants: set[str] = set()
        self.registry_cursor = 0
        self.queues: dict[tuple[str, ...], _QueueState] = {}
        self._lock = threading.Lock()

    def register_script(self, script: str) -> Callable[..., object]:
        def execute(*, keys: list[str], args: list[object]) -> object:
            with self._lock:
                if script == acknowledged_queue.REGISTER_SCOPE_LUA:
                    self.tenants.add(str(args[0]))
                    return 1
                if script == acknowledged_queue.SCAN_SCOPES_LUA:
                    tenants = sorted(self.tenants)
                    batch_size = _as_int(args[0])
                    page = tenants[self.registry_cursor : self.registry_cursor + batch_size]
                    self.registry_cursor = (self.registry_cursor + len(page)) % max(1, len(tenants))
                    return [tenant.encode() for tenant in page]

                state = self.queues.setdefault(tuple(keys), _QueueState())
                if script == acknowledged_queue.ENQUEUE_AND_CLAIM_LUA:
                    identity = str(args[3])
                    accepted = int(identity not in state.identities)
                    if identity not in state.identities:
                        state.identities.add(identity)
                        state.execution_attempts.pop(identity, None)
                        state.pending.insert(0, f"{identity}\0{args[0]}")
                    self._recover_expired(state)
                    return [accepted, *self._claim(state, _as_int(args[1]), _as_int(args[2]), args[4:])]
                if script == acknowledged_queue.COMPLETE_AND_CLAIM_LUA:
                    receipt = str(args[0])
                    completed_payload = state.claims.pop(receipt, None)
                    owned = int(completed_payload is not None)
                    if completed_payload is not None:
                        identity = completed_payload.partition("\0")[0]
                        state.identities.discard(identity)
                        state.execution_attempts.pop(identity, None)
                    state.deadlines.pop(receipt, None)
                    state.active.discard(receipt)
                    state.deferred.discard(receipt)
                    self._recover_expired(state)
                    return [owned, *self._claim(state, _as_int(args[1]), _as_int(args[2]), args[3:])]
                if script == acknowledged_queue.RECOVER_AND_CLAIM_LUA:
                    self._recover_expired(state)
                    return self._claim(state, _as_int(args[0]), _as_int(args[1]), args[2:])
                if script == acknowledged_queue.RELEASE_CLAIM_LUA:
                    receipt = str(args[0])
                    payload = state.claims.pop(receipt, None)
                    state.deadlines.pop(receipt, None)
                    state.active.discard(receipt)
                    state.deferred.discard(receipt)
                    if payload is None:
                        return 0
                    state.pending.insert(0, payload)
                    return 1
                if script == acknowledged_queue.START_CLAIM_LUA:
                    receipt = str(args[0])
                    if receipt not in state.claims:
                        return 0
                    if receipt in state.deferred:
                        return 2
                    if receipt in state.active:
                        return 2
                    state.active.add(receipt)
                    identity = state.claims[receipt].partition("\0")[0]
                    attempts = state.execution_attempts.get(identity, 0)
                    if attempts >= _as_int(args[2]):
                        state.active.discard(receipt)
                        return 3
                    state.execution_attempts[identity] = attempts + 1
                    state.deadlines[receipt] = self.now + _as_int(args[1])
                    return 1
                if script == acknowledged_queue.DEAD_LETTER_AND_CLAIM_LUA:
                    receipt = str(args[0])
                    payload = state.claims.pop(receipt, None)
                    if payload is None:
                        return [0]
                    state.deadlines.pop(receipt, None)
                    state.active.discard(receipt)
                    state.deferred.discard(receipt)
                    identity = payload.partition("\0")[0]
                    state.identities.discard(identity)
                    attempts = state.execution_attempts.pop(identity, 0)
                    state.latest_dead_letter = (identity, attempts, str(args[4]), _as_int(args[3]))
                    self._recover_expired(state)
                    return [1, *self._claim(state, _as_int(args[1]), _as_int(args[2]), args[5:])]
                if script == acknowledged_queue.RENEW_CLAIM_LUA:
                    receipt = str(args[0])
                    if receipt not in state.claims or receipt not in state.active:
                        return 0
                    state.deadlines[receipt] = self.now + _as_int(args[1])
                    return 1
                if script == acknowledged_queue.RESET_ACTIVE_CLAIM_LUA:
                    receipt = str(args[0])
                    if receipt not in state.claims:
                        return 0
                    state.active.discard(receipt)
                    state.deadlines[receipt] = self.now + _as_int(args[1])
                    return 1
                if script == acknowledged_queue.DEFER_ACTIVE_CLAIM_LUA:
                    receipt = str(args[0])
                    payload = state.claims.get(receipt)
                    if payload is None or receipt not in state.active:
                        return 0
                    identity = payload.partition("\0")[0]
                    attempts = state.execution_attempts.get(identity, 0)
                    if attempts <= 1:
                        state.execution_attempts.pop(identity, None)
                    else:
                        state.execution_attempts[identity] = attempts - 1
                    state.active.discard(receipt)
                    state.deferred.add(receipt)
                    state.deadlines[receipt] = self.now + _as_int(args[1])
                    return 1
                if script == acknowledged_queue.READ_CLAIM_LUA:
                    return state.claims.get(str(args[0]))
                if script == acknowledged_queue.DEFER_EXHAUSTED_CLAIM_LUA:
                    receipt = str(args[0])
                    payload = state.claims.get(receipt)
                    if payload is None or receipt in state.active or receipt in state.deferred:
                        return 0
                    identity = payload.partition("\0")[0]
                    attempts = state.execution_attempts.get(identity, 0)
                    if _as_int(args[4]) == 1:
                        if attempts <= 1:
                            state.execution_attempts.pop(identity, None)
                            attempts = 0
                        else:
                            attempts -= 1
                            state.execution_attempts[identity] = attempts
                    state.deferred.add(receipt)
                    state.deadlines[receipt] = self.now + _as_int(args[1])
                    state.latest_dead_letter = (
                        identity,
                        attempts,
                        str(args[2]),
                        _as_int(args[3]),
                    )
                    return 1
                raise AssertionError("unexpected script")

        return execute

    def state_for(self, queue: RagPipelineTenantTaskQueue) -> _QueueState:
        return self.queues[
            (
                queue._pending_key,
                queue._claims_key,
                queue._deadlines_key,
                queue._active_key,
                queue._identities_key,
                queue._execution_attempts_key,
                queue._dead_letter_key,
                queue._deferred_key,
            )
        ]

    def _recover_expired(self, state: _QueueState) -> None:
        for receipt, deadline in list(state.deadlines.items()):
            if deadline > self.now:
                continue
            payload = state.claims.pop(receipt, None)
            state.deadlines.pop(receipt, None)
            state.active.discard(receipt)
            state.deferred.discard(receipt)
            if payload is not None:
                state.pending.insert(0, payload)

    def _claim(
        self,
        state: _QueueState,
        concurrency: int,
        lease_seconds: int,
        receipts: list[object],
    ) -> list[str]:
        result: list[str] = []
        for receipt_value in receipts[: max(0, concurrency - len(state.claims))]:
            if not state.pending:
                break
            receipt = str(receipt_value)
            payload = state.pending.pop()
            state.claims[receipt] = payload
            state.deadlines[receipt] = self.now + lease_seconds
            result.extend((receipt, payload))
        return result


class _Tokens:
    def __init__(self) -> None:
        self.value = 0
        self._lock = threading.Lock()

    def __call__(self) -> str:
        with self._lock:
            self.value += 1
            return f"receipt-{self.value}"


def _as_int(value: object) -> int:
    assert isinstance(value, int)
    return value


@dataclass(frozen=True)
class _Published:
    task_name: str
    queue_name: str
    file_id: str
    tenant_id: str
    receipt: str


class _Publisher:
    def __init__(self, factory: _SignatureFactory, task_name: str, queue_name: str) -> None:
        self._factory = factory
        self._task_name = task_name
        self._queue_name = queue_name

    def delay(self, **kwargs: str) -> None:
        if self._factory.fail:
            raise ConnectionError("broker unavailable")
        self._factory.published.append(
            _Published(
                task_name=self._task_name,
                queue_name=self._queue_name,
                file_id=kwargs["rag_pipeline_invoke_entities_file_id"],
                tenant_id=kwargs["tenant_id"],
                receipt=kwargs["tenant_queue_receipt"],
            )
        )


class _SignatureFactory:
    def __init__(self, *, fail: bool = False) -> None:
        self.fail = fail
        self.published: list[_Published] = []

    def __call__(self, task_name: str, *, queue: str) -> _Publisher:
        return _Publisher(self, task_name, queue)


def _queue(
    redis: _StateRedis,
    tokens: _Tokens | None = None,
    *,
    max_execution_attempts: int = 5,
) -> RagPipelineTenantTaskQueue:
    return RagPipelineTenantTaskQueue(
        "tenant-1",
        redis=redis,
        token_factory=tokens or _Tokens(),
        lease_seconds=10,
        heartbeat_seconds=2,
        max_execution_attempts=max_execution_attempts,
    )


def _task(file_id: str) -> RagPipelineTenantTask:
    return RagPipelineTenantTask(file_id=file_id, target=RagPipelineTaskTarget.REGULAR)


def test_concurrent_enqueue_atomically_respects_tenant_capacity() -> None:
    redis = _StateRedis()
    queue = _queue(redis)

    with ThreadPoolExecutor(max_workers=20) as executor:
        results = list(executor.map(lambda value: queue.enqueue(_task(f"file-{value}"), concurrency=3), range(20)))

    state = redis.state_for(queue)
    assert sum(len(claims) for claims in results) == 3
    assert len(state.claims) == 3
    assert len(state.pending) == 17
    assert redis.tenants == {"tenant-1"}


def test_concurrent_repeated_enqueue_does_not_duplicate_pending_or_claimed_file() -> None:
    redis = _StateRedis()
    queue = _queue(redis)

    with ThreadPoolExecutor(max_workers=20) as executor:
        results = list(executor.map(lambda _value: queue.enqueue(_task("file-1"), concurrency=1), range(20)))

    state = redis.state_for(queue)
    assert sum(len(claims) for claims in results) == 1
    assert len(state.claims) == 1
    assert state.pending == []
    assert state.identities == {"file-1"}


def test_enqueue_status_distinguishes_duplicate_identity_from_capacity_backlog() -> None:
    redis = _StateRedis()
    queue = _queue(redis)

    first = queue.enqueue_with_status(_task("file-1"), concurrency=1)
    duplicate = queue.enqueue_with_status(_task("file-1"), concurrency=1)
    waiting = queue.enqueue_with_status(_task("file-2"), concurrency=1)

    assert first.accepted is True
    assert len(first.claims) == 1
    assert duplicate.accepted is False
    assert duplicate.claims == ()
    assert waiting.accepted is True
    assert waiting.claims == ()


def test_duplicate_enqueue_recovers_expired_uncertain_broker_handoff() -> None:
    redis = _StateRedis()
    queue = _queue(redis)
    original = queue.enqueue(_task("file-1"), concurrency=1)[0]

    redis.now += 11
    duplicate = queue.enqueue_with_status(_task("file-1"), concurrency=1)

    assert duplicate.accepted is False
    assert [claim.task.file_id for claim in duplicate.claims] == ["file-1"]
    assert duplicate.claims[0].receipt != original.receipt


def test_empty_handoff_is_safe_when_completion_wins_the_race() -> None:
    redis = _StateRedis()
    queue = _queue(redis)
    current = queue.enqueue(_task("file-1"), concurrency=1)[0]

    completion = queue.complete(current.receipt, concurrency=1)
    next_claims = queue.enqueue(_task("file-2"), concurrency=1)

    assert completion.owned is True
    assert completion.next_claims == ()
    assert [claim.task.file_id for claim in next_claims] == ["file-2"]


def test_empty_handoff_is_safe_when_enqueue_wins_the_race() -> None:
    redis = _StateRedis()
    queue = _queue(redis)
    current = queue.enqueue(_task("file-1"), concurrency=1)[0]

    waiting_claims = queue.enqueue(_task("file-2"), concurrency=1)
    completion = queue.complete(current.receipt, concurrency=1)

    assert waiting_claims == ()
    assert completion.owned is True
    assert [claim.task.file_id for claim in completion.next_claims] == ["file-2"]


def test_broker_failure_keeps_attempted_claim_leased_until_periodic_recovery(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    redis = _StateRedis()
    queue = _queue(redis)
    claim = queue.enqueue(_task("file-1"), concurrency=1)
    publisher = _SignatureFactory(fail=True)
    monkeypatch.setattr(queue_module, "signature", publisher)

    assert dispatch_rag_pipeline_claims(tenant_id="tenant-1", queue=queue, claims=claim) == 0
    state = redis.state_for(queue)
    assert list(state.claims) == [claim[0].receipt]
    assert state.pending == []

    publisher.fail = False
    assert queue.recover(concurrency=1) == ()
    redis.now += 11
    recovered = queue.recover(concurrency=1)
    assert dispatch_rag_pipeline_claims(tenant_id="tenant-1", queue=queue, claims=recovered) == 1
    assert publisher.published[0].file_id == "file-1"


def test_broker_failure_releases_only_claims_that_were_not_attempted(monkeypatch: pytest.MonkeyPatch) -> None:
    redis = _StateRedis()
    queue = _queue(redis)
    claims = tuple(
        claim for file_id in ("file-1", "file-2", "file-3") for claim in queue.enqueue(_task(file_id), concurrency=3)
    )
    publisher = _SignatureFactory(fail=True)
    monkeypatch.setattr(queue_module, "signature", publisher)

    assert dispatch_rag_pipeline_claims(tenant_id="tenant-1", queue=queue, claims=claims) == 0

    state = redis.state_for(queue)
    assert set(state.claims) == {claims[0].receipt}
    assert len(state.pending) == 2


def test_expired_publisher_claim_is_recovered_with_a_new_receipt() -> None:
    redis = _StateRedis()
    queue = _queue(redis)
    original = queue.enqueue(_task("file-1"), concurrency=1)[0]

    redis.now += 11
    recovered = queue.recover(concurrency=1)

    assert [claim.task.file_id for claim in recovered] == ["file-1"]
    assert recovered[0].receipt != original.receipt
    assert queue.complete(original.receipt, concurrency=1).owned is False


def test_maintain_renews_claim_before_worker_runs() -> None:
    redis = _StateRedis()
    queue = _queue(redis)
    claim = queue.enqueue(_task("file-1"), concurrency=1)[0]
    redis.now += 5

    with queue.maintain(claim.receipt):
        deadline = redis.state_for(queue).deadlines[claim.receipt]

    assert deadline == redis.now + 10


def test_worker_claim_can_only_be_started_once() -> None:
    redis = _StateRedis()
    queue = _queue(redis)
    claim = queue.enqueue(_task("file-1"), concurrency=1)[0]

    with queue.maintain(claim.receipt):
        with pytest.raises(RagPipelineTaskClaimAlreadyActiveError):
            with queue.maintain(claim.receipt):
                raise AssertionError("duplicate claim must not execute")


def test_worker_cannot_start_an_expired_receipt() -> None:
    redis = _StateRedis()
    queue = _queue(redis)
    claim = queue.enqueue(_task("file-1"), concurrency=1)[0]
    redis.now += 11
    queue.recover(concurrency=1)

    with pytest.raises(RagPipelineTaskClaimLostError):
        with queue.maintain(claim.receipt):
            raise AssertionError("expired claim must not execute")


def test_dispatch_preserves_target_queue(monkeypatch: pytest.MonkeyPatch) -> None:
    redis = _StateRedis()
    queue = _queue(redis)
    claim = queue.enqueue(
        RagPipelineTenantTask(file_id="file-priority", target=RagPipelineTaskTarget.PRIORITY), concurrency=1
    )
    publisher = _SignatureFactory()
    monkeypatch.setattr(queue_module, "signature", publisher)

    assert dispatch_rag_pipeline_claims(tenant_id="tenant-1", queue=queue, claims=claim) == 1
    assert publisher.published == [
        _Published(
            task_name=RagPipelineTaskTarget.PRIORITY.task_name,
            queue_name="priority_pipeline",
            file_id="file-priority",
            tenant_id="tenant-1",
            receipt=claim[0].receipt,
        )
    ]


def test_legacy_queue_payload_without_protocol_remains_dispatchable() -> None:
    task = RagPipelineTenantTask.deserialize('{"file_id":"file-old","target":"regular"}')

    assert task.protocol is RagPipelineTaskProtocol.LEGACY_LIST
    assert task.task_name == "tasks.rag_pipeline.rag_pipeline_run_task.rag_pipeline_run_task"
    assert task.queue_name == "pipeline"


def test_queue_payload_round_trips_exact_document_recovery_metadata() -> None:
    task = RagPipelineTenantTask(
        file_id="file-current",
        target=RagPipelineTaskTarget.REGULAR,
        protocol=RagPipelineTaskProtocol.SNAPSHOT_BATCH_V2,
        document_recoveries=(
            RagPipelineDocumentRecovery(
                dataset_id="dataset-1",
                document_id="document-1",
                indexing_generation="generation-2",
                actor_id="account-1",
            ),
        ),
    )

    assert RagPipelineTenantTask.deserialize(task.serialize()) == task


def test_snapshot_batch_dispatches_only_to_versioned_task_and_broker_queue(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    redis = _StateRedis()
    queue = _queue(redis)
    claim = queue.enqueue(
        RagPipelineTenantTask(
            file_id="file-snapshot",
            target=RagPipelineTaskTarget.PRIORITY,
            protocol=RagPipelineTaskProtocol.SNAPSHOT_BATCH_V2,
        ),
        concurrency=1,
    )
    publisher = _SignatureFactory()
    monkeypatch.setattr(queue_module, "signature", publisher)

    assert dispatch_rag_pipeline_claims(tenant_id="tenant-1", queue=queue, claims=claim) == 1
    assert publisher.published == [
        _Published(
            task_name="tasks.rag_pipeline.priority_rag_pipeline_run_task.priority_rag_pipeline_run_task_v2",
            queue_name=RAG_PIPELINE_PRIORITY_V2_QUEUE,
            file_id="file-snapshot",
            tenant_id="tenant-1",
            receipt=claim[0].receipt,
        )
    ]


def test_registered_tenants_decode_redis_bytes() -> None:
    redis = _StateRedis()
    queue = _queue(redis)
    queue.enqueue(_task("file-1"), concurrency=1)

    assert RagPipelineTenantTaskQueue.registered_tenants(redis=redis) == ("tenant-1",)


def test_release_of_unknown_receipt_does_not_duplicate_pending_task() -> None:
    redis = _StateRedis()
    queue = _queue(redis)
    queue.enqueue(_task("file-1"), concurrency=1)

    assert queue.release("unknown") is False
    assert len(redis.state_for(queue).claims) == 1


def test_execution_budget_follows_stable_identity_across_release_and_new_receipt() -> None:
    redis = _StateRedis()
    queue = _queue(redis, max_execution_attempts=2)
    first = queue.enqueue(_task("file-1"), concurrency=1)[0]

    with queue.maintain(first.receipt):
        pass
    assert queue.release(first.receipt) is True
    second = queue.recover(concurrency=1)[0]
    with queue.maintain(second.receipt):
        pass
    assert queue.release(second.receipt) is True
    third = queue.recover(concurrency=1)[0]

    with pytest.raises(acknowledged_queue.AcknowledgedTaskExecutionBudgetExhaustedError):
        with queue.maintain(third.receipt):
            raise AssertionError("budget-exhausted task must not execute")

    assert redis.state_for(queue).execution_attempts == {"file-1": 2}


def test_repeated_deferral_preserves_payload_and_execution_budget_until_lock_is_available() -> None:
    redis = _StateRedis()
    queue = _queue(redis, max_execution_attempts=2)
    claim = queue.enqueue(_task("file-1"), concurrency=1)[0]

    for _ in range(6):
        with queue.maintain(claim.receipt):
            assert queue.defer(claim.receipt, delay_seconds=5) is True
        state = redis.state_for(queue)
        assert state.execution_attempts == {}
        assert state.identities == {"file-1"}
        assert state.deferred == {claim.receipt}
        assert '"file_id":"file-1"' in state.claims[claim.receipt]

        with pytest.raises(RagPipelineTaskClaimAlreadyActiveError):
            queue.start(claim.receipt)

        redis.now += 4
        assert queue.recover(concurrency=1) == ()
        redis.now += 1
        claim = queue.recover(concurrency=1)[0]

    with queue.maintain(claim.receipt):
        pass
    completion = queue.complete(claim.receipt, concurrency=1)

    assert completion.owned is True
    state = redis.state_for(queue)
    assert state.identities == set()
    assert state.execution_attempts == {}
    assert state.claims == {}
    assert state.deferred == set()


def test_deferral_requires_the_active_receipt_owner() -> None:
    redis = _StateRedis()
    queue = _queue(redis)
    claim = queue.enqueue(_task("file-1"), concurrency=1)[0]

    assert queue.defer(claim.receipt, delay_seconds=5) is False
    with queue.maintain(claim.receipt):
        assert queue.defer("stale-receipt", delay_seconds=5) is False

    state = redis.state_for(queue)
    assert state.execution_attempts == {"file-1": 1}
    assert claim.receipt in state.claims


def test_exhausted_recovery_deferral_retains_claim_budget_and_diagnostic() -> None:
    redis = _StateRedis()
    queue = _queue(redis, max_execution_attempts=1)
    first = queue.enqueue(_task("file-1"), concurrency=1)[0]

    with queue.maintain(first.receipt):
        pass
    assert queue.release(first.receipt) is True
    exhausted = queue.recover(concurrency=1)[0]
    with pytest.raises(acknowledged_queue.AcknowledgedTaskExecutionBudgetExhaustedError):
        queue.start(exhausted.receipt)

    assert queue.get_claimed_task(exhausted.receipt) == _task("file-1")
    assert queue.defer_exhausted(exhausted.receipt, delay_seconds=5, error="repair database unavailable") is True
    state = redis.state_for(queue)
    assert state.identities == {"file-1"}
    assert state.execution_attempts == {"file-1": 1}
    assert exhausted.receipt in state.claims
    assert state.latest_dead_letter == ("file-1", 1, "repair database unavailable", 24 * 60 * 60)

    redis.now += 5
    recovered = queue.recover(concurrency=1)
    assert [claim.task.file_id for claim in recovered] == ["file-1"]


def test_exhausted_legacy_payload_deferral_refunds_one_attempt_for_real_execution() -> None:
    redis = _StateRedis()
    queue = _queue(redis, max_execution_attempts=1)
    first = queue.enqueue(_task("file-1"), concurrency=1)[0]

    with queue.maintain(first.receipt):
        pass
    assert queue.release(first.receipt) is True
    exhausted = queue.recover(concurrency=1)[0]
    with pytest.raises(acknowledged_queue.AcknowledgedTaskExecutionBudgetExhaustedError):
        queue.start(exhausted.receipt)

    assert queue.defer_exhausted(
        exhausted.receipt,
        delay_seconds=5,
        error="legacy payload must be read again",
        refund_attempt=True,
    )
    state = redis.state_for(queue)
    assert state.execution_attempts == {}
    assert state.latest_dead_letter == ("file-1", 0, "legacy payload must be read again", 24 * 60 * 60)
    assert (
        queue.defer_exhausted(
            exhausted.receipt,
            delay_seconds=5,
            error="duplicate delivery must not refund twice",
            refund_attempt=True,
        )
        is False
    )

    redis.now += 5
    recovered = queue.recover(concurrency=1)[0]
    with queue.maintain(recovered.receipt):
        pass
    completion = queue.complete(recovered.receipt, concurrency=1)

    assert completion.owned is True
    assert redis.state_for(queue).claims == {}


def test_dead_letter_clears_identity_budget_and_claims_replacement_work() -> None:
    redis = _StateRedis()
    queue = _queue(redis, max_execution_attempts=1)
    first = queue.enqueue(_task("file-1"), concurrency=1)[0]
    assert queue.enqueue(_task("file-2"), concurrency=1) == ()

    with queue.maintain(first.receipt):
        pass
    completion = queue.dead_letter(first.receipt, concurrency=1, error="permanent pipeline payload")

    state = redis.state_for(queue)
    assert completion.owned is True
    assert [claim.task.file_id for claim in completion.next_claims] == ["file-2"]
    assert state.latest_dead_letter == ("file-1", 1, "permanent pipeline payload", 24 * 60 * 60)
    assert "file-1" not in state.identities
    assert "file-1" not in state.execution_attempts
