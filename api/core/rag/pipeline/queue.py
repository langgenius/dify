from __future__ import annotations

import hashlib
import json
from collections.abc import Sequence
from enum import StrEnum
from typing import Any

from pydantic import BaseModel, ValidationError

from extensions.ext_redis import redis_client

_DEFAULT_TASK_TTL = 60 * 60  # 1 hour
_CLAIM_EMPTY_VALUE = "empty:"
_CLAIM_TASK_PREFIX = "task:"
_DISPATCH_LEASE_PREFIX = "lease:"
_DISPATCH_DONE_VALUE = "done"

_ENQUEUE_OR_ACQUIRE_SCRIPT = """
if redis.call('EXISTS', KEYS[2]) == 1 then
    redis.call('LPUSH', KEYS[1], ARGV[2])
    return 0
end
redis.call('SETEX', KEYS[2], ARGV[1], '1')
return 1
"""

_CLAIM_TASK_ONCE_SCRIPT = """
local existing = redis.call('GET', KEYS[3])
if existing then
    return existing
end
local task = redis.call('RPOP', KEYS[1])
if task then
    local claimed = ARGV[2] .. task
    redis.call('SETEX', KEYS[3], ARGV[1], claimed)
    redis.call('SETEX', KEYS[2], ARGV[1], '1')
    return claimed
end
redis.call('SETEX', KEYS[3], ARGV[1], ARGV[3])
redis.call('DEL', KEYS[2])
return ARGV[3]
"""

_CLAIM_DISPATCH_SCRIPT = """
local current = redis.call('GET', KEYS[1])
if not current then
    redis.call('SETEX', KEYS[1], ARGV[1], ARGV[2])
    return 1
end
if current == ARGV[3] then
    return 2
end
if current == ARGV[2] then
    redis.call('EXPIRE', KEYS[1], ARGV[1])
    return 1
end
return 0
"""

_RENEW_DISPATCH_SCRIPT = """
if redis.call('GET', KEYS[1]) == ARGV[2] then
    redis.call('EXPIRE', KEYS[1], ARGV[1])
    return 1
end
return 0
"""

_COMPLETE_DISPATCH_SCRIPT = """
local current = redis.call('GET', KEYS[1])
if current == ARGV[2] then
    redis.call('SETEX', KEYS[1], ARGV[1], ARGV[3])
    return 1
end
if current == ARGV[3] then
    redis.call('EXPIRE', KEYS[1], ARGV[1])
    return 1
end
return 0
"""


class TenantTaskDispatchClaimOutcome(StrEnum):
    BUSY = "busy"
    ACQUIRED = "acquired"
    DONE = "done"


class TaskWrapper(BaseModel):
    data: Any

    def serialize(self) -> str:
        return self.model_dump_json()

    @classmethod
    def deserialize(cls, serialized_data: str) -> TaskWrapper:
        return cls.model_validate_json(serialized_data)


class TenantIsolatedTaskQueue:
    """
    Simple queue for tenant isolated tasks, used for rag related tenant tasks isolation.
    It uses Redis list to store tasks, and Redis key to store task waiting flag.
    Support tasks that can be serialized by json.
    """

    def __init__(self, tenant_id: str, unique_key: str):
        self._tenant_id = tenant_id
        self._unique_key = unique_key
        self._queue = f"tenant_self_{unique_key}_task_queue:{tenant_id}"
        self._task_key = f"tenant_{unique_key}_task:{tenant_id}"

    def _dispatch_key(self, dispatch_token: str) -> str:
        if not dispatch_token:
            raise ValueError("dispatch_token must not be empty")
        token_digest = hashlib.sha256(dispatch_token.encode()).hexdigest()
        return f"tenant_{self._unique_key}_task_dispatch:{self._tenant_id}:{token_digest}"

    def get_task_key(self):
        return redis_client.get(self._task_key)

    def set_task_waiting_time(self, ttl: int = _DEFAULT_TASK_TTL):
        redis_client.setex(self._task_key, ttl, 1)

    def delete_task_key(self):
        redis_client.delete(self._task_key)

    def push_tasks(self, tasks: Sequence[Any]):
        serialized_tasks = [self._serialize_task(task) for task in tasks]

        if not serialized_tasks:
            return

        redis_client.lpush(self._queue, *serialized_tasks)

    def enqueue_or_acquire(self, task: Any, ttl: int = _DEFAULT_TASK_TTL) -> bool:
        """Atomically enqueue behind an owner or acquire the idle tenant slot.

        Returns True when the caller acquired the slot and must dispatch the
        task itself. Returns False when the task was appended to the wait queue.
        """
        if ttl <= 0:
            raise ValueError("ttl must be positive")
        acquired = redis_client.eval(
            _ENQUEUE_OR_ACQUIRE_SCRIPT,
            2,
            self._queue,
            self._task_key,
            ttl,
            self._serialize_task(task),
        )
        return bool(acquired)

    def claim_task_once(self, *, claim_key: str, ttl: int = _DEFAULT_TASK_TTL) -> tuple[bool, Any | None]:
        """Atomically claim one queued task once for a retryable release owner.

        The claim is stored before the caller dispatches it. A retry receives
        the same task instead of consuming another tenant slot.
        """
        if not claim_key:
            raise ValueError("claim_key must not be empty")
        if ttl <= 0:
            raise ValueError("ttl must be positive")
        claimed = redis_client.eval(
            _CLAIM_TASK_ONCE_SCRIPT,
            3,
            self._queue,
            self._task_key,
            claim_key,
            ttl,
            _CLAIM_TASK_PREFIX,
            _CLAIM_EMPTY_VALUE,
        )
        if isinstance(claimed, bytes):
            claimed = claimed.decode("utf-8")
        if claimed == _CLAIM_EMPTY_VALUE:
            return False, None
        if not isinstance(claimed, str) or not claimed.startswith(_CLAIM_TASK_PREFIX):
            raise ValueError("invalid tenant queue claim payload")
        return True, self._deserialize_task(claimed.removeprefix(_CLAIM_TASK_PREFIX))

    def claim_dispatch(
        self,
        *,
        dispatch_token: str,
        owner: str,
        lease_ttl: int = _DEFAULT_TASK_TTL,
    ) -> TenantTaskDispatchClaimOutcome:
        """Claim a dispatched queue item without executing duplicate messages.

        The dispatch token identifies the logical queue item while ``owner``
        identifies one Celery delivery. The lease is renewable so a worker
        loss can be recovered without allowing a concurrently delivered copy
        to execute the same source batch.
        """
        if not owner:
            raise ValueError("owner must not be empty")
        if lease_ttl <= 0:
            raise ValueError("lease_ttl must be positive")
        result = redis_client.eval(
            _CLAIM_DISPATCH_SCRIPT,
            1,
            self._dispatch_key(dispatch_token),
            lease_ttl,
            f"{_DISPATCH_LEASE_PREFIX}{owner}",
            _DISPATCH_DONE_VALUE,
        )
        if result == 1:
            return TenantTaskDispatchClaimOutcome.ACQUIRED
        if result == 2:
            return TenantTaskDispatchClaimOutcome.DONE
        return TenantTaskDispatchClaimOutcome.BUSY

    def renew_dispatch_claim(
        self,
        *,
        dispatch_token: str,
        owner: str,
        lease_ttl: int = _DEFAULT_TASK_TTL,
    ) -> bool:
        if not owner:
            raise ValueError("owner must not be empty")
        if lease_ttl <= 0:
            raise ValueError("lease_ttl must be positive")
        return bool(
            redis_client.eval(
                _RENEW_DISPATCH_SCRIPT,
                1,
                self._dispatch_key(dispatch_token),
                lease_ttl,
                f"{_DISPATCH_LEASE_PREFIX}{owner}",
            )
        )

    def complete_dispatch_claim(
        self,
        *,
        dispatch_token: str,
        owner: str,
        done_ttl: int,
    ) -> bool:
        if not owner:
            raise ValueError("owner must not be empty")
        if done_ttl <= 0:
            raise ValueError("done_ttl must be positive")
        return bool(
            redis_client.eval(
                _COMPLETE_DISPATCH_SCRIPT,
                1,
                self._dispatch_key(dispatch_token),
                done_ttl,
                f"{_DISPATCH_LEASE_PREFIX}{owner}",
                _DISPATCH_DONE_VALUE,
            )
        )

    def pull_tasks(self, count: int = 1) -> Sequence[Any]:
        if count <= 0:
            return []

        tasks = []
        for _ in range(count):
            serialized_task = redis_client.rpop(self._queue)
            if not serialized_task:
                break

            if isinstance(serialized_task, bytes):
                serialized_task = serialized_task.decode("utf-8")

            tasks.append(self._deserialize_task(serialized_task))

        return tasks

    @staticmethod
    def _serialize_task(task: Any) -> str:
        # Store strings directly, maintaining full compatibility for pipeline scenarios.
        if isinstance(task, str):
            return task
        return TaskWrapper(data=task).serialize()

    @staticmethod
    def _deserialize_task(serialized_task: str) -> Any:
        try:
            return TaskWrapper.deserialize(serialized_task).data
        except (json.JSONDecodeError, ValidationError, TypeError, ValueError):
            # Fall back to raw string for legacy format or invalid JSON.
            return serialized_task
