from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from core.app.apps.common import workflow_response_converter
from core.app.apps.common.workflow_response_converter import WorkflowResponseConverter
from core.app.apps.workflow.app_runner import WorkflowAppRunner
from core.app.entities.app_invoke_entities import InvokeFrom
from core.app.entities.queue_entities import QueueWorkflowPausedEvent
from core.app.entities.task_entities import HumanInputRequiredResponse, WorkflowPauseStreamResponse
from core.workflow.entities.pause_reason import HumanInputRequired
from core.workflow.entities.workflow_start_reason import WorkflowStartReason
from core.workflow.graph_events.graph import GraphRunPausedEvent
from core.workflow.nodes.human_input.entities import FormInput, UserAction
from core.workflow.nodes.human_input.enums import FormInputType
from core.workflow.system_variable import SystemVariable
from models.account import Account


class _RecordingWorkflowAppRunner(WorkflowAppRunner):
    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self.published_events = []

    def _publish_event(self, event):
        self.published_events.append(event)


class _FakeRuntimeState:
    def get_paused_nodes(self):
        return ["node-pause-1"]


def _build_runner():
    app_entity = SimpleNamespace(
        app_config=SimpleNamespace(app_id="app-id"),
        inputs={},
        files=[],
        invoke_from=InvokeFrom.SERVICE_API,
        single_iteration_run=None,
        single_loop_run=None,
        workflow_execution_id="run-id",
        user_id="user-id",
    )
    workflow = SimpleNamespace(
        graph_dict={},
        tenant_id="tenant-id",
        environment_variables={},
        id="workflow-id",
    )
    queue_manager = SimpleNamespace(publish=lambda event, pub_from: None)
    return _RecordingWorkflowAppRunner(
        application_generate_entity=app_entity,
        queue_manager=queue_manager,
        variable_loader=MagicMock(),
        workflow=workflow,
        system_user_id="sys-user",
        root_node_id=None,
        workflow_execution_repository=MagicMock(),
        workflow_node_execution_repository=MagicMock(),
        graph_engine_layers=(),
        graph_runtime_state=None,
    )


def test_graph_run_paused_event_emits_queue_pause_event():
    runner = _build_runner()
    reason = HumanInputRequired(
        form_id="form-1",
        form_content="content",
        inputs=[],
        actions=[],
        node_id="node-human",
        node_title="Human Step",
        form_token="tok",
    )
    event = GraphRunPausedEvent(reasons=[reason], outputs={"foo": "bar"})
    workflow_entry = SimpleNamespace(
        graph_engine=SimpleNamespace(graph_runtime_state=_FakeRuntimeState()),
    )

    runner._handle_event(workflow_entry, event)

    assert len(runner.published_events) == 1
    queue_event = runner.published_events[0]
    assert isinstance(queue_event, QueueWorkflowPausedEvent)
    assert queue_event.reasons == [reason]
    assert queue_event.outputs == {"foo": "bar"}
    assert queue_event.paused_nodes == ["node-pause-1"]


def _build_converter():
    application_generate_entity = SimpleNamespace(
        inputs={},
        files=[],
        invoke_from=InvokeFrom.SERVICE_API,
        app_config=SimpleNamespace(app_id="app-id", tenant_id="tenant-id"),
    )
    system_variables = SystemVariable(
        user_id="user",
        app_id="app-id",
        workflow_id="workflow-id",
        workflow_execution_id="run-id",
    )
    user = MagicMock(spec=Account)
    user.id = "account-id"
    user.name = "Tester"
    user.email = "tester@example.com"
    return WorkflowResponseConverter(
        application_generate_entity=application_generate_entity,
        user=user,
        system_variables=system_variables,
    )


def test_queue_workflow_paused_event_to_stream_responses(monkeypatch: pytest.MonkeyPatch):
    converter = _build_converter()
    converter.workflow_start_to_stream_response(
        task_id="task",
        workflow_run_id="run-id",
        workflow_id="workflow-id",
        reason=WorkflowStartReason.INITIAL,
    )

    expiration_time = datetime(2024, 1, 1, tzinfo=UTC)

    class _FakeSession:
        def execute(self, _stmt):
            return [("form-1", expiration_time)]

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

    monkeypatch.setattr(workflow_response_converter, "Session", lambda **_: _FakeSession())
    monkeypatch.setattr(workflow_response_converter, "db", SimpleNamespace(engine=object()))

    reason = HumanInputRequired(
        form_id="form-1",
        form_content="Rendered",
        inputs=[
            FormInput(type=FormInputType.TEXT_INPUT, output_variable_name="field", default=None),
        ],
        actions=[UserAction(id="approve", title="Approve")],
        display_in_ui=True,
        node_id="node-id",
        node_title="Human Step",
        form_token="token",
    )
    queue_event = QueueWorkflowPausedEvent(
        reasons=[reason],
        outputs={"answer": "value"},
        paused_nodes=["node-id"],
    )

    runtime_state = SimpleNamespace(total_tokens=0, node_run_steps=0)
    responses = converter.workflow_pause_to_stream_response(
        event=queue_event,
        task_id="task",
        graph_runtime_state=runtime_state,
    )

    assert isinstance(responses[-1], WorkflowPauseStreamResponse)
    pause_resp = responses[-1]
    assert pause_resp.workflow_run_id == "run-id"
    assert pause_resp.data.paused_nodes == ["node-id"]
    assert pause_resp.data.outputs == {}
    assert pause_resp.data.reasons[0]["form_id"] == "form-1"
    assert pause_resp.data.reasons[0]["display_in_ui"] is True

    assert isinstance(responses[0], HumanInputRequiredResponse)
    hi_resp = responses[0]
    assert hi_resp.data.form_id == "form-1"
    assert hi_resp.data.node_id == "node-id"
    assert hi_resp.data.node_title == "Human Step"
    assert hi_resp.data.inputs[0].output_variable_name == "field"
    assert hi_resp.data.actions[0].id == "approve"
    assert hi_resp.data.display_in_ui is True
    assert hi_resp.data.expiration_time == int(expiration_time.timestamp())
