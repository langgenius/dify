from threading import Event
from unittest.mock import Mock, call

import pytest
from redis.exceptions import ConnectionError

from services.retention import log_export_task
from services.retention.log_export_task import LogExportTask, LogExportTaskStore


def test_heartbeat_renews_after_a_transient_redis_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    """Keep renewing after a Redis connection failure and stop when the lease is gone."""
    stopped = Mock(spec=Event)
    stopped.wait.side_effect = [False, False, False, True]
    monkeypatch.setattr(log_export_task, "Event", lambda: stopped)
    task = LogExportTask[str].pending(tenant_id="tenant", app_id="app", requested_by="owner", filters="all")
    store = Mock(spec=LogExportTaskStore)
    store.renew.side_effect = [ConnectionError("temporarily unavailable"), True, False]

    with log_export_task._renew_export_lease(task, store):
        pass

    assert store.renew.call_args_list == [call(task), call(task), call(task)]
    assert stopped.wait.call_count == 3
