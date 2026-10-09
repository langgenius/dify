"""Tests for Console workflow pause details."""

from datetime import datetime
from unittest.mock import ANY, MagicMock

import pytest

from core.workflow.nodes.human_input.pause_reason import HumanInputRequired
from graphon.entities.pause_reason import SchedulingPause
from graphon.enums import WorkflowExecutionStatus
from graphon.runtime import GraphRuntimeState, VariablePool
from machinery.context import RequestContext
from repositories.sqlalchemy_api_workflow_run_repository import WorkflowRunPauseRecord
from services.workflow_pause_service import WorkflowPauseSnapshot
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
        session_factory=MagicMock(),
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
        ANY,
        workspace_id="tenant-1",
        workflow_run_id="run-1",
    )


@pytest.mark.parametrize("status", [WorkflowExecutionStatus.SUCCEEDED, WorkflowExecutionStatus.PAUSED])
def test_get_pause_details_returns_empty_details_without_an_active_pause(workflow_runs: MagicMock, status) -> None:
    workflow_runs.get_pause_record.return_value = WorkflowRunPauseRecord(
        status=status,
        pause=None,
    )

    result = _service(workflow_runs).get_pause_details(_request_context(), workflow_run_id="run-1")

    assert result == WorkflowRunPauseDetails(paused_at=None, paused_nodes=())


def test_get_pause_details_maps_human_input_and_token(
    workflow_runs: MagicMock, monkeypatch: pytest.MonkeyPatch
) -> None:
    reason = HumanInputRequired(
        form_id="form-1",
        form_content="Approve?",
        node_id="node-1",
        node_title="Approval",
    )
    paused_at = datetime(2026, 1, 2, 3, 4, 5)
    pause = MagicMock()
    pause.paused_at = paused_at
    workflow_runs.get_pause_record.return_value = WorkflowRunPauseRecord(
        status=WorkflowExecutionStatus.PAUSED,
        pause=pause,
    )
    workflow_runs.get_legacy_form_tokens.return_value = {"form-1": "form-token"}
    monkeypatch.setattr(
        "services.workflow_run_service.load_workflow_pause_snapshot",
        lambda *_args, **_kwargs: WorkflowPauseSnapshot(
            runtime_state=GraphRuntimeState(variable_pool=VariablePool(), start_at=0),
            reasons=(reason,),
            v2_forms={},
        ),
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
        ANY,
        workspace_id="tenant-context",
        workflow_run_id="run-1",
    )


def test_get_pause_details_rejects_unsupported_pause_reason(
    workflow_runs: MagicMock, monkeypatch: pytest.MonkeyPatch
) -> None:
    workflow_runs.get_pause_record.return_value = WorkflowRunPauseRecord(
        status=WorkflowExecutionStatus.PAUSED,
        pause=MagicMock(),
    )
    monkeypatch.setattr(
        "services.workflow_run_service.load_workflow_pause_snapshot",
        lambda *_args, **_kwargs: WorkflowPauseSnapshot(
            runtime_state=GraphRuntimeState(variable_pool=VariablePool(), start_at=0),
            reasons=(SchedulingPause(message="Waiting for external input"),),
            v2_forms={},
        ),
    )

    with pytest.raises(NotImplementedError, match="Pause details do not support SchedulingPause"):
        _service(workflow_runs).get_pause_details(_request_context(), workflow_run_id="run-1")
