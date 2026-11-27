"""Exercise the distributed admission protocol against actual Redis Lua scripts."""

from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta

import pytest
from redis.exceptions import ConnectionError

from extensions.ext_redis import RedisClientWrapper
from tasks.plugin_autoupgrade_coordination import (
    _SLOTS_KEY,
    CHECK_QUEUE_DEADLINE_SECONDS,
    CHECK_SLOT_LEASE_SECONDS,
    CHECK_TASK_TIME_LIMIT,
    MAX_CONCURRENT_CHECK_TASKS,
    AcquireResult,
    CheckReservation,
    RedisPluginAutoUpgradeCoordinator,
    _execution_key,
    _reservation_key,
)
from tests.helpers.unit.config_override import config_overrides_context


def _reserve(
    coordinator: RedisPluginAutoUpgradeCoordinator,
    redis: RedisClientWrapper,
    tenant: str,
    category: str | None = "tool",
    producer_id: str | None = None,
) -> CheckReservation:
    """Create one due reservation using Redis's clock, asserting it is newly accepted."""
    seconds, microseconds = redis.time()
    now = seconds + microseconds / 1_000_000
    timestamp = datetime.fromtimestamp(now, UTC)
    time_of_day = timestamp.hour * 3600 + timestamp.minute * 60 + timestamp.second
    reservation = coordinator.reserve(tenant, category, time_of_day, now, producer_id=producer_id)
    assert reservation is not None
    return reservation


class _RedisWithOneLostReply:
    """Execute actual Redis commands, losing exactly one successful script response."""

    def __init__(self, redis: RedisClientWrapper) -> None:
        """Bind a real client and arm a one-shot response-loss fault."""
        self._redis = redis
        self._lose_reply = True

    def register_script(self, script: str) -> Callable[..., object]:
        """Return a real script whose first successful response may be lost to this caller."""
        execute = self._redis.register_script(script)

        def with_lost_reply(**arguments: object) -> object:
            """Commit the Redis write before raising the simulated connection failure."""
            result = execute(**arguments)
            if self._lose_reply:
                self._lose_reply = False
                raise ConnectionError("The server committed the write but its reply was lost")
            return result

        return with_lost_reply


def test_same_producer_recovers_a_pending_reservation_after_losing_redis_reply(
    application_redis: RedisClientWrapper,
) -> None:
    """A producer retry resumes publication after reserve committed but its caller received no result."""
    seconds, _ = application_redis.time()
    timestamp = datetime.fromtimestamp(seconds, UTC)
    time_of_day = timestamp.hour * 3600 + timestamp.minute * 60 + timestamp.second
    failed_producer = RedisPluginAutoUpgradeCoordinator(_RedisWithOneLostReply(application_redis))
    with pytest.raises(ConnectionError, match="reply was lost"):
        failed_producer.reserve("tenant", "tool", time_of_day, seconds, producer_id="same-parent-task")

    retrying_producer = RedisPluginAutoUpgradeCoordinator(application_redis)
    recovered = retrying_producer.reserve("tenant", "tool", time_of_day, seconds, producer_id="same-parent-task")

    assert recovered is not None
    assert retrying_producer.reserve("tenant", "tool", time_of_day, seconds, producer_id="other-parent-task") is None
    assert retrying_producer.acquire(recovered, "execution") == AcquireResult.ACQUIRED


def test_producer_redelivery_keeps_the_original_window_anchor(application_redis: RedisClientWrapper) -> None:
    """A producer returning after another schedule window still scans its original window."""
    coordinator = RedisPluginAutoUpgradeCoordinator(application_redis)
    seconds, _ = application_redis.time()
    anchor = coordinator.schedule_anchor("parent-task", seconds)

    assert coordinator.schedule_anchor("parent-task", seconds + 16 * 60) == anchor
    assert coordinator.schedule_anchor("other-parent-task", seconds + 16 * 60) == seconds + 16 * 60


def test_legacy_reservation_recovers_a_lost_reply_with_its_task_identity(
    application_redis: RedisClientWrapper,
) -> None:
    """An old message retry recovers its committed reservation instead of silently dropping its check."""
    seconds, _ = application_redis.time()
    timestamp = datetime.fromtimestamp(seconds, UTC)
    time_of_day = timestamp.hour * 3600 + timestamp.minute * 60 + timestamp.second
    failed_worker = RedisPluginAutoUpgradeCoordinator(_RedisWithOneLostReply(application_redis))
    with pytest.raises(ConnectionError, match="reply was lost"):
        failed_worker.reserve_legacy("tenant", "tool", time_of_day, seconds, producer_id="legacy:task-id")

    retrying_worker = RedisPluginAutoUpgradeCoordinator(application_redis)
    recovered = retrying_worker.reserve_legacy(
        "tenant", "tool", time_of_day, seconds + 30, producer_id="legacy:task-id"
    )

    assert recovered is not None
    assert retrying_worker.acquire(recovered, "execution") == AcquireResult.ACQUIRED


def test_successful_publication_is_not_repeated_after_queued_reply_is_lost(
    application_redis: RedisClientWrapper,
) -> None:
    """Once publication is marked queued, the same parent retry skips it despite an ambiguous Redis response."""
    coordinator = RedisPluginAutoUpgradeCoordinator(application_redis)
    reservation = _reserve(coordinator, application_redis, "tenant", producer_id="parent-task")
    failed_marker = RedisPluginAutoUpgradeCoordinator(_RedisWithOneLostReply(application_redis))

    with pytest.raises(ConnectionError, match="reply was lost"):
        failed_marker.mark_queued(reservation)

    scheduled_at = reservation.deadline - 24 * 3600
    timestamp = datetime.fromtimestamp(scheduled_at, UTC)
    time_of_day = timestamp.hour * 3600 + timestamp.minute * 60 + timestamp.second
    assert coordinator.reserve("tenant", "tool", time_of_day, scheduled_at, producer_id="parent-task") is None
    assert coordinator.acquire(reservation, "execution") == AcquireResult.ACQUIRED


def test_same_producer_does_not_republish_running_or_completed_work(application_redis: RedisClientWrapper) -> None:
    """Pending recovery never permits an existing execution or completed check to be published again."""
    coordinator = RedisPluginAutoUpgradeCoordinator(application_redis)
    reservation = _reserve(coordinator, application_redis, "tenant", producer_id="parent-task")
    scheduled_at = reservation.deadline - 24 * 3600
    timestamp = datetime.fromtimestamp(scheduled_at, UTC)
    time_of_day = timestamp.hour * 3600 + timestamp.minute * 60 + timestamp.second

    assert coordinator.acquire(reservation, "execution") == AcquireResult.ACQUIRED
    assert coordinator.reserve("tenant", "tool", time_of_day, scheduled_at, producer_id="parent-task") is None
    coordinator.mark_queued(reservation)
    coordinator.finish(reservation, "execution")
    assert coordinator.reserve("tenant", "tool", time_of_day, scheduled_at, producer_id="parent-task") is None
    assert coordinator.acquire(reservation, "redelivery") == AcquireResult.DUPLICATE


def test_completion_discards_ownership_fields_and_restores_the_queue_deadline(
    application_redis: RedisClientWrapper,
) -> None:
    """A check finishing near its deadline keeps only the state and drops the extended lease TTL."""
    coordinator = RedisPluginAutoUpgradeCoordinator(application_redis)
    seconds, _ = application_redis.time()
    deadline = seconds + 60
    reservation = coordinator.reserve("tenant", "tool", 0, deadline - CHECK_QUEUE_DEADLINE_SECONDS)
    assert reservation is not None
    key = _reservation_key(reservation)
    assert coordinator.acquire(reservation, "execution") == AcquireResult.ACQUIRED
    assert application_redis.pttl(key) > 60_000

    coordinator.finish(reservation, "execution")

    assert application_redis.hgetall(key) == {b"state": b"done"}
    before_seconds, before_microseconds = application_redis.time()
    ttl_ms = application_redis.pttl(key)
    after_seconds, after_microseconds = application_redis.time()
    before_ms = before_seconds * 1000 + before_microseconds // 1000
    after_ms = after_seconds * 1000 + after_microseconds // 1000
    assert ttl_ms > 0
    assert before_ms + ttl_ms <= deadline * 1000 <= after_ms + ttl_ms
    assert coordinator.acquire(reservation, "redelivery") == AcquireResult.DUPLICATE


def test_pending_running_and_completed_work_share_one_deduplication_marker(
    application_redis: RedisClientWrapper,
) -> None:
    """A second producer cannot schedule the same logical check before or after its completion."""
    coordinator = RedisPluginAutoUpgradeCoordinator(application_redis)
    reservation = _reserve(coordinator, application_redis, "tenant")
    seconds, _ = application_redis.time()
    timestamp = datetime.fromtimestamp(seconds, UTC)
    time_of_day = timestamp.hour * 3600 + timestamp.minute * 60 + timestamp.second

    assert coordinator.reserve("tenant", "tool", time_of_day, seconds) is None
    assert coordinator.acquire(reservation, "execution") == AcquireResult.ACQUIRED
    assert coordinator.reserve("tenant", "tool", time_of_day, seconds) is None
    assert coordinator.acquire(reservation, "execution") == AcquireResult.BUSY
    coordinator.finish(reservation, "execution")
    assert coordinator.reserve("tenant", "tool", time_of_day, seconds) is None
    assert coordinator.acquire(reservation, "redelivery") == AcquireResult.DUPLICATE


def test_distinct_categories_and_tenants_can_run_independently(application_redis: RedisClientWrapper) -> None:
    """The deduplication identity preserves independent tenant/category strategy checks."""
    coordinator = RedisPluginAutoUpgradeCoordinator(application_redis)
    reservations = [
        _reserve(coordinator, application_redis, "tenant", "tool"),
        _reserve(coordinator, application_redis, "tenant", "model"),
        _reserve(coordinator, application_redis, "other-tenant", "tool"),
    ]

    assert [coordinator.acquire(reservation, f"execution-{i}") for i, reservation in enumerate(reservations)] == [
        AcquireResult.ACQUIRED,
        AcquireResult.ACQUIRED,
        AcquireResult.ACQUIRED,
    ]


def test_workers_racing_for_the_last_global_slot_cannot_overadmit(application_redis: RedisClientWrapper) -> None:
    """Independent coordinators sharing Redis admit exactly one contender for the final slot."""
    coordinator = RedisPluginAutoUpgradeCoordinator(application_redis)
    occupied = [
        _reserve(coordinator, application_redis, f"occupied-{i}") for i in range(MAX_CONCURRENT_CHECK_TASKS - 1)
    ]
    for i, reservation in enumerate(occupied):
        assert coordinator.acquire(reservation, f"occupied-execution-{i}") == AcquireResult.ACQUIRED
    contenders = [_reserve(coordinator, application_redis, f"contender-{i}") for i in range(12)]

    def claim(item: tuple[int, CheckReservation]) -> AcquireResult:
        """Claim through a distinct worker adapter; Redis must arbitrate the race atomically."""
        i, reservation = item
        worker = RedisPluginAutoUpgradeCoordinator(application_redis)
        return worker.acquire(reservation, f"contender-execution-{i}")

    with ThreadPoolExecutor(max_workers=len(contenders)) as workers:
        results = list(workers.map(claim, enumerate(contenders)))

    assert results.count(AcquireResult.ACQUIRED) == 1
    assert results.count(AcquireResult.BUSY) == len(contenders) - 1
    coordinator.finish(occupied[0], "occupied-execution-0")
    waiting = next(
        reservation for reservation, result in zip(contenders, results, strict=True) if result == AcquireResult.BUSY
    )
    assert coordinator.acquire(waiting, "later-execution") == AcquireResult.ACQUIRED


def test_concurrent_deliveries_of_one_reservation_start_only_once(application_redis: RedisClientWrapper) -> None:
    """Even deliveries with an identical execution token cannot enter the same running check twice."""
    coordinator = RedisPluginAutoUpgradeCoordinator(application_redis)
    reservation = _reserve(coordinator, application_redis, "tenant")

    def claim(_index: int) -> AcquireResult:
        """Return the atomic result from an independent adapter for this delivery."""
        return RedisPluginAutoUpgradeCoordinator(application_redis).acquire(reservation, "same-execution-token")

    with ThreadPoolExecutor(max_workers=8) as workers:
        results = list(workers.map(claim, range(8)))

    assert results.count(AcquireResult.ACQUIRED) == 1
    assert results.count(AcquireResult.BUSY) == 7


def test_expired_lease_recovers_without_allowing_old_owner_to_finish_new_work(
    application_redis: RedisClientWrapper,
) -> None:
    """After the hard-limit-safe lease expires, a replacement owns the slot and stale cleanup is inert."""
    coordinator = RedisPluginAutoUpgradeCoordinator(application_redis)
    reservation = _reserve(coordinator, application_redis, "tenant")
    assert coordinator.acquire(reservation, "old-execution") == AcquireResult.ACQUIRED
    assert CHECK_SLOT_LEASE_SECONDS > CHECK_TASK_TIME_LIMIT

    # Simulate time having passed beyond a crashed execution's lease without a
    # 31-minute sleep. These are physical script keys after namespace handling.
    expire_lease = application_redis.register_script(
        "redis.call('ZADD', KEYS[1], 0, KEYS[2]); redis.call('DEL', KEYS[3]); return 1"
    )
    expire_lease(keys=[_SLOTS_KEY, _reservation_key(reservation), _execution_key(reservation)])
    assert coordinator.acquire(reservation, "new-execution") == AcquireResult.ACQUIRED

    coordinator.finish(reservation, "old-execution")
    coordinator.cancel(reservation)
    assert coordinator.acquire(reservation, "third-execution") == AcquireResult.BUSY
    coordinator.finish(reservation, "new-execution")
    assert coordinator.acquire(reservation, "redelivery") == AcquireResult.DUPLICATE


def test_same_strategy_cannot_run_on_two_scheduled_days_at_once(application_redis: RedisClientWrapper) -> None:
    """A previous day's still-running check blocks the next day's check until its owner finishes."""
    coordinator = RedisPluginAutoUpgradeCoordinator(application_redis)
    previous = _reserve(coordinator, application_redis, "tenant")
    scheduled_at = previous.deadline - 24 * 3600
    timestamp = datetime.fromtimestamp(scheduled_at, UTC)
    time_of_day = timestamp.hour * 3600 + timestamp.minute * 60 + timestamp.second
    next_day = coordinator.reserve("tenant", "tool", time_of_day, scheduled_at + 24 * 3600)
    assert next_day is not None
    assert next_day.logical_day != previous.logical_day

    assert coordinator.acquire(previous, "previous-day-execution") == AcquireResult.ACQUIRED
    assert coordinator.acquire(next_day, "next-day-execution") == AcquireResult.BUSY
    coordinator.finish(previous, "previous-day-execution")
    assert coordinator.acquire(next_day, "next-day-execution") == AcquireResult.ACQUIRED


def test_expired_previous_day_owner_cannot_release_next_days_running_mutex(
    application_redis: RedisClientWrapper,
) -> None:
    """Stale cleanup from another daily marker does not release a newer cross-day execution."""
    coordinator = RedisPluginAutoUpgradeCoordinator(application_redis)
    previous = _reserve(coordinator, application_redis, "tenant")
    scheduled_at = previous.deadline - 24 * 3600
    timestamp = datetime.fromtimestamp(scheduled_at, UTC)
    time_of_day = timestamp.hour * 3600 + timestamp.minute * 60 + timestamp.second
    next_day = coordinator.reserve("tenant", "tool", time_of_day, scheduled_at + 24 * 3600)
    assert next_day is not None
    assert coordinator.acquire(previous, "old-execution") == AcquireResult.ACQUIRED
    expire_lease = application_redis.register_script(
        "redis.call('ZADD', KEYS[1], 0, KEYS[2]); redis.call('DEL', KEYS[3]); return 1"
    )
    expire_lease(keys=[_SLOTS_KEY, _reservation_key(previous), _execution_key(previous)])
    assert coordinator.acquire(next_day, "new-execution") == AcquireResult.ACQUIRED

    coordinator.finish(previous, "old-execution")
    coordinator.cancel(previous)

    assert coordinator.acquire(next_day, "another-delivery") == AcquireResult.BUSY
    following_day = coordinator.reserve("tenant", "tool", time_of_day, scheduled_at + 2 * 24 * 3600)
    assert following_day is not None
    assert coordinator.acquire(following_day, "following-day-execution") == AcquireResult.BUSY


def test_cancelled_producer_cannot_delete_a_replacement_reservation(application_redis: RedisClientWrapper) -> None:
    """Only a still-pending reservation with the exact producer token is cancellable."""
    coordinator = RedisPluginAutoUpgradeCoordinator(application_redis)
    previous = _reserve(coordinator, application_redis, "tenant", producer_id="old-parent")
    coordinator.cancel(previous)
    current = _reserve(coordinator, application_redis, "tenant", producer_id="current-parent")

    coordinator.cancel(previous)
    coordinator.mark_queued(previous)
    scheduled_at = current.deadline - 24 * 3600
    timestamp = datetime.fromtimestamp(scheduled_at, UTC)
    time_of_day = timestamp.hour * 3600 + timestamp.minute * 60 + timestamp.second
    assert coordinator.reserve("tenant", "tool", time_of_day, scheduled_at, producer_id="current-parent") == current
    assert coordinator.acquire(previous, "old-delivery") == AcquireResult.DUPLICATE
    assert coordinator.acquire(current, "current-execution") == AcquireResult.ACQUIRED
    coordinator.cancel(current)
    assert coordinator.acquire(current, "duplicate") == AcquireResult.BUSY


def test_expired_queue_payload_never_starts_work(application_redis: RedisClientWrapper) -> None:
    """A delivery past its carried deadline is rejected even when no reservation key remains."""
    coordinator = RedisPluginAutoUpgradeCoordinator(application_redis)
    seconds, _ = application_redis.time()
    expired = CheckReservation(
        tenant_id="tenant",
        category="tool",
        logical_day=datetime.fromtimestamp(seconds, UTC).date().isoformat(),
        token="expired-producer",
        deadline=seconds - 1,
    )

    assert coordinator.acquire(expired, "execution") == AcquireResult.EXPIRED


def test_legacy_delivery_uses_the_previous_days_occurrence_after_midnight(
    application_redis: RedisClientWrapper,
) -> None:
    """An old payload's logical day follows its due time, rather than being moved to tomorrow."""
    coordinator = RedisPluginAutoUpgradeCoordinator(application_redis)
    seconds, _ = application_redis.time()
    now = datetime.fromtimestamp(seconds, UTC)
    midnight = now.replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(days=1, seconds=10)
    reservation = coordinator.reserve_legacy("tenant", None, 24 * 3600 - 10, midnight.timestamp())

    assert reservation is not None
    assert reservation.logical_day == now.date().isoformat()
    assert coordinator.acquire(reservation, "legacy-execution") == AcquireResult.ACQUIRED


def test_deployment_prefix_isolates_reservations_and_global_slots(application_redis: RedisClientWrapper) -> None:
    """Two deployment namespaces can reserve identical strategy identities independently."""
    coordinator = RedisPluginAutoUpgradeCoordinator(application_redis)
    with config_overrides_context(REDIS_KEY_PREFIX="upgrade-check-alpha"):
        alpha = _reserve(coordinator, application_redis, "tenant")
        assert coordinator.acquire(alpha, "alpha-execution") == AcquireResult.ACQUIRED
    with config_overrides_context(REDIS_KEY_PREFIX="upgrade-check-beta"):
        beta = _reserve(coordinator, application_redis, "tenant")
        assert coordinator.acquire(beta, "beta-execution") == AcquireResult.ACQUIRED

    with config_overrides_context(REDIS_KEY_PREFIX="upgrade-check-alpha"):
        assert coordinator.acquire(alpha, "alpha-duplicate") == AcquireResult.BUSY
    with config_overrides_context(REDIS_KEY_PREFIX="upgrade-check-beta"):
        assert coordinator.acquire(beta, "beta-duplicate") == AcquireResult.BUSY
