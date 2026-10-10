"""Track owned annotation imports using the existing worker keys."""

import logging
from typing import Literal

from extensions.ext_redis import RedisClientWrapper
from services.annotation_import_service import AnnotationImportJob, AnnotationImportJobStore

logger = logging.getLogger(__name__)

_CLAIM_JOB_OWNER = """
local owner = redis.call('GET', KEYS[1])
if owner and owner ~= ARGV[1] then
    return 0
end
redis.call('SET', KEYS[1], ARGV[1], 'EX', 600)
return 1
"""


def annotation_import_job_owner_key(*, job_id: str) -> str:
    return f"app_annotation_batch_import_owner_{job_id}"


def _decode(value: bytes | str | None) -> str | None:
    return value.decode("utf-8") if isinstance(value, bytes) else value


class RedisAnnotationImportJobRepository(AnnotationImportJobStore):
    def __init__(self, *, redis: RedisClientWrapper) -> None:
        self._redis = redis

    def record_request(self, *, tenant_id: str, window_seconds: Literal[60, 3600], now_ms: int) -> int:
        window = "1min" if window_seconds == 60 else "1hour"
        key = f"annotation_import_rate_limit:{tenant_id}:{window}"
        self._redis.zadd(key, {now_ms: now_ms})
        self._redis.zremrangebyscore(key, 0, now_ms - window_seconds * 1000)
        count = self._redis.zcard(key)
        self._redis.expire(key, window_seconds * 2)
        return count

    def count_active(self, *, tenant_id: str, now_ms: int) -> int:
        key = f"annotation_import_active:{tenant_id}"
        self._redis.zremrangebyscore(key, 0, now_ms - 120000)
        return self._redis.zcard(key)

    def create(self, *, tenant_id: str, app_id: str, job_id: str, now_ms: int) -> None:
        # Publish ownership before the legacy status key; pending jobs retain both keys until worker completion.
        owner_created = self._redis.setnx(annotation_import_job_owner_key(job_id=job_id), f"{tenant_id}:{app_id}")
        if not owner_created and not self._is_owner(tenant_id=tenant_id, app_id=app_id, job_id=job_id):
            raise RuntimeError(f"Annotation import job {job_id} already belongs to another app or tenant")
        active_jobs_key = f"annotation_import_active:{tenant_id}"
        self._redis.zadd(active_jobs_key, {job_id: now_ms})
        self._redis.expire(active_jobs_key, 7200)
        self._redis.setnx(f"app_annotation_batch_import_{job_id}", "waiting")

    def release(self, *, tenant_id: str, job_id: str) -> None:
        self._redis.zrem(f"annotation_import_active:{tenant_id}", job_id)

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

    def finish(self, *, tenant_id: str, app_id: str, job_id: str, error: str | None) -> None:
        """Publish success for None, or the failure text, and release this job's import slot."""
        owner_key = annotation_import_job_owner_key(job_id=job_id)
        owner_mismatch = False
        status_published = False
        try:
            claimed = self._redis.register_script(_CLAIM_JOB_OWNER)(keys=[owner_key], args=[f"{tenant_id}:{app_id}"])
            if not claimed:
                owner_mismatch = True
                raise RuntimeError(f"Annotation import job {job_id} already belongs to another app or tenant")
            # Legacy keys occupy different Redis Cluster slots; publish the error before the terminal status.
            error_key = f"app_annotation_batch_import_error_msg_{job_id}"
            if error is None:
                self._redis.delete(error_key)
            else:
                self._redis.setex(error_key, 600, error)
            self._redis.setex(f"app_annotation_batch_import_{job_id}", 600, "completed" if error is None else "error")
            status_published = True
        finally:
            if not owner_mismatch:
                try:
                    self.release(tenant_id=tenant_id, job_id=job_id)
                except Exception:
                    logger.exception(
                        "Failed to release annotation import job slot (tenant_id=%s, app_id=%s, job_id=%s)",
                        tenant_id,
                        app_id,
                        job_id,
                    )
                    # Preserve a job persistence error instead of replacing it with a cleanup failure.
                    if status_published:
                        raise

    def _is_owner(self, *, tenant_id: str, app_id: str, job_id: str) -> bool:
        owner = _decode(self._redis.get(annotation_import_job_owner_key(job_id=job_id)))
        return owner == f"{tenant_id}:{app_id}"
