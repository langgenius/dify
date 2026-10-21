from __future__ import annotations

import json
import threading
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict, dataclass
from uuid import uuid4

import pytest
import redis
from testcontainers.redis import RedisContainer

from libs.acknowledged_task_queue import (
    AcknowledgedTaskClaimAlreadyActiveError,
    AcknowledgedTaskEnqueue,
    AcknowledgedTaskExecutionBudgetExhaustedError,
    AcknowledgedTaskQueue,
)


@dataclass(frozen=True, slots=True)
class _Task:
    identity: str
    payload: str


class _Tokens:
    def __init__(self) -> None:
        self._value = 0
        self._lock = threading.Lock()

    def __call__(self) -> str:
        with self._lock:
            self._value += 1
            return f"receipt-{self._value}"


@pytest.fixture(scope="module")
def redis_server() -> Iterator[redis.Redis[bytes]]:
    with RedisContainer(image="redis:6-alpine") as container:
        client = redis.Redis(
            host=container.get_container_host_ip(),
            port=container.get_exposed_port(6379),
            decode_responses=False,
        )
        client.ping()
        yield client
        client.close()


@pytest.fixture
def redis_client(redis_server: redis.Redis[bytes]) -> Iterator[redis.Redis[bytes]]:
    redis_server.flushdb()
    yield redis_server
    redis_server.flushdb()


def _queue(
    redis_client: redis.Redis[bytes],
    *,
    max_execution_attempts: int = 3,
    dead_letter_ttl_seconds: int = 60,
) -> AcknowledgedTaskQueue[_Task]:
    return AcknowledgedTaskQueue(
        uuid4().hex,
        namespace="acknowledged_task_queue_ci",
        serialize=lambda task: json.dumps(asdict(task), separators=(",", ":")),
        deserialize=lambda value: _Task(**json.loads(value)),
        identity=lambda task: task.identity,
        redis=redis_client,
        token_factory=_Tokens(),
        lease_seconds=60,
        heartbeat_seconds=5,
        max_execution_attempts=max_execution_attempts,
        dead_letter_ttl_seconds=dead_letter_ttl_seconds,
    )


def test_concurrent_duplicate_identity_is_accepted_and_claimed_once(redis_client: redis.Redis[bytes]) -> None:
    queue = _queue(redis_client)

    def enqueue(index: int) -> AcknowledgedTaskEnqueue[_Task]:
        return queue.enqueue_with_status(_Task("stable-task", f"payload-{index}"), concurrency=4)

    with ThreadPoolExecutor(max_workers=16) as executor:
        results = list(executor.map(enqueue, range(32)))

    accepted = [result for result in results if result.accepted]
    claims = [claim for result in results for claim in result.claims]
    assert len(accepted) == 1
    assert len(claims) == 1
    assert claims[0].task.identity == "stable-task"
    assert redis_client.hlen(queue._claims_key) == 1
    assert redis_client.llen(queue._pending_key) == 0
    assert redis_client.smembers(queue._identities_key) == {b"stable-task"}


def test_execution_budget_follows_identity_across_release_and_new_receipts(redis_client: redis.Redis[bytes]) -> None:
    queue = _queue(redis_client, max_execution_attempts=2)
    task = _Task("stable-task", "payload")
    first = queue.enqueue(task, concurrency=1)[0]

    queue.start(first.receipt)
    assert queue.release(first.receipt) is True
    second = queue.recover(concurrency=1)[0]
    assert second.receipt != first.receipt

    queue.start(second.receipt)
    assert queue.release(second.receipt) is True
    exhausted = queue.recover(concurrency=1)[0]
    assert exhausted.receipt not in {first.receipt, second.receipt}

    with pytest.raises(AcknowledgedTaskExecutionBudgetExhaustedError):
        queue.start(exhausted.receipt)

    assert redis_client.hget(queue._execution_attempts_key, task.identity) == b"2"
    assert redis_client.sismember(queue._active_key, exhausted.receipt) == 0

    completion = queue.dead_letter(exhausted.receipt, concurrency=1, error="execution budget exhausted")
    assert completion.owned is True
    assert completion.next_claims == ()
    assert redis_client.hget(queue._execution_attempts_key, task.identity) is None
    assert redis_client.sismember(queue._identities_key, task.identity) == 0
    assert redis_client.get(queue._dead_letter_key) == b"stable-task\x002\x00execution budget exhausted"


def test_lock_deferrals_beyond_budget_preserve_payload_until_eventual_success(
    redis_client: redis.Redis[bytes],
) -> None:
    queue = _queue(redis_client, max_execution_attempts=2)
    task = _Task("stable-task", "payload")
    claim = queue.enqueue(task, concurrency=1)[0]

    for _ in range(6):
        queue.start(claim.receipt)
        assert queue.defer(claim.receipt, delay_seconds=30) is True
        assert redis_client.hget(queue._execution_attempts_key, task.identity) is None
        assert redis_client.hget(queue._claims_key, claim.receipt) is not None
        assert redis_client.sismember(queue._identities_key, task.identity) == 1
        assert redis_client.sismember(queue._deferred_key, claim.receipt) == 1
        with pytest.raises(AcknowledgedTaskClaimAlreadyActiveError):
            queue.start(claim.receipt)

        # Advance the durable deadline without waiting for wall-clock time.
        redis_client.zadd(queue._deadlines_key, {claim.receipt: 0})
        claim = queue.recover(concurrency=1)[0]
        assert claim.task == task

    queue.start(claim.receipt)
    completion = queue.complete(claim.receipt, concurrency=1)

    assert completion.owned is True
    assert redis_client.hget(queue._execution_attempts_key, task.identity) is None
    assert redis_client.sismember(queue._identities_key, task.identity) == 0


def test_exhausted_recovery_deferral_retains_payload_budget_and_diagnostic(
    redis_client: redis.Redis[bytes],
) -> None:
    queue = _queue(redis_client, max_execution_attempts=1)
    task = _Task("stable-task", "payload")
    first = queue.enqueue(task, concurrency=1)[0]
    queue.start(first.receipt)
    assert queue.release(first.receipt) is True
    exhausted = queue.recover(concurrency=1)[0]
    with pytest.raises(AcknowledgedTaskExecutionBudgetExhaustedError):
        queue.start(exhausted.receipt)

    assert queue.get_claimed_task(exhausted.receipt) == task
    assert queue.defer_exhausted(
        exhausted.receipt,
        delay_seconds=30,
        error="document repair database unavailable",
    )
    assert redis_client.hget(queue._claims_key, exhausted.receipt) is not None
    assert redis_client.hget(queue._execution_attempts_key, task.identity) == b"1"
    assert redis_client.sismember(queue._identities_key, task.identity) == 1
    assert redis_client.get(queue._dead_letter_key) == (b"stable-task\x001\x00document repair database unavailable")

    redis_client.zadd(queue._deadlines_key, {exhausted.receipt: 0})
    recovered = queue.recover(concurrency=1)[0]
    assert recovered.task == task


def test_exhausted_legacy_payload_deferral_refunds_one_attempt_for_execution(
    redis_client: redis.Redis[bytes],
) -> None:
    queue = _queue(redis_client, max_execution_attempts=1)
    task = _Task("legacy-task", "payload restored")
    first = queue.enqueue(task, concurrency=1)[0]
    queue.start(first.receipt)
    assert queue.release(first.receipt) is True
    exhausted = queue.recover(concurrency=1)[0]
    with pytest.raises(AcknowledgedTaskExecutionBudgetExhaustedError):
        queue.start(exhausted.receipt)

    assert queue.defer_exhausted(
        exhausted.receipt,
        delay_seconds=30,
        error="legacy payload must be read again",
        refund_attempt=True,
    )
    assert redis_client.hget(queue._execution_attempts_key, task.identity) is None
    assert (
        queue.defer_exhausted(
            exhausted.receipt,
            delay_seconds=30,
            error="duplicate delivery must not refund twice",
            refund_attempt=True,
        )
        is False
    )

    redis_client.zadd(queue._deadlines_key, {exhausted.receipt: 0})
    recovered = queue.recover(concurrency=1)[0]
    assert recovered.task == task
    queue.start(recovered.receipt)
    completion = queue.complete(recovered.receipt, concurrency=1)

    assert completion.owned is True
    assert redis_client.hget(queue._execution_attempts_key, task.identity) is None
    assert redis_client.hget(queue._claims_key, recovered.receipt) is None


def test_duplicate_enqueue_recovers_original_payload_and_stale_ack_cannot_clear_identity(
    redis_client: redis.Redis[bytes],
) -> None:
    queue = _queue(redis_client)
    original_task = _Task("stable-task", "original payload")
    original = queue.enqueue(original_task, concurrency=1)[0]
    queue.start(original.receipt)

    # Force the Redis lease to expire without waiting for wall-clock time.
    redis_client.zadd(queue._deadlines_key, {original.receipt: 0})
    recovered = queue.enqueue_with_status(_Task("stable-task", "duplicate payload"), concurrency=1)

    assert recovered.accepted is False
    assert len(recovered.claims) == 1
    replacement = recovered.claims[0]
    assert replacement.receipt != original.receipt
    assert replacement.task == original_task
    assert redis_client.hget(queue._execution_attempts_key, original_task.identity) == b"1"

    stale_completion = queue.complete(original.receipt, concurrency=1)
    assert stale_completion.owned is False
    assert stale_completion.next_claims == ()
    assert redis_client.sismember(queue._identities_key, original_task.identity) == 1
    assert redis_client.hexists(queue._claims_key, replacement.receipt) == 1

    queue.start(replacement.receipt)
    completed = queue.complete(replacement.receipt, concurrency=1)
    assert completed.owned is True
    assert redis_client.sismember(queue._identities_key, original_task.identity) == 0
    assert redis_client.hget(queue._execution_attempts_key, original_task.identity) is None

    reenqueued = queue.enqueue_with_status(_Task("stable-task", "new generation"), concurrency=1)
    assert reenqueued.accepted is True
    assert [claim.task.payload for claim in reenqueued.claims] == ["new generation"]


def test_complete_atomically_clears_owned_identity_and_claims_all_available_replacements(
    redis_client: redis.Redis[bytes],
) -> None:
    queue = _queue(redis_client)
    current = queue.enqueue(_Task("task-1", "first"), concurrency=1)[0]
    queue.start(current.receipt)
    assert queue.enqueue(_Task("task-2", "second"), concurrency=1) == ()
    assert queue.enqueue(_Task("task-3", "third"), concurrency=1) == ()

    completion = queue.complete(current.receipt, concurrency=2)

    assert completion.owned is True
    assert [claim.task.identity for claim in completion.next_claims] == ["task-2", "task-3"]
    assert redis_client.hlen(queue._claims_key) == 2
    assert redis_client.zcard(queue._deadlines_key) == 2
    assert redis_client.llen(queue._pending_key) == 0
    assert redis_client.smembers(queue._identities_key) == {b"task-2", b"task-3"}
    assert redis_client.hget(queue._execution_attempts_key, "task-1") is None


def test_dead_letter_requires_ownership_then_atomically_claims_replacements(redis_client: redis.Redis[bytes]) -> None:
    queue = _queue(redis_client, dead_letter_ttl_seconds=90)
    current = queue.enqueue(_Task("task-1", "first"), concurrency=1)[0]
    queue.start(current.receipt)
    assert queue.enqueue(_Task("task-2", "second"), concurrency=1) == ()
    assert queue.enqueue(_Task("task-3", "third"), concurrency=1) == ()

    stale = queue.dead_letter("not-owned", concurrency=2, error="must not win")
    assert stale.owned is False
    assert stale.next_claims == ()
    assert redis_client.hexists(queue._claims_key, current.receipt) == 1
    assert redis_client.llen(queue._pending_key) == 2
    assert redis_client.get(queue._dead_letter_key) is None

    completion = queue.dead_letter(current.receipt, concurrency=2, error="permanent payload failure")

    assert completion.owned is True
    assert [claim.task.identity for claim in completion.next_claims] == ["task-2", "task-3"]
    assert redis_client.hlen(queue._claims_key) == 2
    assert redis_client.zcard(queue._deadlines_key) == 2
    assert redis_client.llen(queue._pending_key) == 0
    assert redis_client.smembers(queue._identities_key) == {b"task-2", b"task-3"}
    assert redis_client.hget(queue._execution_attempts_key, "task-1") is None
    assert redis_client.get(queue._dead_letter_key) == b"task-1\x001\x00permanent payload failure"
    assert 0 < redis_client.ttl(queue._dead_letter_key) <= 90
