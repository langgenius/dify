from unittest.mock import MagicMock

import pytest

from core.app.entities.app_invoke_entities import DifyRunContext, InvokeFrom, UserFrom
from core.workflow.nodes.agent_v2 import workspace_retirement_layer as layer_module
from core.workflow.nodes.agent_v2.workspace_retirement_layer import WorkflowAgentWorkspaceRetirementLayer
from core.workflow.system_variables import build_system_variables
from graphon.enums import BuiltinNodeTypes
from graphon.graph_engine.command_channels import InMemoryChannel
from graphon.graph_events import GraphRunSucceededEvent, NodeRunStartedEvent
from graphon.runtime import GraphRuntimeState, ReadOnlyGraphRuntimeStateWrapper, VariablePool
from libs.datetime_utils import naive_utc_now


def _run_context() -> DifyRunContext:
    return DifyRunContext(
        tenant_id="tenant-1",
        app_id="app-1",
        user_id="account-1",
        user_from=UserFrom.ACCOUNT,
        invoke_from=InvokeFrom.DEBUGGER,
    )


@pytest.fixture
def runtime_state() -> ReadOnlyGraphRuntimeStateWrapper:
    return ReadOnlyGraphRuntimeStateWrapper(
        GraphRuntimeState(
            variable_pool=VariablePool.from_bootstrap(
                system_variables=build_system_variables(workflow_execution_id="workflow-run-1")
            ),
            start_at=0,
        )
    )


def test_terminal_event_retires_workflow_workspace(
    monkeypatch: pytest.MonkeyPatch, runtime_state: ReadOnlyGraphRuntimeStateWrapper
) -> None:
    store = MagicMock()
    events: list[str] = []
    store.retire_workflow_run.side_effect = lambda **_kwargs: events.append("retire") or ["workspace-1"]
    enqueue = MagicMock(side_effect=lambda **_kwargs: events.append("enqueue"))
    monkeypatch.setattr(layer_module, "WorkflowAgentWorkspaceStore", MagicMock(return_value=store))
    monkeypatch.setattr(layer_module, "enqueue_agent_resource_collection", enqueue)
    layer = WorkflowAgentWorkspaceRetirementLayer(dify_run_context=_run_context())
    layer.initialize(runtime_state, InMemoryChannel())

    layer.on_event(GraphRunSucceededEvent())

    store.retire_workflow_run.assert_called_once_with(
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_run_id="workflow-run-1",
    )
    enqueue.assert_called_once_with(tenant_id="tenant-1", workspace_ids=["workspace-1"])
    assert events == ["retire", "enqueue"]


def test_non_terminal_event_does_not_retire_workspace(monkeypatch: pytest.MonkeyPatch) -> None:
    store = MagicMock()
    monkeypatch.setattr(layer_module, "WorkflowAgentWorkspaceStore", MagicMock(return_value=store))
    layer = WorkflowAgentWorkspaceRetirementLayer(dify_run_context=_run_context())

    layer.on_event(
        NodeRunStartedEvent(
            id="execution-1",
            node_id="node-1",
            node_type=BuiltinNodeTypes.START,
            node_title="Start",
            start_at=naive_utc_now(),
        )
    )

    store.retire_workflow_run.assert_not_called()


def test_terminal_retirement_failure_does_not_replace_terminal_event(
    monkeypatch: pytest.MonkeyPatch, runtime_state: ReadOnlyGraphRuntimeStateWrapper
) -> None:
    store = MagicMock()
    store.retire_workflow_run.side_effect = RuntimeError("database unavailable")
    log_exception = MagicMock()
    enqueue = MagicMock()
    monkeypatch.setattr(layer_module, "WorkflowAgentWorkspaceStore", MagicMock(return_value=store))
    monkeypatch.setattr(layer_module.logger, "exception", log_exception)
    monkeypatch.setattr(layer_module, "enqueue_agent_resource_collection", enqueue)
    layer = WorkflowAgentWorkspaceRetirementLayer(dify_run_context=_run_context())
    layer.initialize(runtime_state, InMemoryChannel())

    layer.on_event(GraphRunSucceededEvent())

    log_exception.assert_called_once_with(
        "Failed to retire Workflow Agent Workspaces",
        extra={
            "tenant_id": "tenant-1",
            "app_id": "app-1",
            "workflow_run_id": "workflow-run-1",
        },
    )
    enqueue.assert_not_called()
