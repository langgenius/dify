"""Reserve reply jobs atomically while retaining the worker's legacy Redis keys."""

from extensions.ext_redis import RedisClientWrapper
from services.annotation_reply_service import AnnotationReplyAction, AnnotationReplyJob, AnnotationReplyJobStore

_PENDING_JOB_TTL_SECONDS = 24 * 60 * 60
_RESERVE_PROCESSING = """
local existing = redis.call('GET', KEYS[1])
if existing then return existing end
redis.call('SET', KEYS[1], ARGV[1], 'NX', 'EX', ARGV[2])
return ARGV[1]
"""
_RELEASE_PROCESSING = """
if redis.call('GET', KEYS[1]) == ARGV[1] then
    return redis.call('DEL', KEYS[1])
end
return 0
"""


def annotation_reply_job_owner_key(*, action: AnnotationReplyAction, job_id: str) -> str:
    return f"{action}_app_annotation_job_owner_{job_id}"


def _decode(value: bytes | str | None) -> str | None:
    return value.decode("utf-8") if isinstance(value, bytes) else value


class RedisAnnotationReplyJobRepository(AnnotationReplyJobStore):
    def __init__(self, *, redis: RedisClientWrapper) -> None:
        self._redis = redis

    def reserve(self, *, tenant_id: str, app_id: str, action: AnnotationReplyAction, job_id: str) -> str:
        # Initialize bounded metadata before exposing the job to concurrent callers.
        owner_created = self._redis.set(
            annotation_reply_job_owner_key(action=action, job_id=job_id),
            f"{tenant_id}:{app_id}",
            nx=True,
            ex=_PENDING_JOB_TTL_SECONDS,
        )
        if not owner_created and not self._is_owner(tenant_id=tenant_id, app_id=app_id, action=action, job_id=job_id):
            raise RuntimeError(f"Annotation reply job {job_id} already belongs to another app or tenant")
        self._redis.set(f"{action}_app_annotation_job_{job_id}", "waiting", nx=True, ex=_PENDING_JOB_TTL_SECONDS)
        # A single-key script also works with the existing keys on Redis Cluster.
        reserve = self._redis.register_script(_RESERVE_PROCESSING)
        pending = _decode(reserve(keys=[f"{action}_app_annotation_{app_id}"], args=[job_id, _PENDING_JOB_TTL_SECONDS]))
        if pending is None:
            raise RuntimeError(f"Annotation reply reservation is unavailable for app {app_id}")
        if pending != job_id:
            self.cancel(tenant_id=tenant_id, app_id=app_id, action=action, job_id=job_id)
            if not self._is_owner(tenant_id=tenant_id, app_id=app_id, action=action, job_id=pending):
                raise RuntimeError(f"Annotation reply reservation is unavailable for app {app_id}")
        return pending

    def cancel(self, *, tenant_id: str, app_id: str, action: AnnotationReplyAction, job_id: str) -> None:
        if not self._is_owner(tenant_id=tenant_id, app_id=app_id, action=action, job_id=job_id):
            return
        self.release_processing(app_id=app_id, action=action, job_id=job_id)
        # Separate deletes retain compatibility with legacy keys in different cluster slots.
        self._redis.delete(f"{action}_app_annotation_job_{job_id}")
        self._redis.delete(f"{action}_app_annotation_error_{job_id}")
        self._redis.delete(annotation_reply_job_owner_key(action=action, job_id=job_id))

    def release_processing(self, *, app_id: str, action: AnnotationReplyAction, job_id: str) -> None:
        """An older worker must never release a newer job's reservation."""
        release = self._redis.register_script(_RELEASE_PROCESSING)
        release(keys=[f"{action}_app_annotation_{app_id}"], args=[job_id])

    def get(
        self, *, tenant_id: str, app_id: str, action: AnnotationReplyAction, job_id: str
    ) -> AnnotationReplyJob | None:
        if not self._is_owner(tenant_id=tenant_id, app_id=app_id, action=action, job_id=job_id):
            return None
        status = _decode(self._redis.get(f"{action}_app_annotation_job_{job_id}"))
        if status is None:
            return None
        error = _decode(self._redis.get(f"{action}_app_annotation_error_{job_id}")) if status == "error" else None
        return AnnotationReplyJob(job_id=job_id, job_status=status, error_msg=error or "")

    def _is_owner(self, *, tenant_id: str, app_id: str, action: AnnotationReplyAction, job_id: str) -> bool:
        owner = _decode(self._redis.get(annotation_reply_job_owner_key(action=action, job_id=job_id)))
        return owner == f"{tenant_id}:{app_id}"
