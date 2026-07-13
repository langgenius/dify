from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace
from typing import cast
from unittest.mock import MagicMock

from core.app.workflow.retry_history import RETRY_HISTORY_PROCESS_DATA_KEY, WorkflowNodeRetryAttempt
from fields.workflow_run_fields import WorkflowRunNodeExecutionListResponse
from graphon.enums import WorkflowNodeExecutionStatus
from models.enums import CreatorUserRole
from models.workflow import WorkflowNodeExecutionModel
from repositories.api_workflow_node_execution_repository import DifyAPIWorkflowNodeExecutionRepository
from services.workflow_node_execution_trace_service import assemble_workflow_node_execution_traces


def _retry_attempt(retry_index: int, **overrides: object) -> dict[str, object]:
    values = {
        "retry_index": retry_index,
        "inputs": {"attempt": retry_index},
        "process_data": {"request": f"attempt-{retry_index}"},
        "outputs": {"status_code": 500, "body": f"failure-{retry_index}"},
        "error": f"attempt {retry_index} failed",
        "elapsed_time": float(retry_index),
        "execution_metadata": {},
        "created_at": 1_700_000_000 + retry_index,
        "finished_at": 1_700_000_010 + retry_index,
    }
    values.update(overrides)
    return WorkflowNodeRetryAttempt.model_validate(values).model_dump(mode="json")


def _execution(process_data: dict[str, object]) -> WorkflowNodeExecutionModel:
    return cast(
        WorkflowNodeExecutionModel,
        SimpleNamespace(
            id="exec-1",
            index=3,
            predecessor_node_id="previous-node",
            node_id="node-1",
            node_type="http-request",
            title="HTTP Request",
            inputs_dict={"attempt": 3},
            process_data_dict=process_data,
            outputs_dict={"status_code": 200, "body": "ok"},
            status=WorkflowNodeExecutionStatus.SUCCEEDED,
            error=None,
            elapsed_time=3.5,
            execution_metadata_dict={"iteration_id": "iteration-1"},
            extras={},
            created_at=datetime(2023, 11, 14, tzinfo=UTC),
            created_by_role=CreatorUserRole.ACCOUNT,
            created_by_account=None,
            created_by_end_user=None,
            finished_at=datetime(2023, 11, 14, 0, 0, 4, tzinfo=UTC),
            inputs_truncated=False,
            outputs_truncated=False,
            process_data_truncated=False,
            workflow_run_id="run-1",
        ),
    )


def _repository(full_process_data: dict[str, object] | None) -> DifyAPIWorkflowNodeExecutionRepository:
    repository = MagicMock()
    repository.load_full_process_data.return_value = full_process_data
    return cast(DifyAPIWorkflowNodeExecutionRepository, repository)


def test_assemble_expands_retry_history_before_terminal_trace() -> None:
    process_data = {
        "request": "successful-attempt",
        RETRY_HISTORY_PROCESS_DATA_KEY: [_retry_attempt(2), _retry_attempt(1)],
    }
    execution = _execution(process_data)
    repository = _repository(process_data)

    traces = assemble_workflow_node_execution_traces([execution], repository)

    assert [trace.id for trace in traces] == ["exec-1:retry:1", "exec-1:retry:2", "exec-1"]
    assert [trace.status for trace in traces] == ["retry", "retry", "succeeded"]
    assert traces[0].retry_index == 1
    assert traces[0].outputs == {"status_code": 500, "body": "failure-1"}
    assert traces[0].execution_metadata == {"iteration_id": "iteration-1"}
    assert RETRY_HISTORY_PROCESS_DATA_KEY not in traces[-1].process_data
    repository.load_full_process_data.assert_called_once_with(execution)


def test_assemble_keeps_old_execution_without_retry_history() -> None:
    process_data = {"request": "terminal"}
    execution = _execution(process_data)

    traces = assemble_workflow_node_execution_traces([execution], _repository(process_data))

    assert len(traces) == 1
    assert traces[0].id == "exec-1"
    assert traces[0].process_data == process_data


def test_assemble_skips_malformed_and_duplicate_retry_attempts() -> None:
    process_data = {
        RETRY_HISTORY_PROCESS_DATA_KEY: [
            _retry_attempt(2),
            {"retry_index": 0},
            _retry_attempt(1),
            _retry_attempt(1, error="duplicate"),
        ]
    }

    traces = assemble_workflow_node_execution_traces([_execution(process_data)], _repository(process_data))

    assert [trace.retry_index for trace in traces[:-1]] == [1, 2]
    assert traces[0].error == "attempt 1 failed"


def test_assemble_truncates_retry_attempt_fields() -> None:
    process_data = {RETRY_HISTORY_PROCESS_DATA_KEY: [_retry_attempt(1, outputs={"body": "x" * 2_000_000})]}

    traces = assemble_workflow_node_execution_traces([_execution(process_data)], _repository(process_data))

    assert traces[0].outputs_truncated is True
    assert traces[-1].id == "exec-1"


def test_assemble_falls_back_to_inline_process_data_when_loader_fails() -> None:
    process_data = {RETRY_HISTORY_PROCESS_DATA_KEY: [_retry_attempt(1)]}
    execution = _execution(process_data)
    repository = _repository(None)
    repository.load_full_process_data.side_effect = OSError("storage unavailable")

    traces = assemble_workflow_node_execution_traces([execution], repository)

    assert [trace.id for trace in traces] == ["exec-1:retry:1", "exec-1"]


def test_virtual_trace_validates_through_node_execution_response() -> None:
    process_data = {RETRY_HISTORY_PROCESS_DATA_KEY: [_retry_attempt(1)]}
    traces = assemble_workflow_node_execution_traces([_execution(process_data)], _repository(process_data))

    response = WorkflowRunNodeExecutionListResponse.model_validate({"data": traces}, from_attributes=True)

    assert response.data[0].retry_index == 1
