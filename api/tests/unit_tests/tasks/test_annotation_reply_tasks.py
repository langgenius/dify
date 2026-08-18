from unittest.mock import MagicMock, patch

import tasks.annotation.disable_annotation_reply_task as disable_task_module
import tasks.annotation.enable_annotation_reply_task as enable_task_module


class _FakeRedis:
    def __init__(self, values: dict[str, str]) -> None:
        self.values = values

    def get(self, name: str) -> str | None:
        return self.values.get(name)

    def set(self, name: str, value: str, *, nx: bool = False, ex: int | None = None) -> bool:
        del ex
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


def test_enable_annotation_reply_marks_missing_app_as_error() -> None:
    redis = _FakeRedis(
        {
            "app_annotation_job:app-1": "enable:job-1",
            "enable_app_annotation_job_job-1": "waiting",
        }
    )
    session = MagicMock()
    session.scalar.return_value = None
    session_factory = MagicMock()
    session_factory.create_session.return_value.__enter__.return_value = session

    with (
        patch.object(enable_task_module, "redis_client", redis),
        patch.object(enable_task_module, "session_factory", session_factory),
    ):
        enable_task_module.enable_annotation_reply_task.run(
            "job-1",
            "app-1",
            "user-1",
            "tenant-1",
            0.5,
            "provider",
            "model",
        )

    assert redis.values["enable_app_annotation_job_job-1"] == "error"
    assert redis.values["enable_app_annotation_error_job-1"] == "App not found"
    assert "app_annotation_job:app-1" not in redis.values


def test_disable_annotation_reply_completes_when_setting_is_already_absent() -> None:
    redis = _FakeRedis(
        {
            "app_annotation_job:app-1": "disable:job-1",
            "disable_app_annotation_job_job-1": "waiting",
        }
    )
    session = MagicMock()
    session.scalar.side_effect = [object(), False, None]
    session_factory = MagicMock()
    session_factory.create_session.return_value.__enter__.return_value = session

    with (
        patch.object(disable_task_module, "redis_client", redis),
        patch.object(disable_task_module, "session_factory", session_factory),
    ):
        disable_task_module.disable_annotation_reply_task.run("job-1", "app-1", "tenant-1")

    assert redis.values["disable_app_annotation_job_job-1"] == "completed"
    assert "app_annotation_job:app-1" not in redis.values


def test_enable_annotation_reply_releases_job_when_app_lookup_fails() -> None:
    redis = _FakeRedis(
        {
            "app_annotation_job:app-1": "enable:job-1",
            "enable_app_annotation_job_job-1": "waiting",
        }
    )
    session = MagicMock()
    session.scalar.side_effect = RuntimeError("database unavailable")
    session_factory = MagicMock()
    session_factory.create_session.return_value.__enter__.return_value = session

    with (
        patch.object(enable_task_module, "redis_client", redis),
        patch.object(enable_task_module, "session_factory", session_factory),
    ):
        enable_task_module.enable_annotation_reply_task.run(
            "job-1",
            "app-1",
            "user-1",
            "tenant-1",
            0.5,
            "provider",
            "model",
        )

    assert redis.values["enable_app_annotation_job_job-1"] == "error"
    assert redis.values["enable_app_annotation_error_job-1"] == "database unavailable"
    assert "app_annotation_job:app-1" not in redis.values
    session.rollback.assert_called_once()


def test_disable_annotation_reply_releases_job_when_app_lookup_fails() -> None:
    redis = _FakeRedis(
        {
            "app_annotation_job:app-1": "disable:job-1",
            "disable_app_annotation_job_job-1": "waiting",
        }
    )
    session = MagicMock()
    session.scalar.side_effect = RuntimeError("database unavailable")
    session_factory = MagicMock()
    session_factory.create_session.return_value.__enter__.return_value = session

    with (
        patch.object(disable_task_module, "redis_client", redis),
        patch.object(disable_task_module, "session_factory", session_factory),
    ):
        disable_task_module.disable_annotation_reply_task.run("job-1", "app-1", "tenant-1")

    assert redis.values["disable_app_annotation_job_job-1"] == "error"
    assert redis.values["disable_app_annotation_error_job-1"] == "database unavailable"
    assert "app_annotation_job:app-1" not in redis.values
    session.rollback.assert_called_once()
