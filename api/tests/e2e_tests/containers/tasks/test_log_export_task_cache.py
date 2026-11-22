"""Exercise export admission and worker recovery against a real Redis server."""

from concurrent.futures import ThreadPoolExecutor

import pytest

from extensions.ext_redis import RedisClientWrapper
from services.retention.log_export_task import (
    LogExportLeaseBusyError,
    LogExportLimitReachedError,
    LogExportStatus,
    LogExportTask,
)
from services.retention.log_export_task_cache import RedisLogExportTasks


def test_export_admission_is_atomic_and_shared_across_app_types(application_redis: RedisClientWrapper) -> None:
    """Admit one simultaneous submission per requester and cap active exports per workspace."""
    conversation = RedisLogExportTasks(
        redis=application_redis, task_type=LogExportTask[str], key_prefix="conversation_log_export"
    )
    workflow = RedisLogExportTasks(
        redis=application_redis, task_type=LogExportTask[str], key_prefix="workflow_log_export"
    )

    def submit(_: int) -> LogExportTask[str] | None:
        task = LogExportTask[str].pending(tenant_id="tenant", app_id="app", requested_by="admin", filters="all")
        try:
            conversation.save(task)
        except LogExportLimitReachedError:
            return None
        return task

    with ThreadPoolExecutor(max_workers=4) as pool:
        (active,) = [task for task in pool.map(submit, range(8)) if task is not None]
    for requester in ("admin-2", "admin-3"):
        workflow.save(
            LogExportTask[str].pending(tenant_id="tenant", app_id="workflow", requested_by=requester, filters="all")
        )
    next_task = LogExportTask[str].pending(tenant_id="tenant", app_id="other", requested_by="admin", filters="all")
    with pytest.raises(LogExportLimitReachedError):
        workflow.save(next_task)
    assert conversation.finish(active, status=LogExportStatus.FAILED)
    workflow.save(next_task)


def test_expired_lease_is_reclaimed_and_old_attempt_cannot_publish(application_redis: RedisClientWrapper) -> None:
    """Allow recovery after lease expiry and fence old attempts from the cache and capacity slot."""
    store = RedisLogExportTasks(
        redis=application_redis, task_type=LogExportTask[str], key_prefix="conversation_log_export"
    )
    task = LogExportTask[str].pending(tenant_id="tenant", app_id="app", requested_by="admin", filters="all")
    store.save(task)
    first = store.claim(task)
    assert first is not None
    assert store.renew(first)
    with pytest.raises(LogExportLeaseBusyError):
        store.claim(first)
    lease_key = f"conversation_log_export:{{tenant}}:app:{task.task_id}:lease"
    assert application_redis.ttl(lease_key) > 0
    application_redis.expire(lease_key, 0)

    second = store.claim(first)
    assert second is not None
    assert second.attempt == 2
    assert not store.renew(first)
    assert not store.finish(first, status=LogExportStatus.READY, storage_key="old.csv")
    assert store.finish(second, status=LogExportStatus.READY, storage_key="second.csv")
    result = store.get(tenant_id="tenant", app_id="app", task_id=task.task_id)
    assert result is not None
    assert result.storage_key == "second.csv"


def test_repeated_worker_loss_stops_after_three_attempts(application_redis: RedisClientWrapper) -> None:
    """Terminalize repeatedly interrupted exports and free their workspace capacity."""
    store = RedisLogExportTasks(
        redis=application_redis, task_type=LogExportTask[str], key_prefix="conversation_log_export"
    )
    task = LogExportTask[str].pending(tenant_id="tenant", app_id="app", requested_by="admin", filters="all")
    store.save(task)
    current = task
    for number in range(1, 4):
        attempt = store.claim(current)
        assert attempt is not None
        assert attempt.attempt == number
        current = attempt
        application_redis.expire(f"conversation_log_export:{{tenant}}:app:{task.task_id}:lease", 0)

    assert store.claim(current) is None
    result = store.get(tenant_id="tenant", app_id="app", task_id=task.task_id)
    assert result is not None
    assert result.status == LogExportStatus.FAILED
    store.save(LogExportTask[str].pending(tenant_id="tenant", app_id="app", requested_by="admin", filters="all"))
