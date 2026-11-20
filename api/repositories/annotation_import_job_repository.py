"""Retain annotation import worker keys while scoping job reads to their owner."""

from typing import Literal
from uuid import uuid4

from extensions.ext_redis import RedisClientWrapper
from services.annotation_import_service import AnnotationImportJob, AnnotationImportJobStore

# Keep reservations for the same bounded interval as pending job status keys.
_PENDING_JOB_TTL_SECONDS = 24 * 60 * 60

_RESERVE_ACTIVE_JOB_LUA = """
local now_ms = tonumber(ARGV[1])
local max_concurrent = tonumber(ARGV[2])
local job_id = ARGV[3]
local stale_after_seconds = tonumber(ARGV[4])
local active_score = redis.call('ZSCORE', KEYS[1], job_id)
if active_score then
    redis.call('ZADD', KEYS[1], now_ms, job_id)
    redis.call('EXPIRE', KEYS[1], stale_after_seconds)
    return 1
end
redis.call('ZREMRANGEBYSCORE', KEYS[1], 0, now_ms - stale_after_seconds * 1000)
if redis.call('ZCARD', KEYS[1]) >= max_concurrent then
    return 0
end
redis.call('ZADD', KEYS[1], now_ms, job_id)
redis.call('EXPIRE', KEYS[1], stale_after_seconds)
return 1
"""

_PRUNE_STALE_ACTIVE_JOBS_LUA = """
local now_ms = tonumber(ARGV[1])
local stale_after_seconds = tonumber(ARGV[2])
redis.call('ZREMRANGEBYSCORE', KEYS[1], 0, now_ms - stale_after_seconds * 1000)
redis.call('EXPIRE', KEYS[1], stale_after_seconds)
return redis.call('ZCARD', KEYS[1])
"""


def annotation_import_job_owner_key(*, job_id: str) -> str:
    return f"app_annotation_batch_import_owner_{job_id}"


def _decode(value: bytes | str | None) -> str | None:
    return value.decode("utf-8") if isinstance(value, bytes) else value


class RedisAnnotationImportJobRepository(AnnotationImportJobStore):
    def __init__(self, *, redis: RedisClientWrapper) -> None:
        self._redis = redis
        self._reserve_active_job = self._redis.register_script(_RESERVE_ACTIVE_JOB_LUA)
        self._prune_stale_active_jobs = self._redis.register_script(_PRUNE_STALE_ACTIVE_JOBS_LUA)

    def record_request(self, *, tenant_id: str, window_seconds: Literal[60, 3600], now_ms: int) -> int:
        window = "1min" if window_seconds == 60 else "1hour"
        key = f"annotation_import_rate_limit:{tenant_id}:{window}"
        self._redis.zadd(key, {f"{now_ms}:{uuid4()}": now_ms})
        self._redis.zremrangebyscore(key, 0, now_ms - window_seconds * 1000)
        count = self._redis.zcard(key)
        self._redis.expire(key, window_seconds * 2)
        return count

    def count_active(self, *, tenant_id: str, now_ms: int) -> int:
        key = f"annotation_import_active:{tenant_id}"
        return int(self._prune_stale_active_jobs(keys=[key], args=[now_ms, _PENDING_JOB_TTL_SECONDS]))

    def create(
        self,
        *,
        tenant_id: str,
        app_id: str,
        job_id: str,
        now_ms: int,
        max_concurrent: int | None = None,
    ) -> bool:
        # Bound abandoned jobs while allowing queued imports a day to start; workers shorten terminal retention.
        owner_created = self._redis.set(
            annotation_import_job_owner_key(job_id=job_id),
            f"{tenant_id}:{app_id}",
            nx=True,
            ex=_PENDING_JOB_TTL_SECONDS,
        )
        if not owner_created and not self._is_owner(tenant_id=tenant_id, app_id=app_id, job_id=job_id):
            raise RuntimeError(f"Annotation import job {job_id} already belongs to another app or tenant")
        active_jobs_key = f"annotation_import_active:{tenant_id}"
        if max_concurrent is None:
            self._redis.zadd(active_jobs_key, {job_id: now_ms})
            self._redis.expire(active_jobs_key, _PENDING_JOB_TTL_SECONDS)
        else:
            reserved = self._reserve_active_job(
                keys=[active_jobs_key], args=[now_ms, max_concurrent, job_id, _PENDING_JOB_TTL_SECONDS]
            )
            if not reserved:
                if owner_created:
                    self._redis.delete(annotation_import_job_owner_key(job_id=job_id))
                return False
        self._redis.set(f"app_annotation_batch_import_{job_id}", "waiting", nx=True, ex=_PENDING_JOB_TTL_SECONDS)
        return True

    def release(self, *, tenant_id: str, app_id: str, job_id: str) -> None:
        """Remove an unpublished job only when its recorded workspace and app still match."""
        if not self._is_owner(tenant_id=tenant_id, app_id=app_id, job_id=job_id):
            return
        self._redis.zrem(f"annotation_import_active:{tenant_id}", job_id)
        self._redis.delete(f"app_annotation_batch_import_{job_id}")
        self._redis.delete(f"app_annotation_batch_import_error_msg_{job_id}")
        self._redis.delete(annotation_import_job_owner_key(job_id=job_id))

    def get(self, *, tenant_id: str, app_id: str, job_id: str) -> AnnotationImportJob | None:
        if not self._is_owner(tenant_id=tenant_id, app_id=app_id, job_id=job_id):
            return None
        status = _decode(self._redis.get(f"app_annotation_batch_import_{job_id}"))
        if status is None:
            return None
        error = (
            _decode(self._redis.get(f"app_annotation_batch_import_error_msg_{job_id}")) if status == "error" else None
        )
        return AnnotationImportJob(job_id=job_id, job_status=status, error_msg=error or "")

    def _is_owner(self, *, tenant_id: str, app_id: str, job_id: str) -> bool:
        owner = _decode(self._redis.get(annotation_import_job_owner_key(job_id=job_id)))
        return owner == f"{tenant_id}:{app_id}"
