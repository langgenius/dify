from threading import Event
from typing import TextIO
from unittest.mock import call, create_autospec

import pytest
from redis.exceptions import (
    AuthenticationError,
    AuthorizationError,
    ClusterDownError,
    ClusterError,
    ConnectionError,
    DataError,
    NoPermissionError,
    ReadOnlyError,
    ResponseError,
    SlotNotCoveredError,
    TimeoutError,
    TryAgainError,
)

from machinery.context import RequestContext
from services.retention import log_export_task
from services.retention.log_export_adapters import store_log_export_csv
from services.retention.log_export_task import (
    LogExportLeaseBusyError,
    LogExportStatus,
    LogExportTask,
    LogExportTaskStore,
)
from services.retention.log_export_task_cache import RedisLogExportTasks
from tests.helpers.unit.log_export_fixtures import LogExportRedisIo, LogExportStorageIo


def _write_csv(_context: RequestContext, _app_id: str, /, *, filters: str, output: TextIO) -> int:
    output.write(f"query\n{filters}\n")
    return 1


@pytest.mark.parametrize(("error_type", "renew_calls"), [(LogExportLeaseBusyError, 3), (ResponseError, 1)])
def test_heartbeat_only_retries_transient_failures(
    error_type: type[Exception], renew_calls: int, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Renew again after a temporary failure and stop on lease loss or a permanent error."""
    stopped = create_autospec(Event, instance=True)
    stopped.wait.side_effect = [False, False, False, True]
    monkeypatch.setattr(log_export_task, "Event", lambda: stopped)
    task = LogExportTask[str].pending(tenant_id="tenant", app_id="app", requested_by="owner", filters="all")
    store = create_autospec(LogExportTaskStore, instance=True)
    store.renew.side_effect = [error_type("lease renewal failed"), True, False]

    with log_export_task._renew_export_lease(task, store):
        pass

    assert store.renew.call_args_list == [call(task)] * renew_calls
    assert stopped.wait.call_count == renew_calls


@pytest.mark.parametrize(
    ("redis_error_type", "retryable"),
    [
        (ConnectionError, True),
        (TimeoutError, True),
        (ClusterDownError, True),
        (ClusterError, True),
        (SlotNotCoveredError, True),
        (OSError, True),
        (BrokenPipeError, True),
        (ReadOnlyError, True),
        (TryAgainError, True),
        (ResponseError, False),
        (DataError, False),
        (AuthenticationError, False),
        (AuthorizationError, False),
        (NoPermissionError, False),
    ],
)
def test_final_renewal_error_respects_retry_policy(
    redis_error_type: type[Exception],
    retryable: bool,
    log_export_redis: LogExportRedisIo,
    log_export_storage: LogExportStorageIo,
) -> None:
    """Keep temporary failures reclaimable and preserve permanent Redis errors."""
    tasks = RedisLogExportTasks(
        redis=log_export_redis.client, task_type=LogExportTask[str], key_prefix="conversation_log_export"
    )
    task = LogExportTask[str].pending(tenant_id="tenant", app_id="app", requested_by="owner", filters="all")
    tasks.save(task)
    renewal_error = redis_error_type("lease renewal failed")
    log_export_redis.renew_error = renewal_error

    expected_error = LogExportLeaseBusyError if retryable else redis_error_type
    with pytest.raises(expected_error) as failure:
        log_export_task.prepare_log_export_task(
            task, tasks=tasks, storage_prefix="exports", store_csv=store_log_export_csv, write_csv=_write_csv
        )

    assert (failure.value.__cause__ if retryable else failure.value) is renewal_error
    assert log_export_redis.renew_calls == 1
    log_export_storage.save_from_path.assert_not_called()
    current = tasks.get(tenant_id=task.tenant_id, app_id=task.app_id, task_id=task.task_id)
    assert current is not None
    expected_status = LogExportStatus.PROCESSING if retryable else LogExportStatus.FAILED
    assert current.status is expected_status
    assert current.storage_key is None


def test_failure_recording_error_preserves_permanent_renewal_error(
    log_export_redis: LogExportRedisIo, log_export_storage: LogExportStorageIo
) -> None:
    """Keep the renewal error when Redis also refuses to record the failure."""
    tasks = RedisLogExportTasks(
        redis=log_export_redis.client, task_type=LogExportTask[str], key_prefix="conversation_log_export"
    )
    task = LogExportTask[str].pending(tenant_id="tenant", app_id="app", requested_by="owner", filters="all")
    tasks.save(task)
    renewal_error = AuthenticationError("renew authentication failed")
    log_export_redis.renew_error = renewal_error
    log_export_redis.finish_error = AuthenticationError("finish authentication failed")

    with pytest.raises(AuthenticationError) as failure:
        log_export_task.prepare_log_export_task(
            task, tasks=tasks, storage_prefix="exports", store_csv=store_log_export_csv, write_csv=_write_csv
        )

    assert failure.value is renewal_error
    log_export_storage.save_from_path.assert_not_called()


def test_storage_failure_retries_when_recording_failed_hits_transient_redis_error(
    log_export_redis: LogExportRedisIo, log_export_storage: LogExportStorageIo
) -> None:
    """Surface the retryable state write error after an upload failure."""
    tasks = RedisLogExportTasks(
        redis=log_export_redis.client, task_type=LogExportTask[str], key_prefix="conversation_log_export"
    )
    task = LogExportTask[str].pending(tenant_id="tenant", app_id="app", requested_by="owner", filters="all")
    tasks.save(task)
    log_export_storage.save_from_path.side_effect = OSError("CSV upload failed")
    finish_error = ConnectionError("Redis temporarily unavailable")
    log_export_redis.finish_error = finish_error

    with pytest.raises(LogExportLeaseBusyError) as retry:
        log_export_task.prepare_log_export_task(
            task, tasks=tasks, storage_prefix="exports", store_csv=store_log_export_csv, write_csv=_write_csv
        )

    log_export_storage.save_from_path.assert_called_once()
    assert retry.value.__cause__ is finish_error
    current = tasks.get(tenant_id=task.tenant_id, app_id=task.app_id, task_id=task.task_id)
    assert current is not None
    assert current.status is LogExportStatus.PROCESSING
    assert current.storage_key is None


def test_dispatch_failure_preserves_publish_error_when_recording_failed_also_raises(
    log_export_redis: LogExportRedisIo, caplog: pytest.LogCaptureFixture
) -> None:
    """Keep the broker error visible when Redis also fails during dispatch cleanup."""
    tasks = RedisLogExportTasks(
        redis=log_export_redis.client, task_type=LogExportTask[str], key_prefix="conversation_log_export"
    )
    task = LogExportTask[str].pending(tenant_id="tenant", app_id="app", requested_by="owner", filters="all")
    dispatch_error = RuntimeError("Broker unavailable")
    log_export_redis.finish_error = ConnectionError("Redis temporarily unavailable")

    def dispatch(_task: LogExportTask[str]) -> None:
        raise dispatch_error

    with pytest.raises(RuntimeError) as failure:
        log_export_task.save_and_dispatch_log_export_task(task, tasks=tasks, dispatch=dispatch)

    assert failure.value is dispatch_error
    assert "Redis temporarily unavailable" in caplog.text
