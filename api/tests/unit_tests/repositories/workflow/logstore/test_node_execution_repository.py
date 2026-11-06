import datetime
import time
from collections.abc import Generator
from unittest.mock import patch

import pytest
from sqlalchemy.orm import Session, sessionmaker

from models.workflow import WorkflowNodeExecutionModel
from repositories.workflow.logstore.node_execution_repository import (
    LogstoreWorkflowNodeExecutionRepository,
)
from repositories.workflow.logstore.records import node_execution_model_from_log


def test_load_full_process_data_returns_logstore_mapping(sqlite_session_factory: sessionmaker[Session]) -> None:
    with patch("repositories.workflow.logstore.node_execution_repository.AliyunLogStore"):
        repository = LogstoreWorkflowNodeExecutionRepository(session_maker=sqlite_session_factory)
    execution = WorkflowNodeExecutionModel()
    execution.process_data = '{"__dify_retry_history": [{"retry_index": 1}]}'

    assert repository.load_full_process_data(execution) == {"__dify_retry_history": [{"retry_index": 1}]}


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
    model = node_execution_model_from_log({"id": "execution-1", **payload})

    assert model.created_at == _CREATED_AT.replace(tzinfo=None), case
    assert model.finished_at == _FINISHED_AT.replace(tzinfo=None), case


@pytest.mark.usefixtures("non_utc_host_timezone")
def test_dict_to_node_execution_defaults_missing_created_at_to_naive_utc_now() -> None:
    model = node_execution_model_from_log({"id": "execution-1"})

    assert model.created_at.tzinfo is None
    assert abs((model.created_at - datetime.datetime.now(tz=datetime.UTC).replace(tzinfo=None)).total_seconds()) < 60


def test_node_execution_mapper_preserves_nested_workflow_tool_owner() -> None:
    model = node_execution_model_from_log(
        {
            "id": "execution-1",
            "triggered_from_workflow_id": "workflow-parent",
            "triggered_from_node_execution_id": "node-execution-parent",
        }
    )

    assert model.triggered_from_workflow_id == "workflow-parent"
    assert model.triggered_from_node_execution_id == "node-execution-parent"


def test_run_queries_separate_top_level_and_workflow_tool_executions(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    base = {
        "tenant_id": "tenant-1",
        "app_id": "app-1",
        "workflow_id": "workflow-1",
        "workflow_run_id": "run-1",
        "created_at": _CREATED_AT,
    }
    rows = [
        {**base, "id": "parent-row", "node_execution_id": "parent-execution", "node_type": "tool", "index": 1},
        {
            **base,
            "id": "child-row",
            "triggered_from": "workflow-tool",
            "triggered_from_workflow_id": "workflow-1",
            "triggered_from_node_execution_id": "parent-execution",
            "index": 2,
        },
        {**base, "id": "top-level-row", "index": 3},
    ]
    with patch("repositories.workflow.logstore.node_execution_repository.AliyunLogStore") as client:
        client.return_value.execute_sql.return_value = rows
        repository = LogstoreWorkflowNodeExecutionRepository(session_maker=sqlite_session_factory)

        top_level = repository.get_executions_by_workflow_run("tenant-1", "app-1", "run-1")
        children = repository.get_workflow_tool_executions("tenant-1", "run-1", "parent-row")

    assert [execution.id for execution in top_level] == ["parent-row", "top-level-row"]
    assert [execution.id for execution in children] == ["child-row"]
