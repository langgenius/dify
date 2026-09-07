from controllers.service_api.app.workflow import WorkflowRunResponse
from graphon.enums import WorkflowExecutionStatus
from libs.helper import dump_response
from models.workflow import WorkflowRun


def _workflow_run(status: WorkflowExecutionStatus, outputs: str | None = '{"foo": "bar"}') -> WorkflowRun:
    return WorkflowRun(
        id="run-id",
        workflow_id="workflow-id",
        status=status,
        inputs="{}",
        outputs=outputs,
        error=None,
        total_steps=1,
        total_tokens=2,
        elapsed_time=3.5,
    )


def test_workflow_run_serializer_normalizes_status_enum() -> None:
    response = dump_response(WorkflowRunResponse, _workflow_run(WorkflowExecutionStatus.PAUSED))

    assert response["status"] == "paused"


def test_workflow_run_serializer_paused_returns_empty_outputs() -> None:
    response = dump_response(WorkflowRunResponse, _workflow_run(WorkflowExecutionStatus.PAUSED))

    assert response["outputs"] == {}


def test_workflow_run_serializer_running_returns_outputs() -> None:
    response = dump_response(WorkflowRunResponse, _workflow_run(WorkflowExecutionStatus.RUNNING))

    assert response["outputs"] == {"foo": "bar"}
