"""Exercise export admission and worker recovery against a real Redis server."""

from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta

import pytest

from extensions.ext_redis import RedisClientWrapper
from libs.datetime_utils import utc_now
from services.retention.log_export_task import (
    LogExportLeaseBusyError,
    LogExportLimitReachedError,
    LogExportProgress,
    LogExportStage,
    LogExportStatus,
    LogExportTask,
)
from services.retention.log_export_task_cache import _CLAIM_LOG_EXPORT_TASK, _SAVE_LOG_EXPORT_TASK, RedisLogExportTasks


def test_replayed_save_preserves_the_admitted_task(application_redis: RedisClientWrapper) -> None:
    """A retry after a lost response acknowledges the same task."""
    task = LogExportTask[str].pending(tenant_id="tenant", app_id="app", requested_by="admin", filters="all")
    keys = [
        f"conversation_log_export:{{tenant}}:app:{task.task_id}",
        "conversation_log_export_latest:{tenant}:app:admin",
        "log_export_active:{tenant}",
    ]
    args = ["app:admin", 60_000, task.model_dump_json(), task.task_id, 3]
    save = application_redis.register_script(_SAVE_LOG_EXPORT_TASK)

    assert save(keys=keys, args=args) == 1
    assert save(keys=keys, args=args) == 1


def test_replayed_claim_recognizes_only_its_own_token(application_redis: RedisClientWrapper) -> None:
    """Only the command that acquired the lease can replay its claim."""
    store = RedisLogExportTasks(
        redis=application_redis, task_type=LogExportTask[str], key_prefix="conversation_log_export"
    )
    task = LogExportTask[str].pending(tenant_id="tenant", app_id="app", requested_by="admin", filters="all")
    store.save(task)
    task_key = f"conversation_log_export:{{tenant}}:app:{task.task_id}"
    keys = [task_key, f"{task_key}:lease", "log_export_active:{tenant}"]
    processing = task.model_copy(update={"status": LogExportStatus.PROCESSING, "attempt": 1})
    args = [task.status.value, task.attempt, processing.model_dump_json(), 3, 120, "app:admin", "first-token"]
    claim = application_redis.register_script(_CLAIM_LOG_EXPORT_TASK)

    assert claim(keys=keys, args=args) == 1
    assert claim(keys=keys, args=args) == 1
    assert claim(keys=keys, args=[*args[:-1], "other-token"]) == -1
    assert store.get(tenant_id="tenant", app_id="app", task_id=task.task_id) == processing

    application_redis.expire(keys[1], 0)
    assert claim(keys=keys, args=args) == -1


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


def test_finish_requires_the_lease_token_for_the_same_attempt(application_redis: RedisClientWrapper) -> None:
    """Reject publication with a foreign token even when the state and attempt match."""
    store = RedisLogExportTasks(
        redis=application_redis, task_type=LogExportTask[str], key_prefix="conversation_log_export"
    )
    task = LogExportTask[str].pending(tenant_id="tenant", app_id="app", requested_by="admin", filters="all")
    store.save(task)
    claim = store.claim(task)
    assert claim is not None

    foreign_claim = claim.model_copy(update={"claim_token": "wrong-token"})
    assert not store.finish(foreign_claim, status=LogExportStatus.READY, storage_key="foreign.csv")
    assert store.finish(claim, status=LogExportStatus.READY, storage_key="owned.csv")
    result = store.get(tenant_id=task.tenant_id, app_id=task.app_id, task_id=task.task_id)
    assert result is not None
    assert result.storage_key == "owned.csv"


def test_ready_export_extends_task_and_latest_expiration(application_redis: RedisClientWrapper) -> None:
    """Publish the seven-day download window at completion and keep the latest pointer for that window."""
    store = RedisLogExportTasks(
        redis=application_redis, task_type=LogExportTask[str], key_prefix="conversation_log_export"
    )
    task = LogExportTask[str].pending(tenant_id="tenant", app_id="app", requested_by="admin", filters="all")
    store.save(task)
    claim = store.claim(task)
    assert claim is not None
    assert claim.expires_at == task.expires_at

    before_finish = utc_now()
    assert store.finish(claim, status=LogExportStatus.READY, storage_key="logs.csv")
    after_finish = utc_now()
    ready = store.get_latest(tenant_id="tenant", app_id="app", requested_by="admin")
    assert ready is not None
    assert ready.status is LogExportStatus.READY
    assert before_finish + timedelta(days=7) <= ready.expires_at <= after_finish + timedelta(days=7)

    task_key = f"conversation_log_export:{{tenant}}:app:{task.task_id}"
    latest_key = "conversation_log_export_latest:{tenant}:app:admin"
    get_expiration_times = application_redis.register_script(
        """
        local clock = redis.call('TIME')
        local now = tonumber(clock[1]) * 1000 + math.floor(tonumber(clock[2]) / 1000)
        return {now + redis.call('PTTL', KEYS[1]), now + redis.call('PTTL', KEYS[2])}
        """
    )
    task_expiration, latest_expiration = get_expiration_times(keys=[task_key, latest_key])
    assert task_expiration == latest_expiration
    assert abs(task_expiration - int(ready.expires_at.timestamp() * 1000)) <= 50
    assert not store.finish(claim, status=LogExportStatus.READY, storage_key="logs.csv")
    assert not store.finish(ready, status=LogExportStatus.READY, storage_key="logs.csv")
    assert store.get(tenant_id="tenant", app_id="app", task_id=task.task_id) == ready
    store.save(LogExportTask[str].pending(tenant_id="tenant", app_id="app", requested_by="admin", filters="all"))


@pytest.mark.parametrize("latest_id", ["newer-task", None])
def test_ready_export_preserves_other_latest_state(
    application_redis: RedisClientWrapper, latest_id: str | None
) -> None:
    """Finish an owned export without replacing or extending the latest pointer for another task."""
    store = RedisLogExportTasks(
        redis=application_redis, task_type=LogExportTask[str], key_prefix="conversation_log_export"
    )
    task = LogExportTask[str].pending(tenant_id="tenant", app_id="app", requested_by="admin", filters="all")
    store.save(task)
    claim = store.claim(task)
    assert claim is not None
    latest_key = "conversation_log_export_latest:{tenant}:app:admin"
    if latest_id is None:
        application_redis.delete(latest_key)
    else:
        application_redis.set(latest_key, latest_id, ex=60)
    previous_value = application_redis.get(latest_key)
    previous_ttl = application_redis.pttl(latest_key)

    assert store.finish(claim, status=LogExportStatus.READY, storage_key="logs.csv")

    assert application_redis.get(latest_key) == previous_value
    assert application_redis.pttl(latest_key) <= previous_ttl


def test_failed_export_preserves_task_and_latest_expiration(application_redis: RedisClientWrapper) -> None:
    """Release the worker lease without extending task or latest retention after failure."""
    store = RedisLogExportTasks(
        redis=application_redis, task_type=LogExportTask[str], key_prefix="conversation_log_export"
    )
    task = LogExportTask[str].pending(tenant_id="tenant", app_id="app", requested_by="admin", filters="all")
    store.save(task)
    claim = store.claim(task)
    assert claim is not None
    task_key = f"conversation_log_export:{{tenant}}:app:{task.task_id}"
    latest_key = "conversation_log_export_latest:{tenant}:app:admin"
    task_ttl, latest_ttl = application_redis.pttl(task_key), application_redis.pttl(latest_key)

    assert store.finish(claim, status=LogExportStatus.FAILED)

    failed = store.get_latest(tenant_id="tenant", app_id="app", requested_by="admin")
    assert failed is not None
    assert failed.status is LogExportStatus.FAILED
    assert failed.expires_at == task.expires_at
    assert 0 < application_redis.pttl(task_key) <= task_ttl
    assert 0 < application_redis.pttl(latest_key) <= latest_ttl


def test_progress_advances_only_for_the_owned_attempt(application_redis: RedisClientWrapper) -> None:
    """Fence progress writes, preserve task expiry and reset progress on reclaim."""
    store = RedisLogExportTasks(
        redis=application_redis, task_type=LogExportTask[tuple[str, ...]], key_prefix="conversation_log_export"
    )
    task = LogExportTask[tuple[str, ...]].pending(tenant_id="tenant", app_id="app", requested_by="admin", filters=())
    task_key = f"conversation_log_export:{{tenant}}:app:{task.task_id}"
    store.save(task)
    ttl = application_redis.ttl(task_key)
    first = store.claim(task)
    assert first is not None
    assert first.progress == LogExportProgress(stage=LogExportStage.PREPARING, rows_written=0)

    writing = LogExportProgress(stage=LogExportStage.WRITING, rows_written=100)
    assert store.renew(first, progress=writing)
    assert store.renew(first, progress=writing)
    assert store.renew(first, progress=LogExportProgress(stage=LogExportStage.WRITING, rows_written=50))
    current = store.get(tenant_id=task.tenant_id, app_id=task.app_id, task_id=task.task_id)
    assert current is not None
    assert current.filters == ()
    assert current.progress == writing

    uploading = LogExportProgress(stage=LogExportStage.UPLOADING, rows_written=100)
    assert store.renew(first, progress=uploading)
    assert store.renew(first, progress=writing)
    foreign_claim = first.model_copy(update={"claim_token": "wrong-token"})
    assert not store.renew(foreign_claim, progress=writing)
    current = store.get(tenant_id=task.tenant_id, app_id=task.app_id, task_id=task.task_id)
    assert current is not None
    assert current.progress == uploading
    assert 0 < application_redis.ttl(task_key) <= ttl

    application_redis.expire(f"{task_key}:lease", 0)
    second = store.claim(current)
    assert second is not None
    assert second.attempt == 2
    assert not store.renew(first, progress=uploading)
    current = store.get(tenant_id=task.tenant_id, app_id=task.app_id, task_id=task.task_id)
    assert current is not None
    assert current.progress == LogExportProgress(stage=LogExportStage.PREPARING, rows_written=0)


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
