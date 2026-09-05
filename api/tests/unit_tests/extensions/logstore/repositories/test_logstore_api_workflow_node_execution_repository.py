import datetime
import json
import sqlite3
import time
from collections.abc import Generator
from contextlib import closing
from unittest.mock import MagicMock, patch

import pytest

from extensions.logstore.repositories.logstore_api_workflow_node_execution_repository import (
    LogstoreAPIWorkflowNodeExecutionRepository,
    _dict_to_workflow_node_execution_model,
)
from models.workflow import WorkflowNodeExecutionModel, WorkflowNodeExecutionTriggeredFrom


def test_sql_history_excludes_recursive_tool_executions_and_retains_legacy_rows() -> None:
    with patch("extensions.logstore.repositories.logstore_api_workflow_node_execution_repository.AliyunLogStore"):
        repository = LogstoreAPIWorkflowNodeExecutionRepository(session_maker=None)
    repository.logstore_client = MagicMock(supports_pg_protocol=True)
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
    with closing(sqlite3.connect(":memory:")) as database:
        database.row_factory = sqlite3.Row
        database.execute(
            "CREATE TABLE workflow_node_execution (id TEXT, tenant_id TEXT, app_id TEXT, workflow_id TEXT, "
            'workflow_run_id TEXT, node_id TEXT, triggered_from TEXT, status TEXT, "index" INTEGER, '
            "created_at INTEGER, log_version INTEGER, __time__ INTEGER)"
        )
        database.executemany(
            "INSERT INTO workflow_node_execution VALUES "
            "(:id, :tenant_id, :app_id, :workflow_id, :workflow_run_id, :node_id, :triggered_from, :status, "
            ":index, :created_at, :log_version, :__time__)",
            rows,
        )

        def execute_query(*, sql: str, **_kwargs):
            return [dict(row) for row in database.execute(sql)]

        repository.logstore_client.execute_sql.side_effect = execute_query
        history = repository.get_executions_by_workflow_run(tenant_id="tenant", app_id="app", workflow_run_id="run")
        latest = repository.get_node_last_execution(
            tenant_id="tenant", app_id="app", workflow_id="workflow", node_id="same-node"
        )

    assert [execution.id for execution in history] == ["legacy", "root"]
    assert latest is not None
    assert latest.id == "legacy"


def test_sdk_history_queries_exclude_recursive_tool_executions() -> None:
    with patch("extensions.logstore.repositories.logstore_api_workflow_node_execution_repository.AliyunLogStore"):
        repository = LogstoreAPIWorkflowNodeExecutionRepository(session_maker=None)
    repository.logstore_client = MagicMock(supports_pg_protocol=False)
    repository.logstore_client.get_logs.return_value = []

    repository.get_executions_by_workflow_run(tenant_id="tenant", app_id="app", workflow_run_id="run")
    repository.get_node_last_execution(tenant_id="tenant", app_id="app", workflow_id="workflow", node_id="same-node")

    requests = repository.logstore_client.get_logs.call_args_list
    assert len(requests) == 2
    for request in requests:
        assert 'not triggered_from: "workflow-tool"' in request.kwargs["query"]


def test_load_full_process_data_returns_logstore_mapping() -> None:
    with patch("extensions.logstore.repositories.logstore_api_workflow_node_execution_repository.AliyunLogStore"):
        repository = LogstoreAPIWorkflowNodeExecutionRepository(session_maker=None)
    execution = WorkflowNodeExecutionModel()
    execution.process_data = '{"__dify_retry_history": [{"retry_index": 1}]}'

    assert repository.load_full_process_data(execution) == {"__dify_retry_history": [{"retry_index": 1}]}


def test_get_execution_by_id_keeps_process_data_from_highest_failed_log_version() -> None:
    with patch("extensions.logstore.repositories.logstore_api_workflow_node_execution_repository.AliyunLogStore"):
        repository = LogstoreAPIWorkflowNodeExecutionRepository(session_maker=None)
    repository.logstore_client = MagicMock(supports_pg_protocol=False)
    repository.logstore_client.get_logs.return_value = [
        {
            "id": "execution-1",
            "log_version": "1",
            "process_data": "{}",
        },
        {
            "id": "execution-1",
            "log_version": "2",
            "status": "failed",
            "process_data": json.dumps({"workflow_agent_binding_id": "binding-1"}),
        },
    ]

    execution = repository.get_execution_by_id("execution-1")

    assert execution is not None
    assert execution.status.value == "failed"
    assert execution.process_data_dict == {"workflow_agent_binding_id": "binding-1"}


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
