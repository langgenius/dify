"""Retain annotation worker keys while scoping job reads to their owner."""

from extensions.ext_redis import RedisClientWrapper
from services.annotation_reply_service import AnnotationReplyAction, AnnotationReplyJob, AnnotationReplyJobStore

_CLAIM_JOB_OWNER = """
local owner = redis.call('GET', KEYS[1])
if owner and owner ~= ARGV[1] then
    return 0
end
redis.call('SET', KEYS[1], ARGV[1], 'EX', 600)
return 1
"""

_RELEASE_PROCESSING_JOB = """
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

    def get_processing(self, *, tenant_id: str, app_id: str, action: AnnotationReplyAction) -> str | None:
        job_id = _decode(self._redis.get(f"{action}_app_annotation_{app_id}"))
        if job_id is None or not self._is_owner(tenant_id=tenant_id, app_id=app_id, action=action, job_id=job_id):
            return None
        return job_id

    def create(self, *, tenant_id: str, app_id: str, action: AnnotationReplyAction, job_id: str) -> None:
        # Publish ownership before the legacy status key; pending jobs retain both keys until worker completion.
        owner_created = self._redis.setnx(
            annotation_reply_job_owner_key(action=action, job_id=job_id), f"{tenant_id}:{app_id}"
        )
        if not owner_created and not self._is_owner(tenant_id=tenant_id, app_id=app_id, action=action, job_id=job_id):
            raise RuntimeError(f"Annotation reply job {job_id} already belongs to another app or tenant")
        self._redis.setnx(f"{action}_app_annotation_job_{job_id}", "waiting")

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

    def finish(
        self,
        *,
        tenant_id: str,
        app_id: str,
        action: AnnotationReplyAction,
        job_id: str,
        error: str | None,
    ) -> None:
        """Publish success for None, or preserve the failure text, then release this job's processing key."""
        owner_key = annotation_reply_job_owner_key(action=action, job_id=job_id)
        claimed = self._redis.register_script(_CLAIM_JOB_OWNER)(keys=[owner_key], args=[f"{tenant_id}:{app_id}"])
        if not claimed:
            raise RuntimeError(f"Annotation reply job {job_id} already belongs to another app or tenant")

        # Legacy keys occupy different Redis Cluster slots; publish the error before the terminal status.
        error_key = f"{action}_app_annotation_error_{job_id}"
        if error is None:
            self._redis.delete(error_key)
        else:
            self._redis.setex(error_key, 600, error)
        self._redis.setex(f"{action}_app_annotation_job_{job_id}", 600, "completed" if error is None else "error")
        self._redis.register_script(_RELEASE_PROCESSING_JOB)(keys=[f"{action}_app_annotation_{app_id}"], args=[job_id])

    def _is_owner(self, *, tenant_id: str, app_id: str, action: AnnotationReplyAction, job_id: str) -> bool:
        owner = _decode(self._redis.get(annotation_reply_job_owner_key(action=action, job_id=job_id)))
        return owner == f"{tenant_id}:{app_id}"
