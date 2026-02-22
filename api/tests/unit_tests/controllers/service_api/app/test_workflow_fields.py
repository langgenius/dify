from types import SimpleNamespace

from controllers.service_api.app.workflow import WorkflowRunOutputsField, WorkflowRunStatusField
from core.workflow.enums import WorkflowExecutionStatus


def test_workflow_run_status_field_with_enum() -> None:
    field = WorkflowRunStatusField()
    obj = SimpleNamespace(status=WorkflowExecutionStatus.PAUSED)

    assert field.output("status", obj) == "paused"


def test_workflow_run_outputs_field_paused_returns_empty() -> None:
    field = WorkflowRunOutputsField()
    obj = SimpleNamespace(status=WorkflowExecutionStatus.PAUSED, outputs_dict={"foo": "bar"})

    assert field.output("outputs", obj) == {}


def test_workflow_run_outputs_field_running_returns_outputs() -> None:
    field = WorkflowRunOutputsField()
    obj = SimpleNamespace(status=WorkflowExecutionStatus.RUNNING, outputs_dict={"foo": "bar"})

    assert field.output("outputs", obj) == {"foo": "bar"}
