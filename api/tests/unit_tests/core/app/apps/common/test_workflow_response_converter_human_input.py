from datetime import UTC, datetime
from types import SimpleNamespace

from core.app.apps.common.workflow_response_converter import WorkflowResponseConverter
from core.app.entities.app_invoke_entities import InvokeFrom
from core.app.entities.queue_entities import QueueHumanInputFormFilledEvent, QueueHumanInputFormTimeoutEvent
from core.workflow.entities.workflow_start_reason import WorkflowStartReason
from core.workflow.runtime import GraphRuntimeState, VariablePool
from core.workflow.system_variable import SystemVariable


def _build_converter():
    system_variables = SystemVariable(
        files=[],
        user_id="user-1",
        app_id="app-1",
        workflow_id="wf-1",
        workflow_execution_id="run-1",
    )
    runtime_state = GraphRuntimeState(variable_pool=VariablePool(), start_at=0.0)
    app_entity = SimpleNamespace(
        task_id="task-1",
        app_config=SimpleNamespace(app_id="app-1", tenant_id="tenant-1"),
        invoke_from=InvokeFrom.EXPLORE,
        files=[],
        inputs={},
        workflow_execution_id="run-1",
        call_depth=0,
    )
    account = SimpleNamespace(id="acc-1", name="tester", email="tester@example.com")
    return WorkflowResponseConverter(
        application_generate_entity=app_entity,
        user=account,
        system_variables=system_variables,
    )


def test_human_input_form_filled_stream_response_contains_rendered_content():
    converter = _build_converter()
    converter.workflow_start_to_stream_response(
        task_id="task-1",
        workflow_run_id="run-1",
        workflow_id="wf-1",
        reason=WorkflowStartReason.INITIAL,
    )

    queue_event = QueueHumanInputFormFilledEvent(
        node_execution_id="exec-1",
        node_id="node-1",
        node_type="human-input",
        node_title="Human Input",
        rendered_content="# Title\nvalue",
        action_id="Approve",
        action_text="Approve",
    )

    resp = converter.human_input_form_filled_to_stream_response(event=queue_event, task_id="task-1")

    assert resp.workflow_run_id == "run-1"
    assert resp.data.node_id == "node-1"
    assert resp.data.node_title == "Human Input"
    assert resp.data.rendered_content.startswith("# Title")
    assert resp.data.action_id == "Approve"


def test_human_input_form_timeout_stream_response_contains_timeout_metadata():
    converter = _build_converter()
    converter.workflow_start_to_stream_response(
        task_id="task-1",
        workflow_run_id="run-1",
        workflow_id="wf-1",
        reason=WorkflowStartReason.INITIAL,
    )

    queue_event = QueueHumanInputFormTimeoutEvent(
        node_id="node-1",
        node_type="human-input",
        node_title="Human Input",
        expiration_time=datetime(2025, 1, 1, tzinfo=UTC),
    )

    resp = converter.human_input_form_timeout_to_stream_response(event=queue_event, task_id="task-1")

    assert resp.workflow_run_id == "run-1"
    assert resp.data.node_id == "node-1"
    assert resp.data.node_title == "Human Input"
    assert resp.data.expiration_time == 1735689600
