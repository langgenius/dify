import json
from datetime import datetime, timedelta

import pytest

from core.app.app_config.entities import WorkflowUIBasedAppConfig
from core.app.apps.common import workflow_response_converter
from core.app.apps.common.workflow_response_converter import WorkflowResponseConverter
from core.app.entities.app_invoke_entities import InvokeFrom, WorkflowAppGenerateEntity
from core.app.entities.queue_entities import (
    NodeExecutionSnapshot,
    QueueNodeStartedEvent,
    QueueNodeSucceededEvent,
    QueueWorkflowStartedEvent,
)
from core.workflow.system_variables import build_system_variables
from graphon.entities import WorkflowStartReason
from graphon.enums import BuiltinNodeTypes
from models import AppMode
from models.account import Account
from models.workflow import WorkflowNodeExecutionModel


def _build_converter() -> WorkflowResponseConverter:
    """Construct a minimal WorkflowResponseConverter for testing."""
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
        user_id="acc-1",
        stream=True,
        invoke_from=InvokeFrom.EXPLORE,
        files=[],
        inputs={},
        workflow_execution_id="run-1",
        call_depth=0,
    )
    account = Account(name="tester", email="tester@example.com")
    account.id = "acc-1"
    return WorkflowResponseConverter(
        application_generate_entity=app_entity,
        user=account,
        system_variables=system_variables,
    )


def test_workflow_start_stream_response_carries_resumption_reason():
    converter = _build_converter()
    resp = converter.workflow_start_to_stream_response(
        task_id="task-1",
        workflow_run_id="run-1",
        workflow_id="wf-1",
        reason=WorkflowStartReason.RESUMPTION,
    )
    assert resp.data.reason is WorkflowStartReason.RESUMPTION


def test_workflow_start_stream_response_carries_initial_reason():
    converter = _build_converter()
    resp = converter.workflow_start_to_stream_response(
        task_id="task-1",
        workflow_run_id="run-1",
        workflow_id="wf-1",
        reason=WorkflowStartReason.INITIAL,
    )
    assert resp.data.reason is WorkflowStartReason.INITIAL


def test_node_start_preserves_the_allocated_index_when_events_arrive_out_of_order():
    converter = _build_converter()
    converter.workflow_start_to_stream_response(
        task_id="task-1", workflow_run_id="run-1", workflow_id="wf-1", reason=WorkflowStartReason.INITIAL
    )
    for index in (7, 3):
        response = converter.workflow_node_start_to_stream_response(
            task_id="task-1",
            event=QueueNodeStartedEvent(
                node_execution_id=f"execution-{index}",
                node_id=f"node-{index}",
                node_title="Start",
                node_type=BuiltinNodeTypes.START,
                node_run_index=index,
                start_at=datetime(2026, 9, 7),
                provider_type="",
                provider_id="",
            ),
        )
        assert response is not None
        assert response.data.index == index


@pytest.mark.parametrize("provider_type", ["workflow", "builtin"])
def test_workflow_tool_detail_hint_in_live_and_saved_traces(monkeypatch, provider_type):
    monkeypatch.setattr(workflow_response_converter.ToolManager, "get_tool_icon", lambda **_kwargs: "icon")
    converter = _build_converter()
    converter.workflow_start_to_stream_response(
        task_id="task-1", workflow_run_id="run-1", workflow_id="wf-1", reason=WorkflowStartReason.INITIAL
    )
    response = converter.workflow_node_start_to_stream_response(
        task_id="task-1",
        event=QueueNodeStartedEvent(
            node_execution_id="tool-execution",
            node_id="tool",
            node_title="Tool",
            node_type=BuiltinNodeTypes.TOOL,
            start_at=datetime(2026, 9, 7),
            provider_type=provider_type,
            provider_id="provider-1",
        ),
    )
    saved = WorkflowNodeExecutionModel(
        node_type=BuiltinNodeTypes.TOOL,
        execution_metadata=json.dumps({"tool_info": {"provider_type": provider_type, "provider_id": "provider-1"}}),
    )
    assert response is not None
    assert response.data.extras == saved.extras
    assert response.data.extras.get("workflow_tool", False) == (provider_type == "workflow")


@pytest.mark.parametrize("next_node_already_persisted", [False, True])
def test_resumed_node_metadata_and_sequence(next_node_already_persisted):
    started_at = datetime(2026, 9, 7)
    converter = _build_converter()
    converter.workflow_start_to_stream_response(
        task_id="task-1", workflow_run_id="run-1", workflow_id="wf-1", reason=WorkflowStartReason.INITIAL
    )

    def node_start(execution_id, title, node_type, index):
        return QueueNodeStartedEvent(
            node_execution_id=execution_id,
            node_id=execution_id,
            node_run_index=index,
            node_title=title,
            node_type=node_type,
            start_at=started_at,
            provider_type="workflow",
            provider_id="tool-1",
        )

    request = node_start("request", "Request", BuiltinNodeTypes.START, 1)
    tool = node_start("tool", "Approval tool", BuiltinNodeTypes.TOOL, 2)
    for index, event in enumerate((request, tool), start=1):
        response = converter.workflow_node_start_to_stream_response(event=event, task_id="task-1")
        assert response is not None
        assert response.data.index == index

    snapshots = [
        NodeExecutionSnapshot(execution_id="request", title="Request", index=1, start_at=started_at),
        NodeExecutionSnapshot(execution_id="tool", title="Approval tool", index=2, start_at=started_at),
    ]
    if next_node_already_persisted:
        snapshots.append(NodeExecutionSnapshot(execution_id="end", title="Result", index=3, start_at=started_at))
    # Resume history survives the actual queued event's serialization boundary.
    queued = QueueWorkflowStartedEvent.model_validate_json(
        QueueWorkflowStartedEvent(node_execution_snapshots=tuple(snapshots)).model_dump_json()
    )

    converter = _build_converter()
    converter.workflow_start_to_stream_response(
        task_id="task-1",
        workflow_run_id="run-1",
        workflow_id="wf-1",
        reason=WorkflowStartReason.RESUMPTION,
        node_execution_snapshots=queued.node_execution_snapshots,
    )
    response = converter.workflow_node_finish_to_stream_response(
        event=QueueNodeSucceededEvent(
            node_execution_id="tool",
            node_id="tool",
            node_type=BuiltinNodeTypes.TOOL,
            start_at=started_at,
            finished_at=started_at + timedelta(seconds=4),
            outputs={"decision": "approve"},
        ),
        task_id="task-1",
    )
    assert response is not None
    assert (response.data.title, response.data.index, response.data.elapsed_time) == ("Approval tool", 2, 4)
    assert response.data.outputs == {"decision": "approve"}

    for index, execution_id in enumerate(("end", "next"), start=3):
        response = converter.workflow_node_start_to_stream_response(
            event=node_start(execution_id, "Result", BuiltinNodeTypes.END, index), task_id="task-1"
        )
        assert response is not None
        assert response.data.index == index
