"""Coordinate queued and running plugin upgrade checks across Celery workers.

Reservations deduplicate one tenant/category on its scheduled UTC day. Execution
slots are leases, not dispatch counters: a queued task consumes no execution slot.
The task's hard time limit must remain shorter than the slot lease so a crashed
worker's slot is recoverable without admitting work alongside its old execution.
"""

from __future__ import annotations

import hashlib
import json
import math
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from enum import StrEnum
from typing import Any, Protocol
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field

MAX_CONCURRENT_CHECK_TASKS = 20
CHECK_TASK_TIME_LIMIT = 30 * 60
CHECK_SLOT_LEASE_SECONDS = CHECK_TASK_TIME_LIMIT + 60
CHECK_QUEUE_DEADLINE_SECONDS = 24 * 60 * 60
CHECK_INTERVAL_SECONDS = 15 * 60
SCHEDULE_WINDOW_LEAD_SECONDS = 30

# All script keys share a Redis Cluster hash slot, even when a deployment adds
# its own Redis namespace prefix. register_script applies that prefix for us.
_KEY_PREFIX = "plugin-autoupgrade:{plugin-autoupgrade}"
_SLOTS_KEY = f"{_KEY_PREFIX}:executions"


class CheckReservation(BaseModel):
    """Carry a producer's immutable reservation token through the task queue."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    tenant_id: str = Field(min_length=1, max_length=255)
    category: str | None
    logical_day: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    token: str = Field(min_length=1, max_length=128)
    deadline: float = Field(gt=0, allow_inf_nan=False)


class AcquireResult(StrEnum):
    """Describe whether this delivery may perform expensive plugin work."""

    ACQUIRED = "acquired"
    BUSY = "busy"
    DUPLICATE = "duplicate"
    EXPIRED = "expired"


class _CoordinationRedis(Protocol):
    """Provide namespace-aware Redis scripts; errors must propagate to callers."""

    def register_script(self, script: str) -> Callable[..., Any]:
        """Return a script that atomically executes against its supplied keys."""
        ...


_RESERVE_SCRIPT = """
local clock = redis.call('TIME')
local now = tonumber(clock[1]) * 1000 + math.floor(tonumber(clock[2]) / 1000)
local deadline = tonumber(ARGV[2])
if now >= deadline then
    return 0
end
if redis.call('EXISTS', KEYS[1]) == 1 then
    if redis.call('HGET', KEYS[1], 'token') == ARGV[1]
        and redis.call('HGET', KEYS[1], 'deadline') == ARGV[2]
        and redis.call('HGET', KEYS[1], 'state') == 'pending' then
        return 1
    end
    return 0
end
redis.call('HSET', KEYS[1], 'token', ARGV[1], 'deadline', ARGV[2], 'state', 'pending')
redis.call('PEXPIREAT', KEYS[1], deadline)
return 1
"""

_SCHEDULE_ANCHOR_SCRIPT = """
redis.call('SET', KEYS[1], ARGV[1], 'NX', 'EX', ARGV[2])
return redis.call('GET', KEYS[1])
"""

_MARK_QUEUED_SCRIPT = """
if redis.call('HGET', KEYS[1], 'token') == ARGV[1]
    and redis.call('HGET', KEYS[1], 'state') == 'pending' then
    redis.call('HSET', KEYS[1], 'state', 'queued')
    return 1
end
return 0
"""

_ACQUIRE_SCRIPT = """
local clock = redis.call('TIME')
local now = tonumber(clock[1]) * 1000 + math.floor(tonumber(clock[2]) / 1000)
local deadline = tonumber(ARGV[3])
if now >= deadline then
    return 4
end
if redis.call('HGET', KEYS[1], 'token') ~= ARGV[1]
    or redis.call('HGET', KEYS[1], 'deadline') ~= ARGV[3] then
    return 3
end
local state = redis.call('HGET', KEYS[1], 'state')
if state ~= 'pending' and state ~= 'queued' and state ~= 'running' then
    return 3
end
local active_until = redis.call('ZSCORE', KEYS[2], KEYS[1])
if state == 'running' and active_until and tonumber(active_until) > now then
    return 2
end
-- Daily deduplication markers are separate, but two days' checks for the same
-- tenant/category must never run together across the UTC date boundary.
if redis.call('EXISTS', KEYS[3]) == 1 then
    return 2
end
redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', now)
if redis.call('ZCARD', KEYS[2]) >= tonumber(ARGV[4]) then
    return 2
end
local lease_until = now + tonumber(ARGV[5])
redis.call('SET', KEYS[3], ARGV[1] .. ':' .. ARGV[2], 'PXAT', lease_until)
redis.call('ZADD', KEYS[2], lease_until, KEYS[1])
redis.call('HSET', KEYS[1], 'state', 'running', 'execution_token', ARGV[2])
-- Keep ownership until the execution lease ends, even if the queue deadline
-- passes while work is running. No delivery may start after that deadline.
redis.call('PEXPIREAT', KEYS[1], math.max(deadline, lease_until))
redis.call('PEXPIRE', KEYS[2], tonumber(ARGV[5]) + 1000)
return 1
"""

_FINISH_SCRIPT = """
if redis.call('HGET', KEYS[1], 'token') ~= ARGV[1]
    or redis.call('HGET', KEYS[1], 'execution_token') ~= ARGV[2]
    or redis.call('HGET', KEYS[1], 'state') ~= 'running' then
    return 0
end
redis.call('ZREM', KEYS[2], KEYS[1])
if redis.call('GET', KEYS[3]) == ARGV[1] .. ':' .. ARGV[2] then
    redis.call('DEL', KEYS[3])
end
-- Keep the hash type so workers using the original reservation scripts can read it.
redis.call('HSET', KEYS[1], 'state', 'done')
redis.call('HDEL', KEYS[1], 'token', 'deadline', 'execution_token')
redis.call('PEXPIREAT', KEYS[1], tonumber(ARGV[3]))
return 1
"""

_CANCEL_SCRIPT = """
if redis.call('HGET', KEYS[1], 'token') == ARGV[1]
    and redis.call('HGET', KEYS[1], 'state') == 'pending' then
    return redis.call('DEL', KEYS[1])
end
return 0
"""


def _reservation_key(reservation: CheckReservation) -> str:
    """Return the same bounded Redis key for one tenant/category/logical day."""
    identity = json.dumps([reservation.tenant_id, reservation.category, reservation.logical_day], separators=(",", ":"))
    return f"{_KEY_PREFIX}:reservation:{hashlib.sha256(identity.encode()).hexdigest()}"


def _execution_key(reservation: CheckReservation) -> str:
    """Return one active-only mutex identity for a tenant/category across all scheduled days."""
    identity = json.dumps([reservation.tenant_id, reservation.category], separators=(",", ":"))
    return f"{_KEY_PREFIX}:running:{hashlib.sha256(identity.encode()).hexdigest()}"


def _logical_day(upgrade_time_of_day: int, scheduled_at: float) -> str:
    """Map a valid strategy in the producer's window to its UTC occurrence day."""
    if not 0 <= upgrade_time_of_day < CHECK_QUEUE_DEADLINE_SECONDS:
        raise ValueError("upgrade_time_of_day must be within one UTC day")
    if not math.isfinite(scheduled_at) or scheduled_at <= 0:
        raise ValueError("scheduled_at must be a positive finite Unix timestamp")
    window_start = datetime.fromtimestamp(scheduled_at - SCHEDULE_WINDOW_LEAD_SECONDS, UTC)
    occurrence = window_start.replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(
        seconds=upgrade_time_of_day
    )
    if occurrence < window_start:
        occurrence += timedelta(days=1)
    return occurrence.date().isoformat()


class RedisPluginAutoUpgradeCoordinator:
    """Deduplicate checks and admit at most twenty simultaneous leased executions."""

    def __init__(self, redis: _CoordinationRedis) -> None:
        """Bind namespace-aware scripts; no Redis operation runs until called."""
        self._reserve = redis.register_script(_RESERVE_SCRIPT)
        self._schedule_anchor = redis.register_script(_SCHEDULE_ANCHOR_SCRIPT)
        self._mark_queued = redis.register_script(_MARK_QUEUED_SCRIPT)
        self._acquire = redis.register_script(_ACQUIRE_SCRIPT)
        self._finish = redis.register_script(_FINISH_SCRIPT)
        self._cancel = redis.register_script(_CANCEL_SCRIPT)

    def schedule_anchor(self, producer_id: str, scheduled_at: float) -> float:
        """Retain one producer's original window across retries and broker redelivery for twenty-four hours."""
        if not producer_id:
            raise ValueError("producer_id must not be empty")
        if not math.isfinite(scheduled_at) or scheduled_at <= 0:
            raise ValueError("scheduled_at must be a positive finite Unix timestamp")
        producer_key = f"{_KEY_PREFIX}:producer:{hashlib.sha256(producer_id.encode()).hexdigest()}"
        anchor = self._schedule_anchor(keys=[producer_key], args=[repr(scheduled_at), CHECK_QUEUE_DEADLINE_SECONDS])
        return float(anchor)

    def reserve(
        self,
        tenant_id: str,
        category: str | None,
        upgrade_time_of_day: int,
        scheduled_at: float,
        producer_id: str | None = None,
    ) -> CheckReservation | None:
        """Reserve a scheduled check until its deadline, or return None if already reserved.

        A reservation covers queued, running, and completed deliveries. With a
        stable producer_id, the same producer can recover a pending reservation
        after losing Redis's reply or crashing before publication. The caller
        must retain scheduled_at on retry and mark successful publication queued.
        Redis errors propagate instead of permitting uncoordinated work.
        """
        if producer_id == "":
            raise ValueError("producer_id must not be empty when provided")
        logical_day = _logical_day(upgrade_time_of_day, scheduled_at)
        token = uuid4().hex
        if producer_id is not None:
            owner = json.dumps([producer_id, tenant_id, category, logical_day], separators=(",", ":"))
            token = hashlib.sha256(owner.encode()).hexdigest()
        reservation = CheckReservation(
            tenant_id=tenant_id,
            category=category,
            logical_day=logical_day,
            token=token,
            deadline=scheduled_at + CHECK_QUEUE_DEADLINE_SECONDS,
        )
        reserved = self._reserve(
            keys=[_reservation_key(reservation)], args=[reservation.token, int(reservation.deadline * 1000)]
        )
        return reservation if int(reserved) == 1 else None

    def mark_queued(self, reservation: CheckReservation) -> None:
        """Mark only this producer's pending reservation published, preserving running or completed work."""
        self._mark_queued(keys=[_reservation_key(reservation)], args=[reservation.token])

    def reserve_legacy(
        self,
        tenant_id: str,
        category: str | None,
        upgrade_time_of_day: int,
        now: float,
        producer_id: str | None = None,
    ) -> CheckReservation | None:
        """Coordinate an old task lacking a producer token using its nearest due UTC occurrence.

        Legacy payloads lack a creation timestamp. They may have been published
        up to one check interval before their configured time or delayed after
        it; select that occurrence instead of incorrectly reserving tomorrow.
        """
        if not 0 <= upgrade_time_of_day < CHECK_QUEUE_DEADLINE_SECONDS:
            raise ValueError("upgrade_time_of_day must be within one UTC day")
        if not math.isfinite(now) or now <= 0:
            raise ValueError("now must be a positive finite Unix timestamp")
        timestamp = datetime.fromtimestamp(now, UTC)
        occurrence = timestamp.replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(
            seconds=upgrade_time_of_day
        )
        if occurrence.timestamp() > now + CHECK_INTERVAL_SECONDS:
            occurrence -= timedelta(days=1)
        return self.reserve(tenant_id, category, upgrade_time_of_day, occurrence.timestamp(), producer_id=producer_id)

    def acquire(self, reservation: CheckReservation, execution_token: str) -> AcquireResult:
        """Claim one execution slot, or report contention, duplication, or an expired deadline.

        A running duplicate never receives the same slot, even when it presents
        the same execution token. Expired leases are reclaimable after the
        shorter Celery hard time limit has terminated their previous work.
        """
        if not execution_token:
            raise ValueError("execution_token must not be empty")
        result = self._acquire(
            keys=[_reservation_key(reservation), _SLOTS_KEY, _execution_key(reservation)],
            args=[
                reservation.token,
                execution_token,
                int(reservation.deadline * 1000),
                MAX_CONCURRENT_CHECK_TASKS,
                CHECK_SLOT_LEASE_SECONDS * 1000,
            ],
        )
        return {
            1: AcquireResult.ACQUIRED,
            2: AcquireResult.BUSY,
            3: AcquireResult.DUPLICATE,
            4: AcquireResult.EXPIRED,
        }[int(result)]

    def finish(self, reservation: CheckReservation, execution_token: str) -> None:
        """Release the matching execution and keep only its done state until the original deadline."""
        self._finish(
            keys=[_reservation_key(reservation), _SLOTS_KEY, _execution_key(reservation)],
            args=[reservation.token, execution_token, int(reservation.deadline * 1000)],
        )

    def cancel(self, reservation: CheckReservation) -> None:
        """Undo only this producer's still-pending reservation after a publication failure."""
        self._cancel(keys=[_reservation_key(reservation)], args=[reservation.token])


def get_upgrade_check_coordinator() -> RedisPluginAutoUpgradeCoordinator:
    """Create the task adapter using the application's namespaced Redis client."""
    from extensions.ext_redis import redis_client

    return RedisPluginAutoUpgradeCoordinator(redis=redis_client)
