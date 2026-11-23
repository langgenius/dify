"""Persist temporary export tasks and each requester's latest task in Redis."""

from typing import TYPE_CHECKING
from uuid import uuid4

from redis.exceptions import RedisError

from libs.datetime_utils import utc_now
from services.retention.log_export_task import (
    LogExportLeaseBusyError,
    LogExportLimitReachedError,
    LogExportStatus,
    LogExportTask,
)

if TYPE_CHECKING:
    from extensions.ext_redis import RedisClientWrapper

_MAX_ACTIVE_EXPORTS_PER_WORKSPACE = 3
_MAX_EXPORT_ATTEMPTS = 3
_LEASE_SECONDS = 120

_SAVE_LOG_EXPORT_TASK = """
-- The task key identifies a previously admitted submission after a lost Redis response.
if redis.call("EXISTS", KEYS[1]) == 1 then
    return 1
end
local clock = redis.call("TIME")
local now = tonumber(clock[1]) * 1000 + math.floor(tonumber(clock[2]) / 1000)
local ttl = tonumber(ARGV[2])
local expires = now + ttl
redis.call("ZREMRANGEBYSCORE", KEYS[3], "-inf", now)
if redis.call("ZSCORE", KEYS[3], ARGV[1]) or redis.call("ZCARD", KEYS[3]) >= tonumber(ARGV[5]) then
    return 0
end
redis.call("SET", KEYS[1], ARGV[3], "PXAT", expires)
redis.call("SET", KEYS[2], ARGV[4], "PXAT", expires)
redis.call("ZADD", KEYS[3], expires, ARGV[1])
if redis.call("PTTL", KEYS[3]) < ttl then
    redis.call("PEXPIREAT", KEYS[3], expires)
end
return 1
"""

_CLAIM_LOG_EXPORT_TASK = """
local raw = redis.call("GET", KEYS[1])
if not raw then
    return 0
end
local current = cjson.decode(raw)
if current.status ~= "pending" and current.status ~= "processing" then
    return 0
end
local owner = redis.call("GET", KEYS[2])
if owner then
    return owner == ARGV[7] and 1 or -1
end
local attempt = tonumber(ARGV[2])
if current.status ~= ARGV[1] or (current.attempt or 0) ~= attempt then
    return -1
end
local can_claim = attempt < tonumber(ARGV[4])
if can_claim then
    redis.call("SET", KEYS[2], ARGV[7], "EX", ARGV[5])
else
    redis.call("ZREM", KEYS[3], ARGV[6])
end
redis.call("SET", KEYS[1], ARGV[3], "KEEPTTL")
return can_claim and 1 or 0
"""

_RENEW_LOG_EXPORT_TASK = """
if redis.call("GET", KEYS[2]) ~= ARGV[1] or redis.call("EXISTS", KEYS[1]) == 0 then
    return 0
end
return redis.call("EXPIRE", KEYS[2], ARGV[2])
"""

_FINISH_LOG_EXPORT_TASK = """
local raw = redis.call("GET", KEYS[1])
if not raw then
    return 0
end
local current = cjson.decode(raw)
if current.status ~= ARGV[1] or (current.attempt or 0) ~= tonumber(ARGV[2]) then
    return 0
end
if current.status == "processing" and redis.call("GET", KEYS[2]) ~= ARGV[5] then
    return 0
end
redis.call("SET", KEYS[1], ARGV[3], "KEEPTTL")
redis.call("DEL", KEYS[2])
redis.call("ZREM", KEYS[3], ARGV[4])
return 1
"""


class RedisLogExportTasks[FiltersT]:
    """Scope temporary export tasks to their application family, workspace and app."""

    def __init__(
        self, *, redis: "RedisClientWrapper", task_type: type[LogExportTask[FiltersT]], key_prefix: str
    ) -> None:
        """Bind the Redis client and the model and key prefix for one application family."""
        self._redis = redis
        self._task_type = task_type
        self._key_prefix = key_prefix

    def _key(self, *, tenant_id: str, app_id: str, task_id: str) -> str:
        """Keep task and capacity keys for one workspace in the same Redis Cluster slot."""
        return f"{self._key_prefix}:{{{tenant_id}}}:{app_id}:{task_id}"

    def _latest_key(self, *, tenant_id: str, app_id: str, requested_by: str) -> str:
        """Locate the latest task ID for one requester in the app."""
        return f"{self._key_prefix}_latest:{{{tenant_id}}}:{app_id}:{requested_by}"

    @staticmethod
    def _active_key(tenant_id: str) -> str:
        """Share the workspace's active slots across all log export families."""
        return f"log_export_active:{{{tenant_id}}}"

    def _execution_keys(self, task: LogExportTask[FiltersT]) -> tuple[str, str, str]:
        """Locate task state, the current execution lease, and workspace capacity."""
        key = self._key(tenant_id=task.tenant_id, app_id=task.app_id, task_id=task.task_id)
        return key, f"{key}:lease", self._active_key(task.tenant_id)

    def save(self, task: LogExportTask[FiltersT]) -> None:
        """Reserve capacity for a pending task once, raising if a new submission exceeds the limit."""
        key = self._key(tenant_id=task.tenant_id, app_id=task.app_id, task_id=task.task_id)
        ttl_ms = max(1, int((task.expires_at - utc_now()).total_seconds() * 1000))
        latest_key = self._latest_key(tenant_id=task.tenant_id, app_id=task.app_id, requested_by=task.requested_by)
        save = self._redis.register_script(_SAVE_LOG_EXPORT_TASK)
        if not save(
            keys=[key, latest_key, self._active_key(task.tenant_id)],
            args=[
                f"{task.app_id}:{task.requested_by}",
                ttl_ms,
                task.model_dump_json(),
                task.task_id,
                _MAX_ACTIVE_EXPORTS_PER_WORKSPACE,
            ],
        ):
            raise LogExportLimitReachedError()

    def get(self, *, tenant_id: str, app_id: str, task_id: str) -> LogExportTask[FiltersT] | None:
        """Load the matching live task for the workspace and app."""
        raw = self._redis.get(self._key(tenant_id=tenant_id, app_id=app_id, task_id=task_id))
        if raw is None:
            return None
        task = self._task_type.model_validate_json(raw)
        if (task.tenant_id, task.app_id, task.task_id) != (tenant_id, app_id, task_id) or task.expires_at <= utc_now():
            return None
        return task

    def get_latest(self, *, tenant_id: str, app_id: str, requested_by: str) -> LogExportTask[FiltersT] | None:
        """Follow the latest ID to a live task for the exact requester, app and workspace."""
        raw = self._redis.get(self._latest_key(tenant_id=tenant_id, app_id=app_id, requested_by=requested_by))
        if raw is None:
            return None
        task_id = raw.decode() if isinstance(raw, bytes) else raw
        task = self.get(tenant_id=tenant_id, app_id=app_id, task_id=task_id)
        return task if task is not None and task.requested_by == requested_by else None

    def claim(self, task: LogExportTask[FiltersT]) -> LogExportTask[FiltersT] | None:
        """Claim one active attempt with a token that survives command retries or fail an exhausted task."""
        if task.status not in (LogExportStatus.PENDING, LogExportStatus.PROCESSING):
            return None
        # Generate the lease token once per claim, outside the Redis client's retries.
        token = uuid4().hex
        if task.attempt >= _MAX_EXPORT_ATTEMPTS:
            updated = task.model_copy(update={"status": LogExportStatus.FAILED})
        else:
            updated = task.model_copy(
                update={"status": LogExportStatus.PROCESSING, "attempt": task.attempt + 1, "claim_token": token}
            )
        claim = self._redis.register_script(_CLAIM_LOG_EXPORT_TASK)
        result = claim(
            keys=self._execution_keys(task),
            args=[
                task.status.value,
                task.attempt,
                updated.model_dump_json(),
                _MAX_EXPORT_ATTEMPTS,
                _LEASE_SECONDS,
                f"{task.app_id}:{task.requested_by}",
                token,
            ],
        )
        if result == -1:
            raise LogExportLeaseBusyError("The log export claim is busy or has changed.")
        return updated if result else None

    def renew(self, task: LogExportTask[FiltersT]) -> bool:
        """Extend a live, owned lease or signal a retry when Redis cannot confirm it."""
        if task.claim_token is None:
            return False
        task_key, lease_key, _ = self._execution_keys(task)
        try:
            renew = self._redis.register_script(_RENEW_LOG_EXPORT_TASK)
            return bool(renew(keys=[task_key, lease_key], args=[task.claim_token, _LEASE_SECONDS]))
        except RedisError as exc:
            raise LogExportLeaseBusyError("Could not renew the log export lease.") from exc

    def finish(self, task: LogExportTask[FiltersT], *, status: LogExportStatus, storage_key: str | None = None) -> bool:
        """Finish the expected pending state or the processing attempt that owns the lease token."""
        updated = task.model_copy(update={"status": status, "storage_key": storage_key})
        finish = self._redis.register_script(_FINISH_LOG_EXPORT_TASK)
        return bool(
            finish(
                keys=self._execution_keys(task),
                args=[
                    task.status.value,
                    task.attempt,
                    updated.model_dump_json(),
                    f"{task.app_id}:{task.requested_by}",
                    task.claim_token or "",
                ],
            )
        )
