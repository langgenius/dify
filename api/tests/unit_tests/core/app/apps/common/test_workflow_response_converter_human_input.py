from datetime import UTC, datetime

from core.app.app_config.entities import WorkflowUIBasedAppConfig
from core.app.entities.app_invoke_entities import InvokeFrom, WorkflowAppGenerateEntity
from core.app.entities.queue_entities import QueueHumanInputFormFilledEvent, QueueHumanInputFormTimeoutEvent
from core.workflow.system_variables import build_system_variables
from graphon.entities import WorkflowStartReason
from graphon.variables.segments import StringSegment
from models.account import Account
from models.model import AppMode
from services.workflow_runtime.response_converter import WorkflowResponseConverter


def _build_converter() -> WorkflowResponseConverter:
    system_variables = build_system_variables(
        files=[],
        user_id="user-1",
        app_id="app-1",
        workflow_id="wf-1",
        workflow_execution_id="run-1",
    )
    app_entity = WorkflowAppGenerateEntity(
        task_id="task-1",
        app_config=WorkflowUIBasedAppConfig(
            app_id="app-1", tenant_id="tenant-1", workflow_id="wf-1", app_mode=AppMode.WORKFLOW
        ),
        invoke_from=InvokeFrom.EXPLORE,
        files=[],
        inputs={},
        workflow_execution_id="run-1",
        call_depth=0,
        user_id="user-1",
        stream=True,
    )
    account = Account(name="tester", email="tester@example.com")
    account.id = "acc-1"
    return WorkflowResponseConverter(
        application_generate_entity=app_entity,
        user=account,
        system_variables=system_variables,
    )


def test_human_input_form_filled_stream_response_contains_rendered_content() -> None:
    converter = _build_converter()
    converter.workflow_start_to_stream_response(
        task_id="task-1",
        workflow_run_id="run-1",
        workflow_id="wf-1",
        reason=WorkflowStartReason.INITIAL,
    )

    queue_event = QueueHumanInputFormFilledEvent(
        form_id="form-1",
        node_id="node-1",
        node_type="human-input",
        node_title="Human Input",
        rendered_content="# Title\nvalue",
        action_id="Approve",
        action_text="Approve",
    )

    resp = converter.human_input_form_filled_to_stream_response(event=queue_event, task_id="task-1")

    assert resp.workflow_run_id == "run-1"
    assert resp.data.form_id == "form-1"
    assert resp.data.node_id == "node-1"
    assert resp.data.node_title == "Human Input"
    assert resp.data.rendered_content.startswith("# Title")
    assert resp.data.action_id == "Approve"


def test_human_input_form_filled_stream_response_serializes_submitted_data() -> None:
    converter = _build_converter()
    converter.workflow_start_to_stream_response(
        task_id="task-1",
        workflow_run_id="run-1",
        workflow_id="wf-1",
        reason=WorkflowStartReason.INITIAL,
    )

    queue_event = QueueHumanInputFormFilledEvent(
        form_id="form-1",
        node_id="node-1",
        node_type="human-input",
        node_title="Human Input",
        rendered_content="# Title\nvalue",
        action_id="Approve",
        action_text="Approve",
        submitted_data={
            "decision": StringSegment(value="approve"),
            "comment": StringSegment(value="looks good"),
        },
    )

    resp = converter.human_input_form_filled_to_stream_response(event=queue_event, task_id="task-1")

    assert resp.data.submitted_data == {
        "decision": "approve",
        "comment": "looks good",
    }


def test_human_input_form_timeout_stream_response_contains_timeout_metadata() -> None:
    converter = _build_converter()
    converter.workflow_start_to_stream_response(
        task_id="task-1",
        workflow_run_id="run-1",
        workflow_id="wf-1",
        reason=WorkflowStartReason.INITIAL,
    )

    queue_event = QueueHumanInputFormTimeoutEvent(
        form_id="form-1",
        node_id="node-1",
        node_type="human-input",
        node_title="Human Input",
        expiration_time=datetime(2025, 1, 1, tzinfo=UTC),
    )

    resp = converter.human_input_form_timeout_to_stream_response(event=queue_event, task_id="task-1")

    assert resp.workflow_run_id == "run-1"
    assert resp.data.form_id == "form-1"
    assert resp.data.node_id == "node-1"
    assert resp.data.node_title == "Human Input"
    assert resp.data.expiration_time == 1735689600
