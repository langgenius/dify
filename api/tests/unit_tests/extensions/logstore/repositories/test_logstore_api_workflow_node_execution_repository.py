import datetime
import sqlite3
import time
from collections.abc import Callable, Generator
from contextlib import closing
from dataclasses import dataclass
from unittest.mock import patch

import pytest
from aliyun.log import GetLogsRequest, GetLogsResponse
from pytest_mock import MockerFixture, MockType
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from extensions.logstore.aliyun_logstore import AliyunLogStore
from extensions.logstore.aliyun_logstore_pg import AliyunLogStorePG
from extensions.logstore.repositories.logstore_api_workflow_node_execution_repository import (
    LogstoreAPIWorkflowNodeExecutionRepository,
    _dict_to_workflow_node_execution_model,
)
from graphon.enums import WorkflowExecutionStatus, WorkflowNodeExecutionStatus
from models.enums import CreatorUserRole, WorkflowRunTriggeredFrom
from models.workflow import (
    ExecutionOffLoadType,
    WorkflowNodeExecutionModel,
    WorkflowNodeExecutionOffload,
    WorkflowNodeExecutionTriggeredFrom,
    WorkflowRun,
    WorkflowType,
)
from repositories.sqlalchemy_api_workflow_run_repository import DifyAPISQLAlchemyWorkflowRunRepository
from services.retention.workflow_run.clear_free_plan_expired_workflow_run_logs import WorkflowRunCleanup
from tests.helpers.unit.config_override import apply_config_overrides


@pytest.fixture
def logstore_database() -> Generator[sqlite3.Connection]:
    with closing(sqlite3.connect(":memory:")) as database:
        database.row_factory = sqlite3.Row
        database.execute(
            "CREATE TABLE workflow_node_execution ("
            "id TEXT, node_execution_id TEXT, tenant_id TEXT, app_id TEXT, workflow_id TEXT, "
            "workflow_run_id TEXT, triggered_from_workflow_id TEXT, triggered_from_node_execution_id TEXT, "
            'triggered_from TEXT, node_id TEXT, node_type TEXT, title TEXT, "index" INTEGER, '
            "status TEXT, elapsed_time REAL, created_at INTEGER, finished_at INTEGER, execution_metadata TEXT, "
            "log_version INTEGER, __time__ INTEGER, inputs TEXT, process_data TEXT, outputs TEXT)"
        )
        yield database


@dataclass(frozen=True)
class SQLBackedRepository:
    """A repository whose real LogStore protocol adapter executes its SQL against local records."""

    repository: LogstoreAPIWorkflowNodeExecutionRepository
    database: sqlite3.Connection
    get_logs: MockType


@pytest.fixture(params=["pg", "sdk"])
def sql_repository(
    request: pytest.FixtureRequest,
    monkeypatch: pytest.MonkeyPatch,
    mocker: MockerFixture,
    logstore_database: sqlite3.Connection,
) -> SQLBackedRepository:
    """Exercise the real protocol adapter while executing its SQL against local records."""
    monkeypatch.setattr(AliyunLogStore, "_instance", None)
    monkeypatch.setattr(AliyunLogStore, "_initialized", False)
    monkeypatch.setenv("ALIYUN_SLS_ENDPOINT", "localhost")
    mocker.patch.object(AliyunLogStore, "_check_endpoint_connectivity")
    store = AliyunLogStore()
    store._use_pg_protocol = request.param == "pg"
    store._pg_client = AliyunLogStorePG("key", "secret", "localhost", "test")
    store.project_name = "test"
    store.log_enabled = False

    def execute(sql: str, *_args: object) -> list[dict[str, object]]:
        return [dict(row) for row in logstore_database.execute(sql)]

    def get_logs(log_request: GetLogsRequest) -> GetLogsResponse:
        # The SDK accessors are unannotated, so narrow the values the adapter sent.
        query: object = log_request.get_query()
        to_time: object = log_request.get_to()
        assert isinstance(query, str)
        assert isinstance(to_time, int)
        search, separator, sql = query.partition(" | ")
        assert separator
        assert search
        assert log_request.get_from() == 0
        assert to_time <= int(time.time())
        return GetLogsResponse({"meta": {"progress": "Complete"}, "data": execute(sql)}, {})

    mocker.patch.object(store._pg_client, "execute_sql", side_effect=execute)
    get_logs_mock = mocker.patch.object(store.client, "get_logs", side_effect=get_logs)
    repository = LogstoreAPIWorkflowNodeExecutionRepository(session_maker=None)
    return SQLBackedRepository(repository=repository, database=logstore_database, get_logs=get_logs_mock)


def test_sql_history_excludes_recursive_tool_executions_and_retains_legacy_rows(
    sql_repository: SQLBackedRepository,
) -> None:
    repository, database = sql_repository.repository, sql_repository.database
    rows = [
        {
            "id": execution_id,
            "tenant_id": "tenant",
            "app_id": "app",
            "workflow_id": "workflow",
            "workflow_run_id": "run",
            "node_id": "same-node",
            "triggered_from": origin.value if origin is not None else None,
            "status": "succeeded",
            "index": index,
            "created_at": index,
            "log_version": 1,
            "__time__": 1,
        }
        for execution_id, index, origin in (
            ("root", 1, WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN),
            ("legacy", 2, None),
            ("child", 3, WorkflowNodeExecutionTriggeredFrom.WORKFLOW_TOOL),
        )
    ]
    insert = (
        "INSERT INTO workflow_node_execution (id, tenant_id, app_id, workflow_id, workflow_run_id, "
        'node_id, triggered_from, status, "index", created_at, log_version, __time__) VALUES '
        "(:id, :tenant_id, :app_id, :workflow_id, :workflow_run_id, :node_id, :triggered_from, :status, "
        ":index, :created_at, :log_version, :__time__)"
    )
    database.executemany(insert, rows)
    history = repository.get_executions_by_workflow_run(tenant_id="tenant", app_id="app", workflow_run_id="run")
    # A newer paused/hidden version must not expose the earlier visible version.
    rows = [
        {**rows[0], "id": "paused", "created_at": 10, "status": "running"},
        {**rows[0], "id": "paused", "created_at": 10, "status": "paused", "log_version": 2},
        {**rows[0], "id": "hidden", "created_at": 11},
        {**rows[2], "id": "hidden", "created_at": 11, "log_version": 2},
        {**rows[1], "id": "null-status", "created_at": 0, "status": None},
        *[
            {**rows[0], "id": f"other-{field}", field: "other", "created_at": 99}
            for field in ("tenant_id", "app_id", "workflow_id", "node_id")
        ],
    ]
    database.executemany(insert, rows)
    latest = repository.get_node_last_execution(
        tenant_id="tenant", app_id="app", workflow_id="workflow", node_id="same-node"
    )

    assert [execution.id for execution in history] == ["legacy", "root"]
    assert latest is not None
    assert latest.id == "legacy"
    assert repository.get_node_last_execution("tenant", "app", "workflow", "unknown") is None
    database.execute("DELETE FROM workflow_node_execution WHERE id IN ('legacy', 'root')")
    remaining = repository.get_node_last_execution("tenant", "app", "workflow", "same-node")
    assert remaining is not None
    assert remaining.id == "null-status"


def test_sdk_history_searches_use_owner_scope(mocker: MockerFixture) -> None:
    with patch("extensions.logstore.repositories.logstore_api_workflow_node_execution_repository.AliyunLogStore"):
        repository = LogstoreAPIWorkflowNodeExecutionRepository(session_maker=None)
    no_rows: list[dict[str, object]] = []
    execute_sql = mocker.patch.object(repository.logstore_client, "execute_sql", return_value=no_rows)

    repository.get_executions_by_workflow_run(tenant_id="tenant", app_id="app", workflow_run_id="run")
    repository.get_node_last_execution(tenant_id="tenant", app_id="app", workflow_id="workflow", node_id="same-node")

    history_query, latest_query = [call.kwargs for call in execute_sql.call_args_list]
    assert latest_query["query"] == (
        'tenant_id: "tenant" and app_id: "app" and workflow_id: "workflow" and node_id: "same-node"'
    )
    assert history_query["query"] == 'tenant_id: "tenant" and app_id: "app" and workflow_run_id: "run"'


def test_resumption_snapshots_read_latest_nodes_with_full_owner_scope(
    logstore_database: sqlite3.Connection, mocker: MockerFixture
) -> None:
    with patch("extensions.logstore.repositories.logstore_api_workflow_node_execution_repository.AliyunLogStore"):
        repository = LogstoreAPIWorkflowNodeExecutionRepository(session_maker=None)
    database = logstore_database
    database.row_factory = sqlite3.Row
    base: dict[str, object] = {
        "id": "row-id",
        "node_execution_id": "engine-id",
        "tenant_id": "tenant",
        "app_id": "app",
        "workflow_id": "workflow",
        "workflow_run_id": "run",
        "triggered_from": "workflow-run",
        "node_id": "tool",
        "node_type": "tool",
        "title": "Approval",
        "index": 2,
        "status": "paused",
        "elapsed_time": 3.5,
        "created_at": 100,
        "finished_at": 104,
        "execution_metadata": '{"iteration_id":"iteration"}',
        "log_version": 2,
        "__time__": 1,
        "inputs": '{"private":"input"}',
        "process_data": '{"private":"trace"}',
        "outputs": '{"private":"output"}',
    }
    rows = [base, {**base, "log_version": 1, "status": "running"}]
    rows.extend(
        {**base, "id": f"page-{index}", "index": index, "execution_metadata": "[]", "elapsed_time": None}
        for index in range(3, 1003)
    )
    for field in ("tenant_id", "app_id", "workflow_id", "workflow_run_id", "triggered_from"):
        rows.append({**base, "id": f"other-{field}", field: "other", "index": 99})
    database.executemany(
        'INSERT INTO workflow_node_execution ("'
        + '", "'.join(base)
        + '") VALUES ('
        + ", ".join(f":{key}" for key in base)
        + ")",
        rows,
    )

    def execute_query(*, sql: str, **_kwargs: object) -> list[dict[str, object]]:
        result = [dict(row) for row in database.execute(sql)]
        assert all(row.keys().isdisjoint({"inputs", "process_data", "outputs"}) for row in result)
        return result

    execute_sql = mocker.patch.object(repository.logstore_client, "execute_sql", side_effect=execute_query)
    snapshots = repository.get_execution_snapshots_by_workflow_run(
        tenant_id="tenant",
        app_id="app",
        workflow_id="workflow",
        triggered_from="workflow-run",
        workflow_run_id="run",
    )
    assert len(snapshots) == 1001
    snapshot = snapshots[0]
    assert (snapshot.execution_id, snapshot.title, snapshot.index, snapshot.status) == (
        "engine-id",
        "Approval",
        2,
        "paused",
    )
    assert snapshot.iteration_id == "iteration"
    assert snapshot.elapsed_time == 3.5
    assert snapshot.created_at == datetime.datetime(1970, 1, 1, 0, 1, 40)
    assert snapshots[-1].index == 1002
    assert snapshots[-1].iteration_id is None
    assert snapshots[-1].elapsed_time == 4
    assert execute_sql.call_count == 2
    query = execute_sql.call_args.kwargs
    assert (
        query["query"] == 'tenant_id: "tenant" and app_id: "app" and workflow_run_id: "run" and workflow_id: "workflow"'
    )


@pytest.mark.parametrize("requested_id", ["parent-row", "parent-engine"])
def test_workflow_tool_children_only_fetch_matching_latest_payloads(
    requested_id: str, sql_repository: SQLBackedRepository, monkeypatch: pytest.MonkeyPatch
) -> None:
    repository, database = sql_repository.repository, sql_repository.database
    rows = [
        {
            "id": "parent-row",
            "node_execution_id": "parent-engine",
            "workflow_id": "caller-workflow",
            "node_type": "tool",
            "log_version": 1,
            "created_at": 0,
        },
        *[
            {
                "id": "child",
                "node_type": "human-input",
                "triggered_from": "workflow-tool",
                "triggered_from_node_execution_id": "parent-engine",
                "log_version": version,
                "status": status,
                "created_at": 1,
                "index": 2,
                "outputs": '{"answer":"approved"}',
            }
            for version, status in ((1, "running"), (2, "paused"))
        ],
        {
            "id": "other-call",
            "triggered_from": "workflow-tool",
            "triggered_from_node_execution_id": "other-engine",
            "created_at": 2,
        },
        {
            "id": "earlier-child",
            "triggered_from": "workflow-tool",
            "triggered_from_node_execution_id": "parent-engine",
            "created_at": 1,
            "index": 1,
        },
        {
            "id": "wrong-origin",
            "triggered_from": "workflow-run",
            "triggered_from_node_execution_id": "parent-engine",
        },
        {
            "id": "other-tenant",
            "tenant_id": "other-tenant",
            "triggered_from": "workflow-tool",
            "triggered_from_node_execution_id": "parent-engine",
        },
        {
            "id": "other-run",
            "workflow_run_id": "other-run",
            "triggered_from": "workflow-tool",
            "triggered_from_node_execution_id": "parent-engine",
        },
        {
            "id": "other-caller",
            "triggered_from": "workflow-tool",
            "triggered_from_workflow_id": "other-workflow",
            "triggered_from_node_execution_id": "parent-engine",
        },
        *[{"id": f"unrelated-{index}"} for index in range(1001)],
    ]
    defaults = {
        "id": "",
        "tenant_id": "tenant",
        "app_id": "source-app",
        "workflow_run_id": "run",
        "node_execution_id": None,
        "workflow_id": "source-workflow",
        "triggered_from_workflow_id": "caller-workflow",
        "triggered_from_node_execution_id": None,
        "node_type": "start",
        "triggered_from": "workflow-run",
        "process_data": None,
        "outputs": None,
        "status": "succeeded",
        "index": 0,
        "created_at": 0,
        "log_version": 1,
        "__time__": 1,
    }
    rows = [{**defaults, **row} for row in rows]
    fetched_payload_ids: list[str] = []
    database.executemany(
        "INSERT INTO workflow_node_execution (id, tenant_id, app_id, workflow_run_id, node_execution_id, "
        "workflow_id, triggered_from_workflow_id, triggered_from_node_execution_id, node_type, triggered_from, "
        'process_data, outputs, status, "index", created_at, log_version, __time__) VALUES '
        "(:id, :tenant_id, :app_id, :workflow_run_id, :node_execution_id, :workflow_id, "
        ":triggered_from_workflow_id, :triggered_from_node_execution_id, :node_type, :triggered_from, "
        ":process_data, :outputs, :status, :index, :created_at, :log_version, :__time__)",
        rows,
    )

    execute_sql = repository.logstore_client.execute_sql

    def execute_query(
        *, sql: str, logstore: str | None = None, query: str = "*", to_time: int | None = None
    ) -> list[dict[str, object]]:
        result = execute_sql(sql=sql, logstore=logstore, query=query, to_time=to_time)
        fetched_payload_ids.extend(str(row["id"]) for row in result if "outputs" in row)
        return result

    monkeypatch.setattr(repository.logstore_client, "execute_sql", execute_query)
    children = repository.get_workflow_tool_executions("tenant", "run", requested_id)
    assert repository.get_workflow_tool_executions("tenant", "run", "unknown") == []
    assert repository.get_workflow_tool_executions("tenant", "run", "child") == []

    assert [child.id for child in children] == ["earlier-child", "child"]
    assert children[1].status.value == "paused"
    assert children[1].outputs_dict == {"answer": "approved"}
    assert fetched_payload_ids == ["earlier-child", "child"]


def test_load_full_process_data_returns_logstore_mapping() -> None:
    with patch("extensions.logstore.repositories.logstore_api_workflow_node_execution_repository.AliyunLogStore"):
        repository = LogstoreAPIWorkflowNodeExecutionRepository(session_maker=None)
    execution = WorkflowNodeExecutionModel()
    execution.process_data = '{"__dify_retry_history": [{"retry_index": 1}]}'

    assert repository.load_full_process_data(execution) == {"__dify_retry_history": [{"retry_index": 1}]}


def test_get_execution_by_id_keeps_process_data_from_highest_failed_log_version(
    sql_repository: SQLBackedRepository,
) -> None:
    repository, database = sql_repository.repository, sql_repository.database
    execution_id, tenant_id = "execution'1", 'tenant"1'
    database.executemany(
        "INSERT INTO workflow_node_execution (id, tenant_id, log_version, status, process_data, __time__) "
        "VALUES (?, ?, ?, ?, ?, 1)",
        [
            (execution_id, tenant_id, 1, "running", "{}"),
            (execution_id, tenant_id, 2, "failed", '{"workflow_agent_binding_id":"binding-1"}'),
            ("other-execution", "other-tenant", 3, "succeeded", "{}"),
        ],
    )
    execution = repository.get_execution_by_id(execution_id, tenant_id)

    assert execution is not None
    assert execution.status.value == "failed"
    assert execution.process_data_dict == {"workflow_agent_binding_id": "binding-1"}
    if not repository.logstore_client.supports_pg_protocol:
        sdk_query = sql_repository.get_logs.call_args.args[0].get_query()
        assert sdk_query.startswith('id: "execution\'1" and tenant_id: "tenant\\"1" | ')
    unscoped = repository.get_execution_by_id(execution_id)
    assert unscoped is not None
    assert unscoped.id == execution_id
    assert repository.get_execution_by_id(execution_id, "other-tenant") is None
    assert repository.get_execution_by_id("unknown") is None
    assert repository.get_execution_by_id("execution' OR '1'='1") is None


_CREATED_AT = datetime.datetime(2026, 8, 18, 2, 0, 0, tzinfo=datetime.UTC)
_FINISHED_AT = _CREATED_AT + datetime.timedelta(seconds=30)


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
        ("both epoch", {"created_at": _CREATED_AT.timestamp(), "finished_at": _FINISHED_AT.timestamp()}),
        ("aware iso and epoch", {"created_at": _CREATED_AT.isoformat(), "finished_at": _FINISHED_AT.timestamp()}),
        (
            "naive iso and epoch",
            {"created_at": _CREATED_AT.replace(tzinfo=None).isoformat(), "finished_at": _FINISHED_AT.timestamp()},
        ),
        ("both datetime", {"created_at": _CREATED_AT, "finished_at": _FINISHED_AT}),
    ],
)
@pytest.mark.usefixtures("non_utc_host_timezone")
def test_dict_to_node_execution_normalizes_timestamps_to_naive_utc(case: str, payload: dict[str, object]) -> None:
    model = _dict_to_workflow_node_execution_model({"id": "execution-1", **payload})

    assert model.created_at == _CREATED_AT.replace(tzinfo=None), case
    assert model.finished_at == _FINISHED_AT.replace(tzinfo=None), case


@pytest.mark.usefixtures("non_utc_host_timezone")
def test_dict_to_node_execution_defaults_missing_created_at_to_naive_utc_now() -> None:
    model = _dict_to_workflow_node_execution_model({"id": "execution-1"})

    assert model.created_at.tzinfo is None
    assert abs((model.created_at - datetime.datetime.now(tz=datetime.UTC).replace(tzinfo=None)).total_seconds()) < 60


_NOW = datetime.datetime(2026, 11, 16)
_EXPIRED = _NOW - datetime.timedelta(days=60)
_CUTOFF = _NOW - datetime.timedelta(days=30)


def _sql_execution(
    execution_id: str, *, workflow_run_id: str, created_at: datetime.datetime, tenant_id: str = "tenant"
) -> WorkflowNodeExecutionModel:
    """Build a SQL node execution row, like the caller rows LogStore deployments still write to SQL."""
    execution = WorkflowNodeExecutionModel(
        id=execution_id,
        tenant_id=tenant_id,
        app_id="app",
        workflow_id="workflow",
        workflow_run_id=workflow_run_id,
        triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
        index=1,
        node_id="agent",
        node_type="agent",
        title="Agent",
        status=WorkflowNodeExecutionStatus.SUCCEEDED,
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by="account",
    )
    execution.created_at = created_at
    return execution


def _sql_offload(node_execution_id: str) -> WorkflowNodeExecutionOffload:
    """Build the SQL offload record of one node execution."""
    return WorkflowNodeExecutionOffload(
        tenant_id="tenant",
        app_id="app",
        node_execution_id=node_execution_id,
        type_=ExecutionOffLoadType.OUTPUTS,
        file_id="file",
    )


def test_maintenance_members_change_only_sql_rows(
    sqlite_session_factory: sessionmaker[Session], mocker: MockerFixture
) -> None:
    """Retention reads and deletes SQL rows by owner scope and never calls the LogStore client."""
    logstore_class = mocker.patch(
        "extensions.logstore.repositories.logstore_api_workflow_node_execution_repository.AliyunLogStore"
    )
    repository = LogstoreAPIWorkflowNodeExecutionRepository(session_maker=sqlite_session_factory)
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                _sql_execution("run-1-node", workflow_run_id="run-1", created_at=_EXPIRED),
                _sql_execution("run-2-node", workflow_run_id="run-2", created_at=_EXPIRED),
                _sql_execution("recent-node", workflow_run_id="run-3", created_at=_NOW),
                _sql_execution("other-node", workflow_run_id="run-4", created_at=_EXPIRED, tenant_id="other-tenant"),
                _sql_offload("run-1-node"),
            ]
        )

    with sqlite_session_factory.begin() as session:
        offloads = repository.get_offloads_by_execution_ids(session, ["run-1-node", "run-2-node"])
        assert [offload.node_execution_id for offload in offloads] == ["run-1-node"]
        assert repository.count_by_runs(session, ["run-1"]) == (1, 1)
        assert repository.delete_by_runs(session, ["run-1"]) == (1, 1)

    expired = repository.get_expired_executions_batch("tenant", _CUTOFF)
    assert [execution.id for execution in expired] == ["run-2-node"]
    assert repository.delete_executions_by_ids([execution.id for execution in expired]) == 1
    assert repository.delete_expired_executions("other-tenant", _CUTOFF) == 1

    with sqlite_session_factory() as session:
        assert session.scalars(select(WorkflowNodeExecutionModel.id)).all() == ["recent-node"]
        assert session.scalars(select(WorkflowNodeExecutionOffload.id)).all() == []
    assert logstore_class.return_value.mock_calls == []


_MAINTENANCE_CALLS: dict[str, Callable[[LogstoreAPIWorkflowNodeExecutionRepository, Session], object]] = {
    "count_by_runs": lambda repo, session: repo.count_by_runs(session, ["run"]),
    "delete_by_runs": lambda repo, session: repo.delete_by_runs(session, ["run"]),
    "delete_executions_by_app": lambda repo, _: repo.delete_executions_by_app("tenant", "app"),
    "delete_executions_by_ids": lambda repo, _: repo.delete_executions_by_ids(["node"]),
    "delete_expired_executions": lambda repo, _: repo.delete_expired_executions("tenant", _CUTOFF),
    "get_expired_executions_batch": lambda repo, _: repo.get_expired_executions_batch("tenant", _CUTOFF),
    "get_offloads_by_execution_ids": lambda repo, session: repo.get_offloads_by_execution_ids(session, ["node"]),
}


@pytest.mark.parametrize("member", sorted(_MAINTENANCE_CALLS))
def test_maintenance_members_require_a_session_maker(
    member: str, sqlite_session_factory: sessionmaker[Session]
) -> None:
    """Without a session maker, each maintenance member raises before reading or changing a record."""
    with sqlite_session_factory.begin() as session:
        session.add(_sql_execution("node", workflow_run_id="run", created_at=_EXPIRED))
    with patch("extensions.logstore.repositories.logstore_api_workflow_node_execution_repository.AliyunLogStore"):
        repository = LogstoreAPIWorkflowNodeExecutionRepository(session_maker=None)

    with sqlite_session_factory.begin() as session, pytest.raises(ValueError, match="session_maker is required"):
        _MAINTENANCE_CALLS[member](repository, session)

    with sqlite_session_factory() as session:
        assert session.scalars(select(WorkflowNodeExecutionModel.id)).all() == ["node"]


@pytest.mark.parametrize("dry_run", [True, False])
def test_workflow_run_cleanup_handles_sql_node_rows_through_the_logstore_repository(
    dry_run: bool,
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
    mocker: MockerFixture,
) -> None:
    """Cleanup counts and deletes an expired run's SQL node rows when node executions use LogStore."""
    apply_config_overrides(
        monkeypatch,
        API_WORKFLOW_NODE_EXECUTION_REPOSITORY=(
            "extensions.logstore.repositories.logstore_api_workflow_node_execution_repository."
            "LogstoreAPIWorkflowNodeExecutionRepository"
        ),
    )
    mocker.patch("extensions.logstore.repositories.logstore_api_workflow_node_execution_repository.AliyunLogStore")
    expired = datetime.datetime.now() - datetime.timedelta(days=60)
    run = WorkflowRun(
        id="run",
        tenant_id="tenant",
        app_id="app",
        workflow_id="workflow",
        type=WorkflowType.WORKFLOW,
        triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
        version="1",
        graph="{}",
        inputs="{}",
        status=WorkflowExecutionStatus.SUCCEEDED,
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by="account",
    )
    run.created_at = expired
    with sqlite_session_factory.begin() as session:
        session.add_all([run, _sql_execution("node", workflow_run_id="run", created_at=expired), _sql_offload("node")])

    WorkflowRunCleanup(
        days=30,
        batch_size=10,
        workflow_run_repo=DifyAPISQLAlchemyWorkflowRunRepository(sqlite_session_factory),
        dry_run=dry_run,
    ).run()

    with sqlite_session_factory() as session:
        stored = (
            session.scalars(select(WorkflowRun.id)).all(),
            session.scalars(select(WorkflowNodeExecutionModel.id)).all(),
            session.scalars(select(WorkflowNodeExecutionOffload.node_execution_id)).all(),
        )
    assert stored == ((["run"], ["node"], ["node"]) if dry_run else ([], [], []))
