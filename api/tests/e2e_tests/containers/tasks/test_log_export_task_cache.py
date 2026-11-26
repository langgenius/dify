"""Exercise export admission and worker recovery against a real Redis server."""

from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta

import pytest

from extensions.ext_redis import RedisClientWrapper
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
from services.retention.log_export_task_cache import (
    _CLAIM_LOG_EXPORT_TASK,
    _SAVE_LOG_EXPORT_TASK,
    RedisLogExportTasks,
    reserve_log_export_dispatch,
)


def test_replayed_save_preserves_the_admitted_task(application_redis: RedisClientWrapper) -> None:
    """A retry after a lost response acknowledges the same task."""
    task = LogExportTask[str].pending(tenant_id="tenant", app_id="app", requested_by="admin", filters="all")
    task_key = f"conversation_log_export:{{tenant}}:app:{task.task_id}"
    keys = [
        task_key,
        "conversation_log_export_latest:{tenant}:app:admin",
        "log_export_active:{tenant}",
        "log_export_queue:{tenant}",
    ]
    args = ["app:admin", task.model_dump_json(), task.task_id, f"{task_key}:admin"]
    save = application_redis.register_script(_SAVE_LOG_EXPORT_TASK)

    assert save(keys=keys, args=args) == 1
    assert save(keys=keys, args=args) == 1
    read_queue = application_redis.register_script("return redis.call('LRANGE', KEYS[1], 0, -1)")
    assert read_queue(keys=[keys[3]]) == [f"{task_key}:admin".encode()]


def test_replayed_claim_recognizes_only_its_own_token(application_redis: RedisClientWrapper) -> None:
    """Only the command that acquired the lease can replay its claim."""
    store = RedisLogExportTasks(
        redis=application_redis, task_type=LogExportTask[str], key_prefix="conversation_log_export"
    )
    task = LogExportTask[str].pending(tenant_id="tenant", app_id="app", requested_by="admin", filters="all")
    store.save(task)
    task_key = f"conversation_log_export:{{tenant}}:app:{task.task_id}"
    keys = [
        task_key,
        f"{task_key}:lease",
        "log_export_active:{tenant}",
        "log_export_queue:{tenant}",
        "conversation_log_export_latest:{tenant}:app:admin",
        f"{task_key}:email",
    ]
    processing = task.model_copy(update={"status": LogExportStatus.PROCESSING, "attempt": 1})
    args = [
        task.status.value,
        task.attempt,
        processing.model_dump_json(),
        3,
        120,
        "app:admin",
        "first-token",
        f"{task_key}:admin",
        "queued",
        0,
    ]
    claim = application_redis.register_script(_CLAIM_LOG_EXPORT_TASK)

    assert claim(keys=keys, args=args) == 1
    assert claim(keys=keys, args=args) == 1
    assert claim(keys=keys, args=[*args[:6], "other-token", *args[7:]]) == -1
    assert store.get(tenant_id="tenant", app_id="app", task_id=task.task_id) == processing

    application_redis.expire(keys[1], 0)
    assert claim(keys=keys, args=args) == -1


def test_export_admission_deduplicates_without_capping_the_workspace(application_redis: RedisClientWrapper) -> None:
    """Admit one submission per app and requester, with no quota on distinct submissions."""
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
    assert conversation.get_latest(tenant_id="tenant", app_id="app", requested_by="admin") == active

    for app_id in ("workflow-1", "workflow-2", "workflow-3", "workflow-4"):
        task = LogExportTask[str].pending(tenant_id="tenant", app_id=app_id, requested_by="admin", filters="all")
        workflow.save(task)
        assert workflow.get_latest(tenant_id="tenant", app_id=app_id, requested_by="admin") == task
        assert task.expires_at is None
        assert application_redis.pttl(f"workflow_log_export:{{tenant}}:{app_id}:{task.task_id}") == -1
        assert application_redis.pttl(f"workflow_log_export_latest:{{tenant}}:{app_id}:admin") == -1


def test_exports_run_in_workspace_order_across_app_types(application_redis: RedisClientWrapper) -> None:
    """Run the head task only, while allowing another workspace to run in parallel."""
    conversation = RedisLogExportTasks(
        redis=application_redis, task_type=LogExportTask[str], key_prefix="conversation_log_export"
    )
    workflow = RedisLogExportTasks(
        redis=application_redis, task_type=LogExportTask[str], key_prefix="workflow_log_export"
    )
    first = LogExportTask[str].pending(tenant_id="tenant", app_id="app", requested_by="admin", filters="all")
    second = LogExportTask[str].pending(tenant_id="tenant", app_id="workflow", requested_by="owner", filters="all")
    third = LogExportTask[str].pending(tenant_id="tenant", app_id="other", requested_by="admin", filters="all")
    independent = LogExportTask[str].pending(tenant_id="other", app_id="app", requested_by="admin", filters="all")
    conversation.save(first)
    workflow.save(second)
    conversation.save(third)
    conversation.save(independent)

    assert reserve_log_export_dispatch(application_redis, "tenant") == (
        LogExportKind.CONVERSATION,
        "app",
        first.task_id,
    )
    assert reserve_log_export_dispatch(application_redis, "tenant") is None
    assert workflow.claim(second) is None
    first_attempt = conversation.claim(first)
    assert first_attempt is not None
    assert conversation.claim(independent) is not None
    assert workflow.claim(second) is None
    assert conversation.claim(third) is None
    assert workflow.get_latest(tenant_id="tenant", app_id="workflow", requested_by="owner") == second

    assert conversation.finish(first_attempt, status=LogExportStatus.READY, storage_key="first.csv")
    assert reserve_log_export_dispatch(application_redis, "tenant") == (
        LogExportKind.WORKFLOW,
        "workflow",
        second.task_id,
    )
    assert conversation.claim(third) is None
    second_attempt = workflow.claim(second)
    assert second_attempt is not None
    assert second_attempt.attempt == 1
    assert workflow.finish(second_attempt, status=LogExportStatus.FAILED)
    assert conversation.claim(third) is not None


def test_unpublished_head_can_be_dispatched_after_its_reservation_expires(
    application_redis: RedisClientWrapper,
) -> None:
    """Recover a task whose publish was lost, then leave it alone while a worker owns its lease."""
    store = RedisLogExportTasks(
        redis=application_redis, task_type=LogExportTask[str], key_prefix="conversation_log_export"
    )
    task = LogExportTask[str].pending(tenant_id="tenant", app_id="app", requested_by="admin", filters="all")
    store.save(task)
    target = (LogExportKind.CONVERSATION, "app", task.task_id)
    assert reserve_log_export_dispatch(application_redis, "tenant") == target
    assert reserve_log_export_dispatch(application_redis, "tenant") is None

    dispatch_lease = f"conversation_log_export:{{tenant}}:app:{task.task_id}:dispatch"
    application_redis.expire(dispatch_lease, 0)
    assert reserve_log_export_dispatch(application_redis, "tenant") == target
    assert store.claim(task) is not None
    application_redis.expire(dispatch_lease, 0)
    assert reserve_log_export_dispatch(application_redis, "tenant") is None


def test_existing_exports_drain_before_new_queue_dispatch(application_redis: RedisClientWrapper) -> None:
    """Finish a pre-queue submission before dispatching the first new workspace job."""
    store = RedisLogExportTasks(
        redis=application_redis, task_type=LogExportTask[str], key_prefix="conversation_log_export"
    )
    legacy = LogExportTask[str].pending(tenant_id="tenant", app_id="legacy", requested_by="admin", filters="all")
    expires_at = utc_now() + timedelta(days=1)
    legacy = legacy.model_copy(update={"expires_at": expires_at})
    save_legacy = application_redis.register_script(
        """
        redis.call('SET', KEYS[1], ARGV[1], 'PXAT', ARGV[2])
        redis.call('ZADD', KEYS[2], ARGV[2], 'legacy:admin')
        redis.call('PEXPIREAT', KEYS[2], ARGV[2])
        """
    )
    save_legacy(
        keys=[f"conversation_log_export:{{tenant}}:legacy:{legacy.task_id}", "log_export_active:{tenant}"],
        args=[legacy.model_dump_json(), int(expires_at.timestamp() * 1000)],
    )
    queued = LogExportTask[str].pending(tenant_id="tenant", app_id="app", requested_by="admin", filters="all")
    store.save(queued)
    assert reserve_log_export_dispatch(application_redis, "tenant") is None

    attempt = store.claim(legacy)
    assert attempt is not None
    assert store.finish(attempt, status=LogExportStatus.READY, storage_key="legacy.csv")
    assert reserve_log_export_dispatch(application_redis, "tenant") == (
        LogExportKind.CONVERSATION,
        "app",
        queued.task_id,
    )


def test_cancel_removes_only_waiting_exports_and_releases_their_position(application_redis: RedisClientWrapper) -> None:
    """Remove a queued task atomically and reject a cancellation after a worker has claimed it."""
    store = RedisLogExportTasks(
        redis=application_redis, task_type=LogExportTask[str], key_prefix="conversation_log_export"
    )
    head = LogExportTask[str].pending(tenant_id="tenant", app_id="head", requested_by="admin", filters="all")
    waiting = LogExportTask[str].pending(tenant_id="tenant", app_id="waiting", requested_by="admin", filters="all")
    last = LogExportTask[str].pending(tenant_id="tenant", app_id="last", requested_by="admin", filters="all")
    assert store.save(head)
    assert not store.save(waiting)
    assert not store.save(last)

    canceled = store.cancel(waiting)
    assert canceled.status is LogExportStatus.CANCELED
    assert canceled.expires_at is not None
    assert store.cancel(waiting) == canceled
    assert store.claim(waiting) is None
    assert store.get_latest(tenant_id="tenant", app_id="waiting", requested_by="admin") == canceled

    replacement = LogExportTask[str].pending(tenant_id="tenant", app_id="waiting", requested_by="admin", filters="all")
    assert not store.save(replacement)
    assert store.cancel(waiting) == canceled
    assert store.get_latest(tenant_id="tenant", app_id="waiting", requested_by="admin") == replacement

    assert store.cancel(head).status is LogExportStatus.CANCELED
    claimed = store.claim(last)
    assert claimed is not None
    with pytest.raises(LogExportTaskNotCancelableError):
        store.cancel(last)
    assert store.claim(replacement) is None

    assert store.finish(claimed, status=LogExportStatus.FAILED)
    assert store.claim(replacement) is not None


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
    assert ready.expires_at is not None
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


def test_failed_export_sets_task_and_latest_expiration(application_redis: RedisClientWrapper) -> None:
    """Start one day of terminal retention on failure and release the worker lease."""
    store = RedisLogExportTasks(
        redis=application_redis, task_type=LogExportTask[str], key_prefix="conversation_log_export"
    )
    task = LogExportTask[str].pending(tenant_id="tenant", app_id="app", requested_by="admin", filters="all")
    store.save(task)
    claim = store.claim(task)
    assert claim is not None
    task_key = f"conversation_log_export:{{tenant}}:app:{task.task_id}"
    latest_key = "conversation_log_export_latest:{tenant}:app:admin"
    assert application_redis.pttl(task_key) == -1
    assert application_redis.pttl(latest_key) == -1

    before_finish = utc_now()
    assert store.finish(claim, status=LogExportStatus.FAILED)
    after_finish = utc_now()

    failed = store.get_latest(tenant_id="tenant", app_id="app", requested_by="admin")
    assert failed is not None
    assert failed.status is LogExportStatus.FAILED
    assert failed.expires_at is not None
    assert before_finish + timedelta(days=1) <= failed.expires_at <= after_finish + timedelta(days=1)
    assert 0 < application_redis.pttl(task_key) <= 86_400_000
    assert 0 < application_redis.pttl(latest_key) <= 86_400_000


def test_progress_advances_only_for_the_owned_attempt(application_redis: RedisClientWrapper) -> None:
    """Fence progress writes, preserve the active task, and reset progress on reclaim."""
    store = RedisLogExportTasks(
        redis=application_redis, task_type=LogExportTask[tuple[str, ...]], key_prefix="conversation_log_export"
    )
    task = LogExportTask[tuple[str, ...]].pending(tenant_id="tenant", app_id="app", requested_by="admin", filters=())
    task_key = f"conversation_log_export:{{tenant}}:app:{task.task_id}"
    store.save(task)
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
    assert application_redis.ttl(task_key) == -1

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
    next_task = LogExportTask[str].pending(tenant_id="tenant", app_id="next", requested_by="admin", filters="all")
    store.save(next_task)
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
    assert store.claim(next_task) is not None
    store.save(LogExportTask[str].pending(tenant_id="tenant", app_id="app", requested_by="admin", filters="all"))
