import logging
from collections.abc import Iterator
from dataclasses import dataclass, field
from datetime import timedelta

import pytest
from celery.contrib.testing.app import setup_default_app

from dify_app import DifyApp
from extensions import ext_celery
from extensions.ext_celery import FILE_TRANSFER_CLEAN_INTERVAL, FILE_TRANSFER_SWEEP_INTERVAL
from schedule import clean_file_transfers_task as task_module
from schedule.clean_file_transfers_task import (
    DELETE_WORKERS,
    PURGE_BATCH,
    clean_file_transfers_task,
    sweep_file_transfers_task,
)
from services.file_transfer import PurgeResult
from tests.helpers.unit.config_override import config_overrides_context

_TASK_NAME = "schedule.clean_file_transfers_task.clean_file_transfers_task"
_SWEEP_TASK_NAME = "schedule.clean_file_transfers_task.sweep_file_transfers_task"


@pytest.fixture(autouse=True)
def restore_celery_app_state() -> Iterator[None]:
    with setup_default_app(clean_file_transfers_task.app):
        yield


@dataclass
class _FileTransfers:
    results: list[PurgeResult]
    orphans: int = 0
    calls: list[tuple[str, int, int]] = field(default_factory=list)

    def purge_expired(self, *, limit: int, workers: int) -> PurgeResult:
        self.calls.append(("purge", limit, workers))
        return self.results.pop(0)

    def sweep_orphans(self, *, workers: int) -> int:
        self.calls.append(("sweep", 0, workers))
        return self.orphans


def _removed(count: int, overdue_seconds: int = 0) -> PurgeResult:
    return PurgeResult(removed=count, longest_overdue=timedelta(seconds=overdue_seconds))


@dataclass
class _Services:
    file_transfers: _FileTransfers


def test_the_task_drains_in_batches_until_a_short_batch_and_logs_how_far_behind_it_was(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    transfers = _FileTransfers(results=[_removed(PURGE_BATCH, 700), _removed(PURGE_BATCH, 90), _removed(3)])
    monkeypatch.setattr(task_module, "application_services", lambda: _Services(file_transfers=transfers))

    with caplog.at_level(logging.INFO, logger=task_module.__name__):
        clean_file_transfers_task.run()

    assert transfers.calls == [("purge", PURGE_BATCH, DELETE_WORKERS)] * 3
    assert transfers.results == []
    [record] = caplog.records
    assert (record.__dict__["removed"], record.__dict__["longest_overdue_seconds"]) == (2 * PURGE_BATCH + 3, 700)


def test_the_sweep_task_deletes_orphans_and_logs_how_many(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    transfers = _FileTransfers(results=[], orphans=4)
    monkeypatch.setattr(task_module, "application_services", lambda: _Services(file_transfers=transfers))

    with caplog.at_level(logging.INFO, logger=task_module.__name__):
        sweep_file_transfers_task.run()

    assert transfers.calls == [("sweep", 0, DELETE_WORKERS)]
    [record] = caplog.records
    assert record.__dict__["deleted"] == 4


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
            sweep = celery.conf.beat_schedule.get("sweep_file_transfers_task")
            if scheduled:
                assert schedule == {"task": _TASK_NAME, "schedule": FILE_TRANSFER_CLEAN_INTERVAL}
                assert sweep == {"task": _SWEEP_TASK_NAME, "schedule": FILE_TRANSFER_SWEEP_INTERVAL}
                assert celery.tasks[_TASK_NAME].queue == "retention"
                assert celery.tasks[_SWEEP_TASK_NAME].queue == "retention"
            else:
                assert (schedule, sweep) == (None, None)
        finally:
            celery.close()
