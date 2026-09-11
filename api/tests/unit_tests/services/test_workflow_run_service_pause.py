"""Tests for Console workflow pause details."""

from datetime import datetime
from unittest.mock import MagicMock

import pytest

from core.workflow.nodes.human_input.pause_reason import HumanInputRequired
from graphon.entities.pause_reason import SchedulingPause
from graphon.enums import WorkflowExecutionStatus
from machinery.context import RequestContext
from repositories.sqlalchemy_api_workflow_run_repository import WorkflowRunPauseRecord
from services.workflow_run_service import (
    WorkflowRunPauseDetails,
    WorkflowRunPausedNode,
    WorkflowRunService,
)


@pytest.fixture
def workflow_runs() -> MagicMock:
    return MagicMock()


def _service(workflow_runs: MagicMock) -> WorkflowRunService:
    return WorkflowRunService(
        workflow_runs=workflow_runs,
        node_executions=MagicMock(),
    )


def _request_context(*, workspace_id: str = "tenant-1") -> RequestContext:
    return RequestContext(
        request_id="request-1",
        trace_id="trace-1",
        account_id="account-1",
        active_workspace_id=workspace_id,
    )


def test_get_pause_details_returns_none_when_run_is_not_found(workflow_runs: MagicMock) -> None:
    workflow_runs.get_pause_record.return_value = None

    result = _service(workflow_runs).get_pause_details(_request_context(), workflow_run_id="run-1")

    assert result is None
    workflow_runs.get_pause_record.assert_called_once_with(
        workspace_id="tenant-1",
        workflow_run_id="run-1",
    )


def test_get_pause_details_returns_empty_details_for_non_paused_run(workflow_runs: MagicMock) -> None:
    workflow_runs.get_pause_record.return_value = WorkflowRunPauseRecord(
        status=WorkflowExecutionStatus.SUCCEEDED,
        paused_at=None,
        reasons=(),
        form_tokens={},
    )

    result = _service(workflow_runs).get_pause_details(_request_context(), workflow_run_id="run-1")

    assert result == WorkflowRunPauseDetails(paused_at=None, paused_nodes=())


def test_get_pause_details_maps_human_input_and_token(workflow_runs: MagicMock) -> None:
    reason = HumanInputRequired(
        form_id="form-1",
        form_content="Approve?",
        node_id="node-1",
        node_title="Approval",
    )
    paused_at = datetime(2026, 1, 2, 3, 4, 5)
    workflow_runs.get_pause_record.return_value = WorkflowRunPauseRecord(
        status=WorkflowExecutionStatus.PAUSED,
        paused_at=paused_at,
        reasons=(reason,),
        form_tokens={"form-1": "form-token"},
    )

    result = _service(workflow_runs).get_pause_details(
        _request_context(workspace_id="tenant-context"),
        workflow_run_id="run-1",
    )

    assert result == WorkflowRunPauseDetails(
        paused_at=paused_at,
        paused_nodes=(
            WorkflowRunPausedNode(
                node_id="node-1",
                node_title="Approval",
                form_id="form-1",
                form_token="form-token",
            ),
        ),
    )
    workflow_runs.get_pause_record.assert_called_once_with(
        workspace_id="tenant-context",
        workflow_run_id="run-1",
    )


def test_get_pause_details_rejects_unsupported_pause_reason(workflow_runs: MagicMock) -> None:
    workflow_runs.get_pause_record.return_value = WorkflowRunPauseRecord(
        status=WorkflowExecutionStatus.PAUSED,
        paused_at=None,
        reasons=(SchedulingPause(message="Waiting for external input"),),
        form_tokens={},
    )

    with pytest.raises(NotImplementedError, match="Pause details do not support SchedulingPause"):
        _service(workflow_runs).get_pause_details(_request_context(), workflow_run_id="run-1")
