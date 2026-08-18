from dataclasses import dataclass
from typing import Literal, Protocol

from werkzeug.exceptions import Conflict

AnnotationReplyAction = Literal["enable", "disable"]

ANNOTATION_REPLY_JOB_TTL_SECONDS = 7200
ANNOTATION_REPLY_JOB_RESULT_TTL_SECONDS = 600


class AnnotationReplyJobRedisClient(Protocol):
    def get(self, name: str) -> bytes | str | None: ...

    def set(self, name: str, value: str, *, nx: bool = False, ex: int | None = None) -> object: ...

    def setex(self, name: str, time: int, value: str) -> object: ...

    def delete(self, *names: str) -> object: ...

    def compare_and_delete(self, name: str, expected_value: str) -> object: ...


@dataclass(frozen=True)
class AnnotationReplyJob:
    action: AnnotationReplyAction
    app_id: str
    job_id: str

    @property
    def lock_key(self) -> str:
        return f"app_annotation_job:{self.app_id}"

    @property
    def status_key(self) -> str:
        return f"{self.action}_app_annotation_job_{self.job_id}"

    @property
    def error_key(self) -> str:
        return f"{self.action}_app_annotation_error_{self.job_id}"

    @property
    def lock_value(self) -> str:
        return f"{self.action}:{self.job_id}"


class AnnotationReplyJobCoordinator:
    def __init__(self, redis_client: AnnotationReplyJobRedisClient) -> None:
        self._redis_client = redis_client

    @staticmethod
    def _decode(value: bytes | str) -> str:
        return value.decode() if isinstance(value, bytes) else value

    def acquire(self, job: AnnotationReplyJob) -> str | None:
        if self._redis_client.set(
            job.lock_key,
            job.lock_value,
            nx=True,
            ex=ANNOTATION_REPLY_JOB_TTL_SECONDS,
        ):
            self._initialize_status(job)
            return None

        running_value = self._redis_client.get(job.lock_key)
        if running_value is None:
            if self._redis_client.set(
                job.lock_key,
                job.lock_value,
                nx=True,
                ex=ANNOTATION_REPLY_JOB_TTL_SECONDS,
            ):
                self._initialize_status(job)
                return None
            running_value = self._redis_client.get(job.lock_key)

        if running_value is None:
            raise Conflict("An annotation reply job is already running for this app.")

        running_action, separator, running_job_id = self._decode(running_value).partition(":")
        if separator and running_action == job.action and running_job_id:
            return running_job_id

        raise Conflict("An annotation reply job is already running for this app.")

    def _initialize_status(self, job: AnnotationReplyJob) -> None:
        try:
            self._redis_client.set(job.status_key, "waiting", ex=ANNOTATION_REPLY_JOB_TTL_SECONDS)
        except Exception:
            self._release(job)
            raise

    def start(self, job: AnnotationReplyJob) -> bool:
        running_value = self._redis_client.get(job.lock_key)
        if running_value is None or self._decode(running_value) != job.lock_value:
            self._redis_client.setex(
                job.status_key,
                ANNOTATION_REPLY_JOB_RESULT_TTL_SECONDS,
                "error",
            )
            self._redis_client.setex(
                job.error_key,
                ANNOTATION_REPLY_JOB_RESULT_TTL_SECONDS,
                "Job no longer owns the application lock",
            )
            return False

        self._redis_client.set(job.status_key, "processing", ex=ANNOTATION_REPLY_JOB_TTL_SECONDS)
        return True

    def complete(self, job: AnnotationReplyJob) -> None:
        self._redis_client.setex(
            job.status_key,
            ANNOTATION_REPLY_JOB_RESULT_TTL_SECONDS,
            "completed",
        )
        self._release(job)

    def fail(self, job: AnnotationReplyJob, error: str) -> None:
        self._redis_client.setex(
            job.status_key,
            ANNOTATION_REPLY_JOB_RESULT_TTL_SECONDS,
            "error",
        )
        self._redis_client.setex(
            job.error_key,
            ANNOTATION_REPLY_JOB_RESULT_TTL_SECONDS,
            error,
        )
        self._release(job)

    def _release(self, job: AnnotationReplyJob) -> None:
        self._redis_client.compare_and_delete(job.lock_key, job.lock_value)

    def abandon(self, job: AnnotationReplyJob) -> None:
        self._release(job)
        self._redis_client.delete(job.status_key)
