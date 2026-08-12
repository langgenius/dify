import pytest

from services.annotation_job_service import AnnotationReplyJob, AnnotationReplyJobCoordinator


class _FakeRedis:
    def __init__(self) -> None:
        self.values: dict[str, str] = {}
        self.fail_status_write = False

    def get(self, name: str) -> str | None:
        return self.values.get(name)

    def set(self, name: str, value: str, *, nx: bool = False, ex: int | None = None) -> bool:
        del ex
        if self.fail_status_write and name.startswith(("enable_app_annotation_job_", "disable_app_annotation_job_")):
            raise RuntimeError("redis write failed")
        if nx and name in self.values:
            return False
        self.values[name] = value
        return True

    def setex(self, name: str, time: int, value: str) -> bool:
        del time
        self.values[name] = value
        return True

    def delete(self, *names: str) -> int:
        return sum(self.values.pop(name, None) is not None for name in names)

    def compare_and_delete(self, name: str, expected_value: str) -> int:
        if self.values.get(name) != expected_value:
            return 0
        del self.values[name]
        return 1


def test_acquire_releases_lock_when_initial_status_cannot_be_written() -> None:
    redis = _FakeRedis()
    redis.fail_status_write = True
    job = AnnotationReplyJob(action="enable", app_id="app-1", job_id="job-1")

    with pytest.raises(RuntimeError, match="redis write failed"):
        AnnotationReplyJobCoordinator(redis).acquire(job)

    assert job.lock_key not in redis.values


def test_old_job_cannot_release_lock_owned_by_new_job() -> None:
    redis = _FakeRedis()
    old_job = AnnotationReplyJob(action="enable", app_id="app-1", job_id="old-job")
    new_job = AnnotationReplyJob(action="disable", app_id="app-1", job_id="new-job")
    redis.values[new_job.lock_key] = new_job.lock_value

    AnnotationReplyJobCoordinator(redis).fail(old_job, "late failure")

    assert redis.values[new_job.lock_key] == new_job.lock_value
