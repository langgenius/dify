"""Persist exports and serialize CSV generation through a FIFO per workspace."""

from collections.abc import Generator
from contextlib import contextmanager
from datetime import timedelta
from typing import TYPE_CHECKING
from uuid import uuid4

from redis.exceptions import (
    AuthenticationError,
    AuthorizationError,
    ClusterError,
    ConnectionError,
    ReadOnlyError,
    SlotNotCoveredError,
    TimeoutError,
    TryAgainError,
)

from libs.datetime_utils import utc_now
from services.retention.log_export_task import (
    LogExportKind,
    LogExportLeaseBusyError,
    LogExportLimitReachedError,
    LogExportProgress,
    LogExportStage,
    LogExportStatus,
    LogExportTask,
    LogExportTaskNotCancelableError,
)

if TYPE_CHECKING:
    from extensions.ext_redis import RedisClientWrapper

_MAX_EXPORT_ATTEMPTS = 3
_LEASE_SECONDS = 120
_DISPATCH_LEASE_SECONDS = 600
_READY_TASK_TTL = timedelta(days=7)
_TERMINAL_TASK_TTL = timedelta(days=1)
LOG_EXPORT_QUEUE_KEY_PREFIX = "log_export_queue:"

_SAVE_LOG_EXPORT_TASK = """
-- The task key identifies a previously admitted submission after a lost Redis response.
if redis.call("EXISTS", KEYS[1]) == 1 then
    return redis.call("LINDEX", KEYS[4], 0) == ARGV[4] and 1 or 2
end
local clock = redis.call("TIME")
local now = tonumber(clock[1]) * 1000 + math.floor(tonumber(clock[2]) / 1000)
redis.call("ZREMRANGEBYSCORE", KEYS[3], "-inf", now)
if redis.call("ZSCORE", KEYS[3], ARGV[1]) then
    return 0
end
redis.call("SET", KEYS[1], ARGV[2])
redis.call("SET", KEYS[2], ARGV[3])
redis.call("ZADD", KEYS[3], "+inf", ARGV[1])
redis.call("PERSIST", KEYS[3])
return redis.call("RPUSH", KEYS[4], ARGV[4]) == 1 and 1 or 2
"""

_READ_LOG_EXPORT_HEAD = 'return redis.call("LINDEX", KEYS[1], 0)'

_RESERVE_LOG_EXPORT_DISPATCH = """
if redis.call("LINDEX", KEYS[1], 0) ~= ARGV[1] then
    return 0
end
if redis.call("EXISTS", KEYS[2]) == 0 then
    redis.call("LPOP", KEYS[1])
    redis.call("ZREM", KEYS[5], ARGV[2])
    return -1
end
local clock = redis.call("TIME")
local now = tonumber(clock[1]) * 1000 + math.floor(tonumber(clock[2]) / 1000)
redis.call("ZREMRANGEBYSCORE", KEYS[5], "-inf", now)
-- Finite scores belong to pre-queue tasks already sent to Celery.
if redis.call("ZCARD", KEYS[5]) > redis.call("LLEN", KEYS[1]) or redis.call("EXISTS", KEYS[3]) == 1 then
    return 0
end
return redis.call("SET", KEYS[4], "1", "EX", ARGV[3], "NX") and 1 or 0
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
if ARGV[9] == "queued" and redis.call("LINDEX", KEYS[4], 0) ~= ARGV[8] then
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
    redis.call("SET", KEYS[1], ARGV[3], "KEEPTTL")
else
    redis.call("SET", KEYS[1], ARGV[3], "PXAT", ARGV[10])
    if redis.call("GET", KEYS[5]) == current.task_id then
        redis.call("PEXPIREAT", KEYS[5], ARGV[10])
    end
    redis.call("DEL", KEYS[6])
    redis.call("ZREM", KEYS[3], ARGV[6])
    redis.call("LREM", KEYS[4], 1, ARGV[8])
end
return can_claim and 1 or 0
"""

_RENEW_LOG_EXPORT_TASK = """
if redis.call("GET", KEYS[2]) ~= ARGV[1] then
    return 0
end
local raw = redis.call("GET", KEYS[1])
if not raw then
    return 0
end
if ARGV[3] then
    local previous = cjson.decode(raw).progress
    local snapshot = cjson.decode(ARGV[3]).progress
    -- A heartbeat can arrive after the worker starts uploading.
    if not previous or previous == cjson.null or (
        previous.stage ~= "uploading" and snapshot.rows_written >= previous.rows_written and
        (snapshot.stage == "uploading" or snapshot.rows_written > previous.rows_written)
    ) then
        redis.call("SET", KEYS[1], ARGV[3], "KEEPTTL")
    end
end
return redis.call("EXPIRE", KEYS[2], ARGV[2])
"""

_FINISH_LOG_EXPORT_TASK = """
local raw = redis.call("GET", KEYS[1])
if not raw then
    return 0
end
local current = cjson.decode(raw)
if current.status == "canceled" and ARGV[8] == "canceled" then
    return 2
end
if current.status ~= ARGV[1] or (current.attempt or 0) ~= tonumber(ARGV[2]) then
    return 0
end
if current.status == "processing" and redis.call("GET", KEYS[2]) ~= ARGV[5] then
    return 0
end
if ARGV[8] == "ready" and current.status ~= "processing" then
    return 0
end
local expires = ARGV[6]
redis.call("SET", KEYS[1], ARGV[3], "PXAT", expires)
if ARGV[8] == "ready" then
    redis.call("PEXPIREAT", KEYS[5], expires)
else
    redis.call("DEL", KEYS[5])
end
if redis.call("GET", KEYS[4]) == current.task_id then
    redis.call("PEXPIREAT", KEYS[4], expires)
end
redis.call("DEL", KEYS[2])
redis.call("ZREM", KEYS[3], ARGV[4])
redis.call("LREM", KEYS[6], 1, ARGV[7])
return 1
"""


def _queue_key(tenant_id: str) -> str:
    """Use the same cluster hash tag as the task, lease, and active requester index."""
    return f"{LOG_EXPORT_QUEUE_KEY_PREFIX}{{{tenant_id}}}"


def _active_key(tenant_id: str) -> str:
    """Share the workspace's requester/app deduplication index across export families."""
    return f"log_export_active:{{{tenant_id}}}"


def reserve_log_export_dispatch(redis: "RedisClientWrapper", tenant_id: str) -> tuple[LogExportKind, str, str] | None:
    """Reserve a delivery window for the current queue head, returning its kind, app and task IDs."""
    queue = _queue_key(tenant_id)
    head = redis.register_script(_READ_LOG_EXPORT_HEAD)
    reserve = redis.register_script(_RESERVE_LOG_EXPORT_DISPATCH)
    while raw := head(keys=[queue]):
        entry = raw.decode() if isinstance(raw, bytes) else raw
        task_key, requester = entry.rsplit(":", 1)
        prefix, _, app_id, task_id = task_key.split(":", 3)
        kind = LogExportKind(prefix.removesuffix("_log_export"))
        result = reserve(
            keys=[queue, task_key, f"{task_key}:lease", f"{task_key}:dispatch", _active_key(tenant_id)],
            args=[entry, f"{app_id}:{requester}", _DISPATCH_LEASE_SECONDS],
        )
        if result >= 0:
            return (kind, app_id, task_id) if result else None
    return None


@contextmanager
def _translate_transient_redis_errors() -> Generator[None]:
    """Translate temporary Redis I/O failures into the export worker's retry signal."""
    try:
        yield
    except (AuthenticationError, AuthorizationError):
        # redis-py subclasses ConnectionError for credential failures.
        raise
    except (
        ConnectionError,
        TimeoutError,
        OSError,
        ClusterError,
        SlotNotCoveredError,
        ReadOnlyError,
        TryAgainError,
    ) as exc:
        raise LogExportLeaseBusyError("Redis is temporarily unavailable for log export.") from exc


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

    def _execution_keys(self, task: LogExportTask[FiltersT]) -> tuple[str, str, str, str]:
        """Locate task state and concurrency keys in the same cluster slot."""
        key = self._key(tenant_id=task.tenant_id, app_id=task.app_id, task_id=task.task_id)
        return key, f"{key}:lease", _active_key(task.tenant_id), _queue_key(task.tenant_id)

    def save(self, task: LogExportTask[FiltersT]) -> bool:
        """Append once to the workspace FIFO unless the requester already has an active export in this app."""
        key, _, active, queue = self._execution_keys(task)
        latest_key = self._latest_key(tenant_id=task.tenant_id, app_id=task.app_id, requested_by=task.requested_by)
        save = self._redis.register_script(_SAVE_LOG_EXPORT_TASK)
        result = save(
            keys=[key, latest_key, active, queue],
            args=[
                f"{task.app_id}:{task.requested_by}",
                task.model_dump_json(),
                task.task_id,
                f"{key}:{task.requested_by}",
            ],
        )
        if result == 0:
            raise LogExportLimitReachedError()
        return result == 1

    def cancel(self, task: LogExportTask[FiltersT]) -> LogExportTask[FiltersT]:
        """Cancel a queued task while leaving an already-claimed task with its worker."""
        if task.status is LogExportStatus.CANCELED:
            return task
        if task.status is LogExportStatus.PENDING and (canceled := self.finish(task, status=LogExportStatus.CANCELED)):
            return canceled
        raise LogExportTaskNotCancelableError()

    def get(self, *, tenant_id: str, app_id: str, task_id: str) -> LogExportTask[FiltersT] | None:
        """Load the matching live task, signaling a retry when Redis is temporarily unavailable."""
        key = self._key(tenant_id=tenant_id, app_id=app_id, task_id=task_id)
        with _translate_transient_redis_errors():
            raw = self._redis.get(key)
        if raw is None:
            return None
        task = self._task_type.model_validate_json(raw)
        if (task.tenant_id, task.app_id, task.task_id) != (tenant_id, app_id, task_id) or (
            task.expires_at is not None and task.expires_at <= utc_now()
        ):
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
        """Claim the head or fail an exhausted task, fencing attempts with a replay-safe token."""
        if task.status not in (LogExportStatus.PENDING, LogExportStatus.PROCESSING):
            return None
        # Generate the lease token once per claim, outside the Redis client's retries.
        token = uuid4().hex
        failed_expires_at = utc_now() + _TERMINAL_TASK_TTL
        if task.attempt >= _MAX_EXPORT_ATTEMPTS:
            updated = task.model_copy(
                update={"status": LogExportStatus.FAILED, "progress": None, "expires_at": failed_expires_at}
            )
        else:
            updated = task.model_copy(
                update={
                    "status": LogExportStatus.PROCESSING,
                    "attempt": task.attempt + 1,
                    "claim_token": token,
                    "progress": LogExportProgress(stage=LogExportStage.PREPARING, rows_written=0),
                }
            )
        key, lease, active, queue = self._execution_keys(task)
        latest = self._latest_key(tenant_id=task.tenant_id, app_id=task.app_id, requested_by=task.requested_by)
        args = [
            task.status.value,
            task.attempt,
            updated.model_dump_json(),
            _MAX_EXPORT_ATTEMPTS,
            _LEASE_SECONDS,
            f"{task.app_id}:{task.requested_by}",
            token,
            f"{key}:{task.requested_by}",
            "queued" if task.expires_at is None else "legacy",
            int(failed_expires_at.timestamp() * 1000),
        ]
        with _translate_transient_redis_errors():
            claim = self._redis.register_script(_CLAIM_LOG_EXPORT_TASK)
            result = claim(keys=(key, lease, active, queue, latest, f"{key}:email"), args=args)
        if result == -1:
            raise LogExportLeaseBusyError("The log export claim is busy or has changed.")
        return updated if result else None

    def renew(self, task: LogExportTask[FiltersT], *, progress: LogExportProgress | None = None) -> bool:
        """Extend an owned lease and advance its progress without extending the task's lifetime."""
        if task.claim_token is None:
            return False
        task_key, lease_key, _, _ = self._execution_keys(task)
        args: list[str | int] = [task.claim_token, _LEASE_SECONDS]
        if progress is not None:
            args.append(task.model_copy(update={"progress": progress}).model_dump_json())
        with _translate_transient_redis_errors():
            renew = self._redis.register_script(_RENEW_LOG_EXPORT_TASK)
            return bool(renew(keys=[task_key, lease_key], args=args))

    def finish(
        self, task: LogExportTask[FiltersT], *, status: LogExportStatus, storage_key: str | None = None
    ) -> LogExportTask[FiltersT] | None:
        """Publish terminal state and remove the task from the FIFO in one conditional write."""
        ready = status is LogExportStatus.READY
        expires_at = utc_now() + (_READY_TASK_TTL if ready else _TERMINAL_TASK_TTL)
        updated = task.model_copy(
            update={
                "status": status,
                "storage_key": storage_key,
                "progress": task.progress if ready else None,
                "expires_at": expires_at,
                "claim_token": None,
            }
        )
        task_key, lease_key, active_key, queue = self._execution_keys(task)
        args = [
            task.status.value,
            task.attempt,
            updated.model_dump_json(),
            f"{task.app_id}:{task.requested_by}",
            task.claim_token or "",
            int(expires_at.timestamp() * 1000),
            f"{task_key}:{task.requested_by}",
            status.value,
        ]
        latest_key = self._latest_key(tenant_id=task.tenant_id, app_id=task.app_id, requested_by=task.requested_by)
        with _translate_transient_redis_errors():
            finish = self._redis.register_script(_FINISH_LOG_EXPORT_TASK)
            result = finish(keys=(task_key, lease_key, active_key, latest_key, f"{task_key}:email", queue), args=args)
        if result == 2:
            return self.get(tenant_id=task.tenant_id, app_id=task.app_id, task_id=task.task_id)
        return updated if result else None
