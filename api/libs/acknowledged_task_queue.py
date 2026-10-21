from __future__ import annotations

import logging
import threading
from collections.abc import Callable, Generator, Sequence
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Protocol
from uuid import uuid4

from extensions.ext_redis import redis_client

logger = logging.getLogger(__name__)

_CLAIM_LEASE_SECONDS = 60 * 60
_CLAIM_HEARTBEAT_SECONDS = 60


@dataclass(frozen=True, slots=True)
class AcknowledgedTaskClaim[TaskT]:
    receipt: str
    task: TaskT


@dataclass(frozen=True, slots=True)
class AcknowledgedTaskCompletion[TaskT]:
    owned: bool
    next_claims: tuple[AcknowledgedTaskClaim[TaskT], ...]


@dataclass(frozen=True, slots=True)
class AcknowledgedTaskEnqueue[TaskT]:
    accepted: bool
    claims: tuple[AcknowledgedTaskClaim[TaskT], ...]


class AcknowledgedTaskClaimLostError(RuntimeError):
    """The worker no longer owns the queue claim for its task."""


class AcknowledgedTaskClaimAlreadyActiveError(RuntimeError):
    """Another worker is already executing this exact queue claim."""


class AcknowledgedTaskExecutionBudgetExhaustedError(RuntimeError):
    """The stable task identity has exhausted its execution budget."""


class _RedisScript(Protocol):
    def __call__(self, *, keys: list[str], args: list[object]) -> object: ...


class RedisScripts(Protocol):
    def register_script(self, script: str) -> _RedisScript: ...


REGISTER_SCOPE_LUA = """
return redis.call('SADD', KEYS[1], ARGV[1])
"""

SCAN_SCOPES_LUA = """
local cursor = redis.call('GET', KEYS[2]) or '0'
local page = redis.call('SSCAN', KEYS[1], cursor, 'COUNT', ARGV[1])
redis.call('SET', KEYS[2], page[1])
return page[2]
"""

ENQUEUE_AND_CLAIM_LUA = """
local accepted = redis.call('SADD', KEYS[5], ARGV[4])
if accepted == 1 then
    redis.call('HDEL', KEYS[6], ARGV[4])
    redis.call('LPUSH', KEYS[1], ARGV[4] .. string.char(0) .. ARGV[1])
end

local now = tonumber(redis.call('TIME')[1])
local expired = redis.call('ZRANGEBYSCORE', KEYS[3], '-inf', now)
for _, receipt in ipairs(expired) do
    local payload = redis.call('HGET', KEYS[2], receipt)
    if payload then
        redis.call('LPUSH', KEYS[1], payload)
    end
    redis.call('HDEL', KEYS[2], receipt)
    redis.call('ZREM', KEYS[3], receipt)
    redis.call('SREM', KEYS[4], receipt)
    redis.call('SREM', KEYS[8], receipt)
end

local limit = tonumber(ARGV[2])
local lease = tonumber(ARGV[3])
local available = limit - redis.call('HLEN', KEYS[2])
local claimed = {accepted}
for index = 1, available do
    local payload = redis.call('RPOP', KEYS[1])
    if not payload then
        break
    end
    local receipt = ARGV[4 + index]
    redis.call('HSET', KEYS[2], receipt, payload)
    redis.call('ZADD', KEYS[3], now + lease, receipt)
    table.insert(claimed, receipt)
    table.insert(claimed, payload)
end
return claimed
"""

COMPLETE_AND_CLAIM_LUA = """
local completed_payload = redis.call('HGET', KEYS[2], ARGV[1])
local owned = redis.call('HDEL', KEYS[2], ARGV[1])
redis.call('ZREM', KEYS[3], ARGV[1])
redis.call('SREM', KEYS[4], ARGV[1])
redis.call('SREM', KEYS[8], ARGV[1])
if completed_payload then
    local separator = string.find(completed_payload, string.char(0), 1, true)
    if separator then
        local identity = string.sub(completed_payload, 1, separator - 1)
        redis.call('SREM', KEYS[5], identity)
        redis.call('HDEL', KEYS[6], identity)
    end
end

local now = tonumber(redis.call('TIME')[1])
local expired = redis.call('ZRANGEBYSCORE', KEYS[3], '-inf', now)
for _, receipt in ipairs(expired) do
    local payload = redis.call('HGET', KEYS[2], receipt)
    if payload then
        redis.call('LPUSH', KEYS[1], payload)
    end
    redis.call('HDEL', KEYS[2], receipt)
    redis.call('ZREM', KEYS[3], receipt)
    redis.call('SREM', KEYS[4], receipt)
    redis.call('SREM', KEYS[8], receipt)
end

local limit = tonumber(ARGV[2])
local lease = tonumber(ARGV[3])
local available = limit - redis.call('HLEN', KEYS[2])
local claimed = {owned}
for index = 1, available do
    local payload = redis.call('RPOP', KEYS[1])
    if not payload then
        break
    end
    local receipt = ARGV[3 + index]
    redis.call('HSET', KEYS[2], receipt, payload)
    redis.call('ZADD', KEYS[3], now + lease, receipt)
    table.insert(claimed, receipt)
    table.insert(claimed, payload)
end
return claimed
"""

RECOVER_AND_CLAIM_LUA = """
local now = tonumber(redis.call('TIME')[1])
local expired = redis.call('ZRANGEBYSCORE', KEYS[3], '-inf', now)
for _, receipt in ipairs(expired) do
    local payload = redis.call('HGET', KEYS[2], receipt)
    if payload then
        redis.call('LPUSH', KEYS[1], payload)
    end
    redis.call('HDEL', KEYS[2], receipt)
    redis.call('ZREM', KEYS[3], receipt)
    redis.call('SREM', KEYS[4], receipt)
    redis.call('SREM', KEYS[8], receipt)
end

local limit = tonumber(ARGV[1])
local lease = tonumber(ARGV[2])
local available = limit - redis.call('HLEN', KEYS[2])
local claimed = {}
for index = 1, available do
    local payload = redis.call('RPOP', KEYS[1])
    if not payload then
        break
    end
    local receipt = ARGV[2 + index]
    redis.call('HSET', KEYS[2], receipt, payload)
    redis.call('ZADD', KEYS[3], now + lease, receipt)
    table.insert(claimed, receipt)
    table.insert(claimed, payload)
end
return claimed
"""

RELEASE_CLAIM_LUA = """
local payload = redis.call('HGET', KEYS[2], ARGV[1])
if not payload then
    return 0
end
redis.call('LPUSH', KEYS[1], payload)
redis.call('HDEL', KEYS[2], ARGV[1])
redis.call('ZREM', KEYS[3], ARGV[1])
redis.call('SREM', KEYS[4], ARGV[1])
redis.call('SREM', KEYS[8], ARGV[1])
return 1
"""

START_CLAIM_LUA = """
local payload = redis.call('HGET', KEYS[2], ARGV[1])
if not payload then
    return 0
end
if redis.call('SISMEMBER', KEYS[8], ARGV[1]) == 1 then
    return 2
end
if redis.call('SADD', KEYS[4], ARGV[1]) == 0 then
    return 2
end
local separator = string.find(payload, string.char(0), 1, true)
local identity = separator and string.sub(payload, 1, separator - 1) or payload
local attempts = tonumber(redis.call('HGET', KEYS[6], identity) or '0')
if attempts >= tonumber(ARGV[3]) then
    redis.call('SREM', KEYS[4], ARGV[1])
    return 3
end
redis.call('HINCRBY', KEYS[6], identity, 1)
local now = tonumber(redis.call('TIME')[1])
redis.call('ZADD', KEYS[3], now + tonumber(ARGV[2]), ARGV[1])
return 1
"""

DEAD_LETTER_AND_CLAIM_LUA = """
local payload = redis.call('HGET', KEYS[2], ARGV[1])
if not payload then
    return {0}
end
redis.call('HDEL', KEYS[2], ARGV[1])
redis.call('ZREM', KEYS[3], ARGV[1])
redis.call('SREM', KEYS[4], ARGV[1])
redis.call('SREM', KEYS[8], ARGV[1])
local separator = string.find(payload, string.char(0), 1, true)
local identity = separator and string.sub(payload, 1, separator - 1) or payload
redis.call('SREM', KEYS[5], identity)
local attempts = redis.call('HGET', KEYS[6], identity) or '0'
redis.call('HDEL', KEYS[6], identity)
redis.call('SET', KEYS[7], identity .. string.char(0) .. attempts .. string.char(0) .. ARGV[5], 'EX', ARGV[4])

local now = tonumber(redis.call('TIME')[1])
local expired = redis.call('ZRANGEBYSCORE', KEYS[3], '-inf', now)
for _, receipt in ipairs(expired) do
    local expired_payload = redis.call('HGET', KEYS[2], receipt)
    if expired_payload then
        redis.call('LPUSH', KEYS[1], expired_payload)
    end
    redis.call('HDEL', KEYS[2], receipt)
    redis.call('ZREM', KEYS[3], receipt)
    redis.call('SREM', KEYS[4], receipt)
    redis.call('SREM', KEYS[8], receipt)
end

local limit = tonumber(ARGV[2])
local lease = tonumber(ARGV[3])
local available = limit - redis.call('HLEN', KEYS[2])
local claimed = {1}
for index = 1, available do
    local next_payload = redis.call('RPOP', KEYS[1])
    if not next_payload then
        break
    end
    local next_receipt = ARGV[5 + index]
    redis.call('HSET', KEYS[2], next_receipt, next_payload)
    redis.call('ZADD', KEYS[3], now + lease, next_receipt)
    table.insert(claimed, next_receipt)
    table.insert(claimed, next_payload)
end
return claimed
"""

RENEW_CLAIM_LUA = """
if redis.call('HEXISTS', KEYS[2], ARGV[1]) == 0 then
    return 0
end
if redis.call('SISMEMBER', KEYS[4], ARGV[1]) == 0 then
    return 0
end
local now = tonumber(redis.call('TIME')[1])
redis.call('ZADD', KEYS[3], now + tonumber(ARGV[2]), ARGV[1])
return 1
"""

RESET_ACTIVE_CLAIM_LUA = """
if redis.call('HEXISTS', KEYS[2], ARGV[1]) == 0 then
    return 0
end
redis.call('SREM', KEYS[4], ARGV[1])
local now = tonumber(redis.call('TIME')[1])
redis.call('ZADD', KEYS[3], now + tonumber(ARGV[2]), ARGV[1])
return 1
"""

DEFER_ACTIVE_CLAIM_LUA = """
local payload = redis.call('HGET', KEYS[2], ARGV[1])
if not payload or redis.call('SISMEMBER', KEYS[4], ARGV[1]) == 0 then
    return 0
end
local separator = string.find(payload, string.char(0), 1, true)
local identity = separator and string.sub(payload, 1, separator - 1) or payload
local attempts = tonumber(redis.call('HGET', KEYS[6], identity) or '0')
if attempts <= 1 then
    redis.call('HDEL', KEYS[6], identity)
else
    redis.call('HINCRBY', KEYS[6], identity, -1)
end
redis.call('SREM', KEYS[4], ARGV[1])
redis.call('SADD', KEYS[8], ARGV[1])
local now = tonumber(redis.call('TIME')[1])
redis.call('ZADD', KEYS[3], now + tonumber(ARGV[2]), ARGV[1])
return 1
"""

READ_CLAIM_LUA = """
return redis.call('HGET', KEYS[2], ARGV[1])
"""

DEFER_EXHAUSTED_CLAIM_LUA = """
local payload = redis.call('HGET', KEYS[2], ARGV[1])
if not payload or redis.call('SISMEMBER', KEYS[4], ARGV[1]) == 1 or redis.call('SISMEMBER', KEYS[8], ARGV[1]) == 1 then
    return 0
end
local separator = string.find(payload, string.char(0), 1, true)
local identity = separator and string.sub(payload, 1, separator - 1) or payload
local attempts = tonumber(redis.call('HGET', KEYS[6], identity) or '0')
if tonumber(ARGV[5]) == 1 then
    if attempts <= 1 then
        redis.call('HDEL', KEYS[6], identity)
        attempts = 0
    else
        attempts = redis.call('HINCRBY', KEYS[6], identity, -1)
    end
end
redis.call('SADD', KEYS[8], ARGV[1])
local now = tonumber(redis.call('TIME')[1])
redis.call('ZADD', KEYS[3], now + tonumber(ARGV[2]), ARGV[1])
redis.call('SET', KEYS[7], identity .. string.char(0) .. attempts .. string.char(0) .. ARGV[3], 'EX', ARGV[4])
return 1
"""


class AcknowledgedTaskQueue[TaskT]:
    """Atomic capacity claims with broker handoff acknowledgement and worker ownership."""

    def __init__(
        self,
        scope_id: str,
        *,
        namespace: str,
        serialize: Callable[[TaskT], str],
        deserialize: Callable[[str], TaskT],
        identity: Callable[[TaskT], str],
        redis: RedisScripts = redis_client,
        token_factory: Callable[[], str] | None = None,
        lease_seconds: int = _CLAIM_LEASE_SECONDS,
        heartbeat_seconds: int = _CLAIM_HEARTBEAT_SECONDS,
        max_execution_attempts: int | None = None,
        dead_letter_ttl_seconds: int = 24 * 60 * 60,
    ) -> None:
        if not namespace or any(character not in "abcdefghijklmnopqrstuvwxyz0123456789_" for character in namespace):
            raise ValueError("namespace must contain only lowercase letters, digits, and underscores")
        if lease_seconds <= 0:
            raise ValueError("lease_seconds must be positive")
        if heartbeat_seconds <= 0 or heartbeat_seconds >= lease_seconds:
            raise ValueError("heartbeat_seconds must be positive and shorter than lease_seconds")
        if max_execution_attempts is not None and max_execution_attempts <= 0:
            raise ValueError("max_execution_attempts must be positive")
        if dead_letter_ttl_seconds <= 0:
            raise ValueError("dead_letter_ttl_seconds must be positive")

        self._scope_id = scope_id
        self._namespace = namespace
        self._serialize = serialize
        self._deserialize = deserialize
        self._identity = identity
        hash_tag = "{" + scope_id + "}"
        prefix = f"{namespace}_tenant_task_queue:{hash_tag}"
        self._pending_key = f"{prefix}:pending"
        self._claims_key = f"{prefix}:claims"
        self._deadlines_key = f"{prefix}:deadlines"
        self._active_key = f"{prefix}:active"
        self._identities_key = f"{prefix}:identities"
        self._execution_attempts_key = f"{prefix}:execution_attempts"
        self._dead_letter_key = f"{prefix}:latest_dead_letter"
        self._deferred_key = f"{prefix}:deferred"
        self._keys = [
            self._pending_key,
            self._claims_key,
            self._deadlines_key,
            self._active_key,
            self._identities_key,
            self._execution_attempts_key,
            self._dead_letter_key,
            self._deferred_key,
        ]
        self._registry_key = f"{namespace}_tenant_task_queue:{{registry}}:tenants"
        self._registry_cursor_key = f"{namespace}_tenant_task_queue:{{registry}}:cursor"
        self._redis = redis
        self._token_factory = token_factory or (lambda: uuid4().hex)
        self._lease_seconds = lease_seconds
        self._heartbeat_seconds = heartbeat_seconds
        self._max_execution_attempts = max_execution_attempts or 2_147_483_647
        self._dead_letter_ttl_seconds = dead_letter_ttl_seconds

    @staticmethod
    def registered_scopes(
        *,
        namespace: str,
        redis: RedisScripts = redis_client,
        batch_size: int = 500,
    ) -> tuple[str, ...]:
        if batch_size <= 0:
            raise ValueError("batch_size must be positive")
        values = redis.register_script(SCAN_SCOPES_LUA)(
            keys=[
                f"{namespace}_tenant_task_queue:{{registry}}:tenants",
                f"{namespace}_tenant_task_queue:{{registry}}:cursor",
            ],
            args=[batch_size],
        )
        if not isinstance(values, Sequence):
            return ()
        return tuple(_as_text(value) for value in values)

    def enqueue(self, task: TaskT, *, concurrency: int) -> tuple[AcknowledgedTaskClaim[TaskT], ...]:
        return self.enqueue_with_status(task, concurrency=concurrency).claims

    def enqueue_with_status(self, task: TaskT, *, concurrency: int) -> AcknowledgedTaskEnqueue[TaskT]:
        self._validate_concurrency(concurrency)
        identity = self._identity(task)
        if not identity or "\0" in identity:
            raise ValueError("task identity must be non-empty and cannot contain a null byte")
        self._redis.register_script(REGISTER_SCOPE_LUA)(keys=[self._registry_key], args=[self._scope_id])
        values = self._redis.register_script(ENQUEUE_AND_CLAIM_LUA)(
            keys=self._keys,
            args=[
                self._serialize(task),
                concurrency,
                self._lease_seconds,
                identity,
                *self._new_receipts(concurrency),
            ],
        )
        if not isinstance(values, Sequence) or not values:
            raise ValueError("Invalid acknowledged task queue enqueue response")
        return AcknowledgedTaskEnqueue(
            accepted=bool(int(values[0])),
            claims=self._decode_claims(values[1:]),
        )

    def complete(self, receipt: str, *, concurrency: int) -> AcknowledgedTaskCompletion[TaskT]:
        self._validate_concurrency(concurrency)
        values = self._redis.register_script(COMPLETE_AND_CLAIM_LUA)(
            keys=self._keys,
            args=[receipt, concurrency, self._lease_seconds, *self._new_receipts(concurrency)],
        )
        if not isinstance(values, Sequence) or not values:
            return AcknowledgedTaskCompletion(owned=False, next_claims=())
        return AcknowledgedTaskCompletion(
            owned=bool(int(values[0])),
            next_claims=self._decode_claims(values[1:]),
        )

    def dead_letter(
        self,
        receipt: str,
        *,
        concurrency: int,
        error: str,
    ) -> AcknowledgedTaskCompletion[TaskT]:
        """Terminally discard one owned identity and claim replacement work."""

        self._validate_concurrency(concurrency)
        values = self._redis.register_script(DEAD_LETTER_AND_CLAIM_LUA)(
            keys=self._keys,
            args=[
                receipt,
                concurrency,
                self._lease_seconds,
                self._dead_letter_ttl_seconds,
                error[:1000],
                *self._new_receipts(concurrency),
            ],
        )
        if not isinstance(values, Sequence) or not values:
            return AcknowledgedTaskCompletion(owned=False, next_claims=())
        return AcknowledgedTaskCompletion(
            owned=bool(int(values[0])),
            next_claims=self._decode_claims(values[1:]),
        )

    def recover(self, *, concurrency: int) -> tuple[AcknowledgedTaskClaim[TaskT], ...]:
        self._validate_concurrency(concurrency)
        values = self._redis.register_script(RECOVER_AND_CLAIM_LUA)(
            keys=self._keys,
            args=[concurrency, self._lease_seconds, *self._new_receipts(concurrency)],
        )
        return self._decode_claims(values)

    def release(self, receipt: str) -> bool:
        return bool(self._redis.register_script(RELEASE_CLAIM_LUA)(keys=self._keys, args=[receipt]))

    def reset_active(self, receipt: str) -> bool:
        return bool(
            self._redis.register_script(RESET_ACTIVE_CLAIM_LUA)(
                keys=self._keys,
                args=[receipt, self._lease_seconds],
            )
        )

    def defer(self, receipt: str, *, delay_seconds: int) -> bool:
        """Durably postpone active work without consuming an execution attempt."""

        if delay_seconds <= 0:
            raise ValueError("task queue deferral delay must be positive")
        return bool(
            self._redis.register_script(DEFER_ACTIVE_CLAIM_LUA)(
                keys=self._keys,
                args=[receipt, delay_seconds],
            )
        )

    def defer_exhausted(
        self,
        receipt: str,
        *,
        delay_seconds: int,
        error: str,
        refund_attempt: bool = False,
    ) -> bool:
        """Retain exhausted work, optionally allowing one payload execution retry."""

        if delay_seconds <= 0:
            raise ValueError("task queue deferral delay must be positive")
        return bool(
            self._redis.register_script(DEFER_EXHAUSTED_CLAIM_LUA)(
                keys=self._keys,
                args=[
                    receipt,
                    delay_seconds,
                    error[:1000],
                    self._dead_letter_ttl_seconds,
                    int(refund_attempt),
                ],
            )
        )

    def get_claimed_task(self, receipt: str) -> TaskT | None:
        """Read immutable recovery metadata without changing claim ownership."""

        value = self._redis.register_script(READ_CLAIM_LUA)(keys=self._keys, args=[receipt])
        if value is None or value is False:
            return None
        return self._deserialize(_serialized_payload(_as_text(value)))

    def renew(self, receipt: str) -> bool:
        return bool(
            self._redis.register_script(RENEW_CLAIM_LUA)(
                keys=self._keys,
                args=[receipt, self._lease_seconds],
            )
        )

    def start(self, receipt: str) -> None:
        value = self._redis.register_script(START_CLAIM_LUA)(
            keys=self._keys,
            args=[receipt, self._lease_seconds, self._max_execution_attempts],
        )
        if not isinstance(value, (bytes, str, int)):
            raise TypeError(f"Expected Redis integer value, got {type(value).__name__}")
        status = int(value)
        if status == 0:
            raise AcknowledgedTaskClaimLostError(f"task queue claim is no longer owned: {receipt}")
        if status == 2:
            raise AcknowledgedTaskClaimAlreadyActiveError(f"task queue claim is already active: {receipt}")
        if status == 3:
            raise AcknowledgedTaskExecutionBudgetExhaustedError(f"task queue execution budget exhausted: {receipt}")

    @contextmanager
    def maintain(self, receipt: str) -> Generator[None]:
        self.start(receipt)
        with self.heartbeat(receipt):
            yield

    @contextmanager
    def heartbeat(self, receipt: str) -> Generator[None]:
        """Renew a claim that the caller has already started atomically."""

        stopped = threading.Event()
        heartbeat = threading.Thread(
            target=self._heartbeat,
            args=(receipt, stopped),
            daemon=True,
            name=f"AcknowledgedQueueClaim({self._namespace}:{self._scope_id})",
        )
        heartbeat.start()
        try:
            yield
        finally:
            stopped.set()
            heartbeat.join(timeout=min(5, self._heartbeat_seconds))
            if heartbeat.is_alive():
                logger.warning("Task queue claim heartbeat did not stop: %s", receipt)

    def _heartbeat(self, receipt: str, stopped: threading.Event) -> None:
        while not stopped.wait(self._heartbeat_seconds):
            try:
                if not self.renew(receipt):
                    return
            except Exception:
                logger.exception("Failed to renew task queue claim: %s", receipt)

    def _new_receipts(self, count: int) -> list[str]:
        return [self._token_factory() for _ in range(count)]

    @staticmethod
    def _validate_concurrency(concurrency: int) -> None:
        if concurrency <= 0:
            raise ValueError("concurrency must be positive")

    def _decode_claims(self, values: object) -> tuple[AcknowledgedTaskClaim[TaskT], ...]:
        if not isinstance(values, Sequence):
            return ()
        if len(values) % 2:
            raise ValueError("Invalid acknowledged task queue claim response")
        return tuple(
            AcknowledgedTaskClaim(
                receipt=_as_text(values[index]),
                task=self._deserialize(_serialized_payload(_as_text(values[index + 1]))),
            )
            for index in range(0, len(values), 2)
        )


def dispatch_acknowledged_claims[TaskT](
    *,
    queue: AcknowledgedTaskQueue[TaskT],
    claims: Sequence[AcknowledgedTaskClaim[TaskT]],
    publish: Callable[[AcknowledgedTaskClaim[TaskT]], None],
    description: str,
) -> int:
    """Publish claims without duplicating work when broker acknowledgement is uncertain."""

    dispatched = 0
    for index, claim in enumerate(claims):
        try:
            publish(claim)
        except Exception:
            logger.exception("Failed to publish acknowledged task: %s", description)
            # The broker may have accepted this message before returning an error.
            # Keep the attempted claim leased and release only untouched handoffs.
            for pending_claim in claims[index + 1 :]:
                try:
                    queue.release(pending_claim.receipt)
                except Exception:
                    logger.exception("Failed to release unattempted task queue claim: %s", pending_claim.receipt)
            break
        dispatched += 1
    return dispatched


def _as_text(value: object) -> str:
    if isinstance(value, bytes):
        return value.decode("utf-8")
    if isinstance(value, str):
        return value
    raise TypeError(f"Expected Redis text value, got {type(value).__name__}")


def _serialized_payload(value: str) -> str:
    _identity, separator, payload = value.partition("\0")
    return payload if separator else value
