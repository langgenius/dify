from threading import Event
from typing import TextIO
from unittest.mock import call, create_autospec

import pytest
from redis.exceptions import (
    AuthenticationError,
    AuthorizationError,
    ClusterDownError,
    ConnectionError,
    DataError,
    ReadOnlyError,
    RedisError,
    ResponseError,
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


def test_heartbeat_renews_after_a_transient_redis_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    """Keep renewing after a Redis connection failure and stop when the lease is gone."""
    stopped = create_autospec(Event, instance=True)
    stopped.wait.side_effect = [False, False, False, True]
    monkeypatch.setattr(log_export_task, "Event", lambda: stopped)
    task = LogExportTask[str].pending(tenant_id="tenant", app_id="app", requested_by="owner", filters="all")
    store = create_autospec(LogExportTaskStore, instance=True)
    store.renew.side_effect = [ConnectionError("temporarily unavailable"), True, False]

    with log_export_task._renew_export_lease(task, store):
        pass

    assert store.renew.call_args_list == [call(task), call(task), call(task)]
    assert stopped.wait.call_count == 3


@pytest.mark.parametrize(
    ("redis_error_type", "retryable"),
    [
        (ConnectionError, True),
        (TimeoutError, True),
        (ClusterDownError, True),
        (ReadOnlyError, True),
        (TryAgainError, True),
        (ResponseError, False),
        (DataError, False),
        (AuthenticationError, False),
        (AuthorizationError, False),
    ],
)
def test_final_renewal_error_respects_retry_policy(
    redis_error_type: type[RedisError],
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

    def write_csv(_context: RequestContext, _app_id: str, /, *, filters: str, output: TextIO) -> int:
        output.write(f"query\n{filters}\n")
        return 1

    expected_error = LogExportLeaseBusyError if retryable else redis_error_type
    with pytest.raises(expected_error) as failure:
        log_export_task.prepare_log_export_task(
            task, tasks=tasks, storage_prefix="exports", store_csv=store_log_export_csv, write_csv=write_csv
        )

    assert (failure.value.__cause__ if retryable else failure.value) is renewal_error
    assert log_export_redis.renew_calls == 1
    log_export_storage.save_from_path.assert_not_called()
    current = tasks.get(tenant_id=task.tenant_id, app_id=task.app_id, task_id=task.task_id)
    assert current is not None
    expected_status = LogExportStatus.PROCESSING if retryable else LogExportStatus.FAILED
    assert current.status is expected_status
    assert current.storage_key is None
