import datetime
import json
import time
from collections.abc import Generator
from unittest.mock import MagicMock, patch

import pytest

from extensions.logstore.repositories.logstore_api_workflow_node_execution_repository import (
    LogstoreAPIWorkflowNodeExecutionRepository,
    _dict_to_workflow_node_execution_model,
)
from models.workflow import WorkflowNodeExecutionModel


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
