import datetime
import json
import sqlite3
import time
from collections.abc import Generator
from contextlib import closing
from unittest.mock import MagicMock, patch

import pytest
from aliyun.log import GetLogsRequest

from core.workflow.node_execution_process_data import WORKFLOW_TOOL_PARENT_EXECUTION_ID_KEY
from extensions.logstore.aliyun_logstore import AliyunLogStore
from extensions.logstore.repositories.logstore_api_workflow_node_execution_repository import (
    LogstoreAPIWorkflowNodeExecutionRepository,
    _dict_to_workflow_node_execution_model,
)
from models.workflow import WorkflowNodeExecutionModel, WorkflowNodeExecutionTriggeredFrom


@pytest.fixture(params=["pg", "sdk"])
def sql_repository(request: pytest.FixtureRequest):
    """Exercise the real protocol adapter while executing its SQL against local records."""
    store = object.__new__(AliyunLogStore)
    store._use_pg_protocol = request.param == "pg"
    store._pg_client = MagicMock()
    store.client = MagicMock()
    store.project_name = "test"
    store.log_enabled = False
    with closing(sqlite3.connect(":memory:")) as database:
        database.row_factory = sqlite3.Row

        def execute(sql: str, *_args: object) -> list[dict[str, object]]:
            return [dict(row) for row in database.execute(sql)]

        def get_logs(log_request: GetLogsRequest):
            search, separator, sql = log_request.get_query().partition(" | ")
            assert separator
            assert search
            assert log_request.get_from() == 0
            assert log_request.get_to() <= int(time.time())
            return MagicMock(get_logs=lambda: [MagicMock(get_contents=lambda row=row: row) for row in execute(sql)])

        store._pg_client.execute_sql.side_effect = execute
        store.client.get_logs.side_effect = get_logs
        with patch(
            "extensions.logstore.repositories.logstore_api_workflow_node_execution_repository.AliyunLogStore",
            return_value=store,
        ):
            repository = LogstoreAPIWorkflowNodeExecutionRepository(session_maker=None)
        yield repository, database


def test_sql_history_excludes_recursive_tool_executions_and_retains_legacy_rows(sql_repository) -> None:
    repository, database = sql_repository
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
    database.execute(
        "CREATE TABLE workflow_node_execution (id TEXT, tenant_id TEXT, app_id TEXT, workflow_id TEXT, "
        'workflow_run_id TEXT, node_id TEXT, triggered_from TEXT, status TEXT, "index" INTEGER, '
        "created_at INTEGER, log_version INTEGER, __time__ INTEGER)"
    )
    insert = (
        "INSERT INTO workflow_node_execution VALUES "
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
    assert repository.get_node_last_execution("tenant", "app", "workflow", "same-node").id == "null-status"


def test_sdk_history_queries_exclude_recursive_tool_executions() -> None:
    with patch("extensions.logstore.repositories.logstore_api_workflow_node_execution_repository.AliyunLogStore"):
        repository = LogstoreAPIWorkflowNodeExecutionRepository(session_maker=None)
    repository.logstore_client = MagicMock(supports_pg_protocol=False)
    repository.logstore_client.execute_sql.return_value = []

    repository.get_executions_by_workflow_run(tenant_id="tenant", app_id="app", workflow_run_id="run")
    repository.get_node_last_execution(tenant_id="tenant", app_id="app", workflow_id="workflow", node_id="same-node")

    history_query, latest_query = [call.kwargs for call in repository.logstore_client.execute_sql.call_args_list]
    assert "triggered_from != 'workflow-tool'" in latest_query["sql"]
    assert latest_query["query"] == (
        'tenant_id: "tenant" and app_id: "app" and workflow_id: "workflow" and node_id: "same-node"'
    )
    assert "triggered_from != 'workflow-tool'" in history_query["sql"]
    assert history_query["query"] == 'tenant_id: "tenant" and app_id: "app" and workflow_run_id: "run"'


def test_resumption_snapshots_read_latest_nodes_with_full_owner_scope() -> None:
    with patch("extensions.logstore.repositories.logstore_api_workflow_node_execution_repository.AliyunLogStore"):
        repository = LogstoreAPIWorkflowNodeExecutionRepository(session_maker=None)
    with closing(sqlite3.connect(":memory:")) as database:
        database.row_factory = sqlite3.Row
        database.execute(
            "CREATE TABLE workflow_node_execution (id TEXT, node_execution_id TEXT, tenant_id TEXT, app_id TEXT, "
            "workflow_id TEXT, workflow_run_id TEXT, triggered_from TEXT, node_id TEXT, node_type TEXT, title TEXT, "
            '"index" INTEGER, status TEXT, elapsed_time REAL, created_at INTEGER, finished_at INTEGER, '
            "execution_metadata TEXT, log_version INTEGER, __time__ INTEGER)"
        )
        base = {
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
        }
        rows = [base, {**base, "log_version": 1, "status": "running"}]
        rows.extend(
            {**base, "id": f"page-{index}", "index": index, "execution_metadata": "[]", "elapsed_time": None}
            for index in range(3, 1003)
        )
        for field in ("tenant_id", "app_id", "workflow_id", "workflow_run_id", "triggered_from"):
            rows.append({**base, "id": f"other-{field}", field: "other", "index": 99})
        database.executemany(
            "INSERT INTO workflow_node_execution VALUES (" + ", ".join(f":{key}" for key in base) + ")", rows
        )

        def execute_query(*, sql: str, **_kwargs: object) -> list[dict[str, object]]:
            return [dict(row) for row in database.execute(sql)]

        repository.logstore_client.execute_sql.side_effect = execute_query
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
    assert repository.logstore_client.execute_sql.call_count == 2
    query = repository.logstore_client.execute_sql.call_args.kwargs
    assert "SELECT *" not in query["sql"]
    assert "OFFSET 1000" in query["sql"]
    assert (
        query["query"] == 'tenant_id: "tenant" and app_id: "app" and workflow_run_id: "run" and workflow_id: "workflow"'
    )


@pytest.mark.parametrize("requested_id", ["parent-row", "parent-engine"])
def test_workflow_tool_children_only_fetch_matching_latest_payloads(requested_id: str) -> None:
    with patch("extensions.logstore.repositories.logstore_api_workflow_node_execution_repository.AliyunLogStore"):
        repository = LogstoreAPIWorkflowNodeExecutionRepository(session_maker=None)
    repository.logstore_client = MagicMock()
    rows = [
        {
            "id": "parent-row",
            "node_execution_id": "parent-engine",
            "node_type": "tool",
            "log_version": 1,
            "created_at": 0,
        },
        *[
            {
                "id": "child",
                "node_type": "human-input",
                "triggered_from": "workflow-tool",
                "process_data": json.dumps({WORKFLOW_TOOL_PARENT_EXECUTION_ID_KEY: "parent-engine"}),
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
            "process_data": json.dumps({WORKFLOW_TOOL_PARENT_EXECUTION_ID_KEY: "other-engine"}),
            "created_at": 2,
        },
        {
            "id": "earlier-child",
            "triggered_from": "workflow-tool",
            "process_data": json.dumps({WORKFLOW_TOOL_PARENT_EXECUTION_ID_KEY: "parent-engine"}),
            "created_at": 1,
            "index": 1,
        },
        {
            "id": "wrong-origin",
            "triggered_from": "workflow-run",
            "process_data": json.dumps({WORKFLOW_TOOL_PARENT_EXECUTION_ID_KEY: "parent-engine"}),
        },
        {
            "id": "other-tenant",
            "tenant_id": "other-tenant",
            "triggered_from": "workflow-tool",
            "process_data": json.dumps({WORKFLOW_TOOL_PARENT_EXECUTION_ID_KEY: "parent-engine"}),
        },
        {
            "id": "other-run",
            "workflow_run_id": "other-run",
            "triggered_from": "workflow-tool",
            "process_data": json.dumps({WORKFLOW_TOOL_PARENT_EXECUTION_ID_KEY: "parent-engine"}),
        },
        *[{"id": f"unrelated-{index}"} for index in range(1001)],
    ]
    defaults = {
        "id": "",
        "tenant_id": "tenant",
        "app_id": "source-app",
        "workflow_run_id": "run",
        "node_execution_id": None,
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
    with closing(sqlite3.connect(":memory:")) as database:
        database.row_factory = sqlite3.Row
        database.create_function(
            "json_extract_scalar",
            2,
            lambda value, path: json.loads(value).get(path.removeprefix("$.")) if value else None,
        )
        database.execute(
            "CREATE TABLE workflow_node_execution (id TEXT, tenant_id TEXT, app_id TEXT, workflow_run_id TEXT, "
            "node_execution_id TEXT, node_type TEXT, triggered_from TEXT, process_data TEXT, outputs TEXT, "
            'status TEXT, "index" INTEGER, created_at INTEGER, log_version INTEGER, __time__ INTEGER)'
        )
        database.executemany(
            "INSERT INTO workflow_node_execution VALUES "
            "(:id, :tenant_id, :app_id, :workflow_run_id, :node_execution_id, :node_type, :triggered_from, "
            ":process_data, :outputs, :status, :index, :created_at, :log_version, :__time__)",
            rows,
        )

        def execute_query(*, sql: str, **_kwargs: object) -> list[dict[str, object]]:
            result = [dict(row) for row in database.execute(sql)]
            fetched_payload_ids.extend(str(row["id"]) for row in result if "outputs" in row)
            return result

        repository.logstore_client.execute_sql.side_effect = execute_query
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


def test_get_execution_by_id_keeps_process_data_from_highest_failed_log_version(sql_repository) -> None:
    repository, database = sql_repository
    execution_id, tenant_id = "execution'1", 'tenant"1'
    database.execute(
        "CREATE TABLE workflow_node_execution "
        "(id TEXT, tenant_id TEXT, log_version INTEGER, status TEXT, process_data TEXT, __time__ INTEGER)"
    )
    database.executemany(
        "INSERT INTO workflow_node_execution VALUES (?, ?, ?, ?, ?, 1)",
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
        sdk_query = repository.logstore_client.client.get_logs.call_args.args[0].get_query()
        assert sdk_query.startswith('id: "execution\'1" and tenant_id: "tenant\\"1" | ')
    assert repository.get_execution_by_id(execution_id).id == execution_id
    assert repository.get_execution_by_id(execution_id, "other-tenant") is None
    assert repository.get_execution_by_id("unknown") is None
    assert repository.get_execution_by_id("execution' OR '1'='1") is None


_CREATED_AT = datetime.datetime(2026, 8, 18, 2, 0, 0, tzinfo=datetime.UTC)
_FINISHED_AT = _CREATED_AT + datetime.timedelta(seconds=30)


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
