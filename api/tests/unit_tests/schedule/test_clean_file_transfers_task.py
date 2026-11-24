from collections.abc import Iterator
from dataclasses import dataclass, field

import pytest
from celery.contrib.testing.app import setup_default_app

from dify_app import DifyApp
from extensions import ext_celery
from extensions.ext_celery import FILE_TRANSFER_CLEAN_INTERVAL
from schedule import clean_file_transfers_task as task_module
from schedule.clean_file_transfers_task import PURGE_BATCH, clean_file_transfers_task
from tests.helpers.unit.config_override import config_overrides_context

_TASK_NAME = "schedule.clean_file_transfers_task.clean_file_transfers_task"


@pytest.fixture(autouse=True)
def restore_celery_app_state() -> Iterator[None]:
    with setup_default_app(clean_file_transfers_task.app):
        yield


@dataclass
class _FileTransfers:
    removed_per_call: list[int]
    limits_seen: list[int] = field(default_factory=list)

    def purge_expired(self, *, limit: int) -> int:
        self.limits_seen.append(limit)
        return self.removed_per_call.pop(0)


@dataclass
class _Services:
    file_transfers: _FileTransfers


def test_the_task_drains_in_batches_until_a_short_batch(monkeypatch: pytest.MonkeyPatch) -> None:
    transfers = _FileTransfers(removed_per_call=[PURGE_BATCH, PURGE_BATCH, 3])
    monkeypatch.setattr(task_module, "application_services", lambda: _Services(file_transfers=transfers))

    clean_file_transfers_task.run()

    assert transfers.limits_seen == [PURGE_BATCH] * 3
    assert transfers.removed_per_call == []


@pytest.mark.parametrize(
    ("mcp", "transfers", "scheduled"),
    [(True, True, True), (True, False, False), (False, True, False), (False, False, False)],
    ids=["both on", "transfers off", "mcp off, transfers on", "both off"],
)
def test_the_task_is_scheduled_only_while_file_transfers_are_on(
    mcp: bool, transfers: bool, scheduled: bool, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(ext_celery, "setup_workflow_warm_shutdown_handler", lambda: None)
    with config_overrides_context(OPENAPI_MCP_ENABLED=mcp, FILE_TRANSFER_ENABLED=transfers, DISABLE_TELEMETRY=True):
        celery = ext_celery.init_app(DifyApp(__name__))
        try:
            schedule = celery.conf.beat_schedule.get("clean_file_transfers_task")
            if scheduled:
                assert schedule == {"task": _TASK_NAME, "schedule": FILE_TRANSFER_CLEAN_INTERVAL}
                assert celery.tasks[_TASK_NAME].queue == "retention"
            else:
                assert schedule is None
        finally:
            celery.close()
