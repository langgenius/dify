import datetime
import time
from collections.abc import Generator
from unittest.mock import patch

import pytest
from sqlalchemy.orm import Session, sessionmaker

from repositories.workflow.logstore.records import workflow_run_from_log
from repositories.workflow.logstore.run_repository import (
    LogstoreWorkflowRunRepository,
)
from tests.unit_tests.config_override import apply_config_overrides

_START = datetime.datetime(2026, 8, 18, 2, 0, 0, tzinfo=datetime.UTC)
_FINISH = _START + datetime.timedelta(seconds=30)
_EXPECTED_CREATED_AT = _START.replace(tzinfo=None)
_EXPECTED_FINISHED_AT = _FINISH.replace(tzinfo=None)

_BASE: dict[str, object] = {"id": "run-1", "tenant_id": "tenant-1", "app_id": "app-1", "workflow_id": "workflow-1"}


@pytest.mark.parametrize("dual_read", [True, False])
@pytest.mark.parametrize("lookup_error", [False, True], ids=["not-yet-indexed", "unavailable"])
def test_tenant_lookup_database_fallback_respects_storage_policy_and_tenant(
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
    dual_read: bool,
    lookup_error: bool,
) -> None:
    apply_config_overrides(monkeypatch, LOGSTORE_DUAL_READ_ENABLED=dual_read)
    with sqlite_session_factory.begin() as session:
        session.add(workflow_run_from_log(dict(_BASE)))
    with patch("repositories.workflow.logstore.run_repository.AliyunLogStore", autospec=True) as client:
        empty_logs: list[dict[str, object]] = []
        client.return_value.execute_sql.return_value = empty_logs
        if lookup_error:
            client.return_value.execute_sql.side_effect = RuntimeError("LogStore unavailable")
        repository = LogstoreWorkflowRunRepository(sqlite_session_factory)
        if lookup_error and not dual_read:
            with pytest.raises(RuntimeError, match="LogStore unavailable"):
                repository.get_workflow_run_by_id_and_tenant_id("tenant-1", "run-1")
            return
        run = repository.get_workflow_run_by_id_and_tenant_id("tenant-1", "run-1")
        assert (run is not None) == dual_read
        assert repository.get_workflow_run_by_id_and_tenant_id("another-tenant", "run-1") is None


def test_tenant_lookup_rejects_a_log_from_another_tenant(sqlite_session_factory: sessionmaker[Session]) -> None:
    with patch("repositories.workflow.logstore.run_repository.AliyunLogStore", autospec=True) as client:
        client.return_value.execute_sql.return_value = [{**_BASE, "tenant_id": "another-tenant"}]
        repository = LogstoreWorkflowRunRepository(sqlite_session_factory)
        assert repository.get_workflow_run_by_id_and_tenant_id("tenant-1", "run-1") is None


@pytest.fixture
def non_utc_host_timezone(monkeypatch: pytest.MonkeyPatch) -> Generator[None, None, None]:
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
def test_workflow_run_from_log_normalizes_timestamps_to_naive_utc(case: str, payload: dict[str, object]) -> None:
    model = workflow_run_from_log({**_BASE, **payload})

    assert model.created_at == _EXPECTED_CREATED_AT, case
    assert model.finished_at == _EXPECTED_FINISHED_AT, case
    assert model.elapsed_time == 30.0, case


@pytest.mark.usefixtures("non_utc_host_timezone")
def test_workflow_run_from_log_defaults_missing_started_at_to_naive_utc_now() -> None:
    model = workflow_run_from_log({**_BASE, "finished_at": _FINISH.timestamp()})

    assert model.created_at.tzinfo is None
    # A naive local-time default would sit 5h30m ahead of UTC and drive elapsed_time negative.
    assert abs((model.created_at - datetime.datetime.now(tz=datetime.UTC).replace(tzinfo=None)).total_seconds()) < 60
