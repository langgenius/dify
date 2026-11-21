import datetime
import time
from collections.abc import Generator, Iterable
from dataclasses import dataclass
from typing import cast, override

import pytest
from pytest_mock import MockerFixture, MockType
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from extensions.logstore.aliyun_logstore import AliyunLogStore
from extensions.logstore.repositories.logstore_api_workflow_run_repository import (
    LogstoreAPIWorkflowRunRepository,
    _dict_to_workflow_run,
)
from extensions.logstore.sql_escape import escape_logstore_query_value
from graphon.enums import WorkflowExecutionStatus
from models.enums import CreatorUserRole, WorkflowRunTriggeredFrom
from models.workflow import WorkflowArchiveLog, WorkflowPause, WorkflowRun, WorkflowType
from repositories.api_workflow_run_repository import AppWorkflowRunStats
from repositories.sqlalchemy_api_workflow_run_repository import DifyAPISQLAlchemyWorkflowRunRepository
from services.retention.workflow_run.clear_free_plan_expired_workflow_run_logs import WorkflowRunCleanup

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


@pytest.mark.parametrize("elapsed_time", ["0.0", "5.5"])
def test_dict_to_workflow_run_prefers_stored_active_duration(elapsed_time: str) -> None:
    model = _dict_to_workflow_run({**_BASE, "started_at": _START, "finished_at": _FINISH, "elapsed_time": elapsed_time})

    assert model.elapsed_time == float(elapsed_time)


@pytest.mark.parametrize("elapsed_time", [None, "null"])
def test_dict_to_workflow_run_defaults_legacy_unfinished_duration_to_zero(elapsed_time: str | None) -> None:
    model = _dict_to_workflow_run({**_BASE, "elapsed_time": elapsed_time})

    assert model.elapsed_time == 0.0


_MODULE = "extensions.logstore.repositories.logstore_api_workflow_run_repository"
_NOW = datetime.datetime(2026, 11, 16, 12, 0, 0)
_EXPIRED = _NOW - datetime.timedelta(days=60)
_CUTOFF = _NOW - datetime.timedelta(days=30)
_TASK_ID = "00000000-0000-4000-8000-000000000001"


@dataclass(frozen=True)
class SQLControlledRepository:
    """The LogStore run repository on the unit-test SQLite schema, with its LogStore client patched.

    ``sql`` is the SQL repository on the same session maker, which the delegated members must match.
    """

    repository: LogstoreAPIWorkflowRunRepository
    sql: DifyAPISQLAlchemyWorkflowRunRepository
    logstore_client: MockType


def _sql_controlled_repository(
    session_factory: sessionmaker[Session],
    mocker: MockerFixture,
    monkeypatch: pytest.MonkeyPatch,
    *,
    dual_read: bool,
) -> SQLControlledRepository:
    """Build the repository through its real constructor; only the LogStore client class is replaced."""
    monkeypatch.setenv("LOGSTORE_DUAL_READ_ENABLED", "true" if dual_read else "false")
    logstore_class = mocker.patch(f"{_MODULE}.AliyunLogStore")
    return SQLControlledRepository(
        repository=LogstoreAPIWorkflowRunRepository(session_factory),
        sql=DifyAPISQLAlchemyWorkflowRunRepository(session_factory),
        logstore_client=logstore_class.return_value,
    )


@pytest.fixture
def control(
    sqlite_session_factory: sessionmaker[Session], mocker: MockerFixture, monkeypatch: pytest.MonkeyPatch
) -> SQLControlledRepository:
    return _sql_controlled_repository(sqlite_session_factory, mocker, monkeypatch, dual_read=True)


def _sql_run(
    run_id: str,
    *,
    tenant_id: str = "tenant",
    app_id: str = "app",
    created_at: datetime.datetime = _EXPIRED,
    status: WorkflowExecutionStatus = WorkflowExecutionStatus.SUCCEEDED,
) -> WorkflowRun:
    """Build a SQL run row, like the rows the core repository writes before the LogStore record."""
    run = WorkflowRun(
        id=run_id,
        tenant_id=tenant_id,
        app_id=app_id,
        workflow_id="workflow",
        type=WorkflowType.WORKFLOW,
        triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
        version="1",
        graph="{}",
        inputs="{}",
        status=status,
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by="account",
    )
    run.created_at = created_at
    return run


def _ids(runs: Iterable[WorkflowRun]) -> list[str]:
    return [run.id for run in runs]


def test_run_control_locks_and_stops_the_sql_run(
    control: SQLControlledRepository, sqlite_session_factory: sessionmaker[Session]
) -> None:
    """Human Input locks, pause checks and stops act on the SQL run in the caller's session."""
    pause = WorkflowPause(workflow_id="workflow", workflow_run_id="run", state_object_key="pause")
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                _sql_run("run", status=WorkflowExecutionStatus.PAUSED),
                _sql_run("other", tenant_id="other-tenant", status=WorkflowExecutionStatus.PAUSED),
                pause,
            ]
        )

    with sqlite_session_factory.begin() as session:
        scope = {"tenant_id": "tenant", "app_id": "app", "run_id": "run"}
        assert control.repository.get_workflow_run_by_id_for_update(session, **{**scope, "app_id": "other"}) is None
        assert control.repository.has_active_workflow_pause(session, **scope)
        assert list(control.repository.get_legacy_pause_reasons(session, pause.id)) == []
        run = control.repository.get_workflow_run_by_id_for_update(session, **scope)
        assert run is not None
        control.repository.stop_workflow_run(session, run=run, error="Stopped by timeout", finished_at=_NOW)

    with sqlite_session_factory() as session:
        assert not control.repository.has_active_workflow_pause(session, **scope)
        assert session.get_one(WorkflowRun, "run").status == WorkflowExecutionStatus.STOPPED
        assert session.get_one(WorkflowPause, pause.id).resumed_at == _NOW
        assert session.get_one(WorkflowRun, "other").status == WorkflowExecutionStatus.PAUSED
    assert control.logstore_client.mock_calls == []


def test_retention_members_read_and_delete_only_sql_rows(
    control: SQLControlledRepository, sqlite_session_factory: sessionmaker[Session]
) -> None:
    """Retention reads return what the SQL repository returns, and deletes remove only the targets."""
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                _sql_run("expired-1"),
                _sql_run("expired-2", created_at=_EXPIRED + datetime.timedelta(seconds=1)),
                _sql_run("other-tenant", tenant_id="other-tenant"),
                _sql_run("other-app", app_id="other-app", created_at=_NOW),
                _sql_run("recent", created_at=_NOW),
            ]
        )
    repository, sql = control.repository, control.sql

    expired = repository.get_expired_runs_batch("tenant", _CUTOFF)
    assert _ids(expired) == _ids(sql.get_expired_runs_batch("tenant", _CUTOFF))
    assert sorted(_ids(expired)) == ["expired-1", "expired-2"]
    window = repository.get_runs_batch_by_time_range(None, _CUTOFF, None, 10)
    assert _ids(window) == _ids(sql.get_runs_batch_by_time_range(None, _CUTOFF, None, 10))
    assert len(window) == 3
    refs = repository.get_cleanup_refs_batch_by_time_range(None, _CUTOFF, None, 10)
    assert refs == sql.get_cleanup_refs_batch_by_time_range(None, _CUTOFF, None, 10)
    assert [ref.id for ref in refs] == _ids(window)
    assert repository.count_runs_with_related(expired) == sql.count_runs_with_related(expired)
    assert repository.count_runs_with_related_by_ids(["expired-1"]) == sql.count_runs_with_related_by_ids(["expired-1"])

    assert repository.delete_runs_with_related_by_ids(["expired-1"])["runs"] == 1
    assert repository.delete_runs_with_related([run for run in expired if run.id == "expired-2"])["runs"] == 1
    with sqlite_session_factory.begin() as session:
        other_tenant = [session.get_one(WorkflowRun, "other-tenant")]
        assert repository.delete_runs_with_related_in_session(session, other_tenant)["runs"] == 1
    assert repository.delete_runs_by_app("tenant", "other-app") == 1
    assert repository.delete_runs_by_ids(["recent"]) == 1

    with sqlite_session_factory() as session:
        assert session.scalars(select(WorkflowRun.id)).all() == []
    assert control.logstore_client.mock_calls == []


def test_archive_members_round_trip_sql_archive_logs(
    control: SQLControlledRepository, sqlite_session_factory: sessionmaker[Session]
) -> None:
    """Archive, restore and cleanup lookups read and write the SQL archive tables."""
    with sqlite_session_factory.begin() as session:
        session.add(_sql_run("archived"))
    window = (_EXPIRED - datetime.timedelta(days=1), _NOW)

    with sqlite_session_factory.begin() as session:
        run = session.get_one(WorkflowRun, "archived")
        assert list(control.repository.get_app_logs_by_run_id(session, "archived")) == []
        assert list(control.repository.get_pause_records_by_run_id(session, "archived")) == []
        assert list(control.repository.get_pause_reason_records_by_run_id(session, [])) == []
        assert control.repository.create_archive_logs(session, run, [], None) == 1

    with sqlite_session_factory() as session:
        assert control.repository.get_archived_run_ids(session, ["archived", "missing"]) == {"archived"}
        logs = control.repository.get_archived_logs_by_time_range(session, ["tenant"], *window, 10)
        assert [log.workflow_run_id for log in logs] == ["archived"]
        assert _ids(control.repository.get_archived_runs_by_time_range(session, None, *window, 10)) == ["archived"]
    archived = control.repository.get_archived_log_by_run_id("archived")
    assert archived is not None
    assert archived.run_status == WorkflowExecutionStatus.SUCCEEDED

    with sqlite_session_factory.begin() as session:
        assert control.repository.delete_archive_log_by_run_id(session, "archived") == 1
    with sqlite_session_factory() as session:
        assert session.scalars(select(WorkflowArchiveLog.id)).all() == []
    assert control.logstore_client.mock_calls == []


@pytest.mark.parametrize("dry_run", [True, False])
def test_workflow_run_cleanup_handles_expired_sql_runs_through_the_logstore_repository(
    dry_run: bool, control: SQLControlledRepository, sqlite_session_factory: sessionmaker[Session]
) -> None:
    """Cleanup counts and deletes an expired SQL run when workflow runs use LogStore."""
    with sqlite_session_factory.begin() as session:
        session.add(_sql_run("run", created_at=datetime.datetime.now() - datetime.timedelta(days=60)))

    WorkflowRunCleanup(days=30, batch_size=10, workflow_run_repo=control.repository, dry_run=dry_run).run()

    with sqlite_session_factory() as session:
        assert session.scalars(select(WorkflowRun.id)).all() == (["run"] if dry_run else [])
    assert control.logstore_client.mock_calls == []


def _logstore_record(*, tenant_id: str, status: str, log_version: int) -> dict[str, object]:
    return {
        "id": "run",
        "tenant_id": tenant_id,
        "app_id": "app",
        "workflow_id": "workflow",
        "status": status,
        "log_version": str(log_version),
        "started_at": _NOW.isoformat(),
    }


@pytest.mark.parametrize("pg_protocol", [True, False])
def test_tenant_lookup_returns_a_task_bound_sql_run_without_querying_logstore(
    pg_protocol: bool, control: SQLControlledRepository, sqlite_session_factory: sessionmaker[Session]
) -> None:
    run = _sql_run("run", status=WorkflowExecutionStatus.PAUSED)
    run.task_id = _TASK_ID
    with sqlite_session_factory.begin() as session:
        session.add(run)
    control.logstore_client.supports_pg_protocol = pg_protocol

    found = control.repository.get_workflow_run_by_id_and_tenant_id("tenant", "run")

    assert found is not None
    assert (found.id, found.task_id, found.status) == ("run", _TASK_ID, WorkflowExecutionStatus.PAUSED)
    assert control.logstore_client.mock_calls == []


@pytest.mark.parametrize(
    ("pg_protocol", "query_argument", "tenant_filter"),
    [
        (True, "sql", "tenant_id = 'tenant'"),
        (False, "query", f"and tenant_id:{escape_logstore_query_value('tenant')}"),
    ],
)
def test_tenant_lookup_returns_the_newest_logstore_record_of_the_tenant(
    pg_protocol: bool,
    query_argument: str,
    tenant_filter: str,
    control: SQLControlledRepository,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with sqlite_session_factory.begin() as session:
        session.add(_sql_run("run", status=WorkflowExecutionStatus.RUNNING))
    client = control.logstore_client
    client.supports_pg_protocol = pg_protocol
    newest = _logstore_record(tenant_id="tenant", status="succeeded", log_version=2)
    client.execute_sql.return_value = [newest]
    client.get_logs.return_value = [_logstore_record(tenant_id="tenant", status="running", log_version=1), newest]

    found = control.repository.get_workflow_run_by_id_and_tenant_id("tenant", "run")

    assert found is not None
    assert found.status == WorkflowExecutionStatus.SUCCEEDED
    query = (client.execute_sql if pg_protocol else client.get_logs).call_args.kwargs[query_argument]
    assert tenant_filter in query
    assert "app_id" not in query


@pytest.mark.parametrize(
    ("dual_read", "expected"),
    [(True, ("run", WorkflowExecutionStatus.SUCCEEDED)), (False, None)],
)
def test_tenant_lookup_without_a_logstore_record_falls_back_to_sql_only_with_dual_read(
    dual_read: bool,
    expected: tuple[str, WorkflowExecutionStatus] | None,
    sqlite_session_factory: sessionmaker[Session],
    mocker: MockerFixture,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    with sqlite_session_factory.begin() as session:
        session.add(_sql_run("run"))
    control = _sql_controlled_repository(sqlite_session_factory, mocker, monkeypatch, dual_read=dual_read)
    control.logstore_client.supports_pg_protocol = True
    control.logstore_client.execute_sql.return_value = list[dict[str, object]]()

    found = control.repository.get_workflow_run_by_id_and_tenant_id("tenant", "run")

    # Reading the status proves that the fallback row is still loaded after the call.
    assert (None if found is None else (found.id, found.status)) == expected


def test_tenant_lookup_does_not_return_a_run_of_another_tenant(
    control: SQLControlledRepository, sqlite_session_factory: sessionmaker[Session]
) -> None:
    with sqlite_session_factory.begin() as session:
        session.add(_sql_run("run", tenant_id="other-tenant"))
    control.logstore_client.supports_pg_protocol = True
    control.logstore_client.execute_sql.return_value = list[dict[str, object]]()

    assert control.repository.get_workflow_run_by_id_and_tenant_id("tenant", "run") is None


def test_tenant_lookup_returns_the_sql_run_when_logstore_fails_with_dual_read(
    control: SQLControlledRepository, sqlite_session_factory: sessionmaker[Session]
) -> None:
    with sqlite_session_factory.begin() as session:
        session.add(_sql_run("run"))
    control.logstore_client.supports_pg_protocol = True
    control.logstore_client.execute_sql.side_effect = RuntimeError("LogStore is unavailable")

    found = control.repository.get_workflow_run_by_id_and_tenant_id("tenant", "run")

    assert found is not None
    assert (found.id, found.status) == ("run", WorkflowExecutionStatus.SUCCEEDED)


def test_tenant_lookup_raises_the_logstore_error_without_dual_read(
    sqlite_session_factory: sessionmaker[Session], mocker: MockerFixture, monkeypatch: pytest.MonkeyPatch
) -> None:
    with sqlite_session_factory.begin() as session:
        session.add(_sql_run("run"))
    control = _sql_controlled_repository(sqlite_session_factory, mocker, monkeypatch, dual_read=False)
    control.logstore_client.supports_pg_protocol = True
    control.logstore_client.execute_sql.side_effect = RuntimeError("LogStore is unavailable")

    with pytest.raises(RuntimeError, match="LogStore is unavailable"):
        control.repository.get_workflow_run_by_id_and_tenant_id("tenant", "run")
