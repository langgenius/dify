import datetime
import time
from collections.abc import Generator
from typing import cast, override

import pytest

from extensions.logstore.aliyun_logstore import AliyunLogStore
from extensions.logstore.repositories.logstore_api_workflow_run_repository import (
    LogstoreAPIWorkflowRunRepository,
    _dict_to_workflow_run,
)
from graphon.enums import WorkflowExecutionStatus
from models.enums import WorkflowRunTriggeredFrom
from repositories.api_workflow_run_repository import AppWorkflowRunStats

_START = datetime.datetime(2026, 8, 18, 2, 0, 0, tzinfo=datetime.UTC)
_FINISH = _START + datetime.timedelta(seconds=30)
_EXPECTED_CREATED_AT = _START.replace(tzinfo=None)
_EXPECTED_FINISHED_AT = _FINISH.replace(tzinfo=None)

_BASE: dict[str, object] = {"id": "run-1", "tenant_id": "tenant-1", "app_id": "app-1", "workflow_id": "workflow-1"}


@pytest.fixture
def non_utc_host_timezone(monkeypatch: pytest.MonkeyPatch) -> Generator[None]:
    """Run the host clock in UTC+05:30 so local-time conversions become observable."""
    monkeypatch.setenv("TZ", "Asia/Kolkata")
    time.tzset()
    yield
    monkeypatch.undo()
    time.tzset()


@pytest.mark.parametrize(
    ("case", "payload"),
    [
        ("both epoch", {"started_at": _START.timestamp(), "finished_at": _FINISH.timestamp()}),
        ("aware iso and epoch", {"started_at": _START.isoformat(), "finished_at": _FINISH.timestamp()}),
        (
            "naive iso and epoch",
            {"started_at": _START.replace(tzinfo=None).isoformat(), "finished_at": _FINISH.timestamp()},
        ),
        ("both datetime", {"started_at": _START, "finished_at": _FINISH}),
    ],
)
@pytest.mark.usefixtures("non_utc_host_timezone")
def test_dict_to_workflow_run_normalizes_timestamps_to_naive_utc(case: str, payload: dict[str, object]) -> None:
    model = _dict_to_workflow_run({**_BASE, **payload})

    assert model.created_at == _EXPECTED_CREATED_AT, case
    assert model.finished_at == _EXPECTED_FINISHED_AT, case
    assert model.elapsed_time == 30.0, case


@pytest.mark.usefixtures("non_utc_host_timezone")
def test_dict_to_workflow_run_defaults_missing_started_at_to_naive_utc_now() -> None:
    model = _dict_to_workflow_run({**_BASE, "finished_at": _FINISH.timestamp()})

    assert model.created_at.tzinfo is None
    # A naive local-time default would sit 5h30m ahead of UTC and drive elapsed_time negative.
    assert abs((model.created_at - datetime.datetime.now(tz=datetime.UTC).replace(tzinfo=None)).total_seconds()) < 60


class _FakeLogStore:
    def __init__(self, rows: list[dict[str, object]]) -> None:
        self.rows = rows
        self.sql: list[str] = []

    def execute_sql(self, sql: str, logstore: str | None = None, **_options: object) -> list[dict[str, object]]:
        assert logstore == AliyunLogStore.workflow_execution_logstore
        self.sql.append(sql)
        return self.rows


def _repository(rows: list[dict[str, object]]) -> tuple[LogstoreAPIWorkflowRunRepository, _FakeLogStore]:
    repository = LogstoreAPIWorkflowRunRepository.__new__(LogstoreAPIWorkflowRunRepository)
    client = _FakeLogStore(rows)
    repository.logstore_client = cast(AliyunLogStore, client)
    return repository, client


_APPS = {"app-1": "tenant-1", "app-'2": "tenant-1"}
_SOURCES = [WorkflowRunTriggeredFrom.APP_RUN, WorkflowRunTriggeredFrom.WEBHOOK]


class _RoutingLogStore(_FakeLogStore):
    """Answer the windowed count query and the newest-start query with separate rows."""

    def __init__(self, counts: list[dict[str, object]], last: list[dict[str, object]]) -> None:
        super().__init__([])
        self.counts = counts
        self.last = last

    @override
    def execute_sql(self, sql: str, logstore: str | None = None, **_options: object) -> list[dict[str, object]]:
        super().execute_sql(sql, logstore)
        return self.last if "MAX(started_at)" in sql else self.counts


def test_stats_by_app_ids_dedupes_versions_and_keeps_each_apps_tenant() -> None:
    repository = LogstoreAPIWorkflowRunRepository.__new__(LogstoreAPIWorkflowRunRepository)
    client = _RoutingLogStore(
        counts=[
            {"tenant_id": "tenant-1", "app_id": "app-1", "status": "succeeded", "count": "3"},
            {"tenant_id": "tenant-1", "app_id": "app-1", "status": "running", "count": 1},
            {"tenant_id": "tenant-2", "app_id": "app-1", "status": "failed", "count": 9},
            {"tenant_id": "tenant-1", "app_id": "app-1", "status": "bogus", "count": 9},
        ],
        last=[
            {"tenant_id": "tenant-1", "app_id": "app-1", "last_started_at": "2026-10-14T12:30:00"},
            {"tenant_id": "tenant-1", "app_id": "app-'2", "last_started_at": "2026-01-01T00:00:00"},
            {"tenant_id": "tenant-2", "app_id": "app-'2", "last_started_at": "2026-10-14T13:00:00"},
        ],
    )
    repository.logstore_client = cast(AliyunLogStore, client)
    since = datetime.datetime(2026, 10, 14, 12)

    stats = repository.get_stats_by_app_ids(_APPS, _SOURCES, since)

    assert stats == {
        "app-1": AppWorkflowRunStats(
            status_counts={WorkflowExecutionStatus.SUCCEEDED: 3, WorkflowExecutionStatus.RUNNING: 1},
            last_created_at=datetime.datetime(2026, 10, 14, 12, 30),
        ),
        "app-'2": AppWorkflowRunStats(status_counts={}, last_created_at=datetime.datetime(2026, 1, 1)),
    }
    counts_sql, last_sql = client.sql
    assert "ROW_NUMBER() OVER (PARTITION BY id ORDER BY log_version DESC)" in counts_sql
    assert "app_id IN ('app-1', 'app-''2')" in counts_sql
    assert "triggered_from IN ('app-run', 'webhook')" in counts_sql
    assert f"__time__ >= {int(since.replace(tzinfo=datetime.UTC).timestamp())}" in counts_sql
    assert "started_at >= '2026-10-14T12:00:00'" in counts_sql
    assert "app_id IN ('app-1', 'app-''2')" in last_sql


def test_stats_by_app_ids_skips_the_queries_without_apps() -> None:
    repository, client = _repository([])

    assert repository.get_stats_by_app_ids({}, _SOURCES, datetime.datetime(2026, 10, 14)) == {}
    assert client.sql == []
