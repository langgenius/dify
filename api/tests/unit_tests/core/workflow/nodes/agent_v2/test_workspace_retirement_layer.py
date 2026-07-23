from unittest.mock import MagicMock

from core.app.entities.app_invoke_entities import DifyRunContext, InvokeFrom, UserFrom
from core.workflow.nodes.agent_v2 import workspace_retirement_layer as layer_module
from core.workflow.nodes.agent_v2.workspace_retirement_layer import WorkflowAgentWorkspaceRetirementLayer
from graphon.graph_events import GraphRunSucceededEvent, NodeRunStartedEvent


def _run_context() -> DifyRunContext:
    return DifyRunContext(
        tenant_id="tenant-1",
        app_id="app-1",
        user_id="account-1",
        user_from=UserFrom.ACCOUNT,
        invoke_from=InvokeFrom.DEBUGGER,
    )


def test_terminal_event_retires_workflow_workspace(monkeypatch) -> None:
    store = MagicMock()
    events: list[str] = []
    store.retire_workflow_run.side_effect = lambda **_kwargs: events.append("retire") or ["workspace-1"]
    enqueue = MagicMock(side_effect=lambda **_kwargs: events.append("enqueue"))
    monkeypatch.setattr(layer_module, "WorkflowAgentWorkspaceStore", MagicMock(return_value=store))
    monkeypatch.setattr(layer_module, "enqueue_agent_resource_collection", enqueue)
    layer = WorkflowAgentWorkspaceRetirementLayer(dify_run_context=_run_context())
    layer.initialize(MagicMock(), MagicMock())
    monkeypatch.setattr(layer_module, "get_system_text", lambda *_: "workflow-run-1")

    layer.on_event(MagicMock(spec=GraphRunSucceededEvent))

    store.retire_workflow_run.assert_called_once_with(
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_run_id="workflow-run-1",
    )
    enqueue.assert_called_once_with(tenant_id="tenant-1", workspace_ids=["workspace-1"])
    assert events == ["retire", "enqueue"]


def test_non_terminal_event_does_not_retire_workspace(monkeypatch) -> None:
    store = MagicMock()
    monkeypatch.setattr(layer_module, "WorkflowAgentWorkspaceStore", MagicMock(return_value=store))
    layer = WorkflowAgentWorkspaceRetirementLayer(dify_run_context=_run_context())

    layer.on_event(MagicMock(spec=NodeRunStartedEvent))

    store.retire_workflow_run.assert_not_called()


def test_terminal_retirement_failure_does_not_replace_terminal_event(monkeypatch) -> None:
    store = MagicMock()
    store.retire_workflow_run.side_effect = RuntimeError("database unavailable")
    log_exception = MagicMock()
    enqueue = MagicMock()
    monkeypatch.setattr(layer_module, "WorkflowAgentWorkspaceStore", MagicMock(return_value=store))
    monkeypatch.setattr(layer_module.logger, "exception", log_exception)
    monkeypatch.setattr(layer_module, "enqueue_agent_resource_collection", enqueue)
    layer = WorkflowAgentWorkspaceRetirementLayer(dify_run_context=_run_context())
    layer.initialize(MagicMock(), MagicMock())
    monkeypatch.setattr(layer_module, "get_system_text", lambda *_: "workflow-run-1")

    layer.on_event(MagicMock(spec=GraphRunSucceededEvent))

    log_exception.assert_called_once_with(
        "Failed to retire Workflow Agent Workspaces",
        extra={
            "tenant_id": "tenant-1",
            "app_id": "app-1",
            "workflow_run_id": "workflow-run-1",
        },
    )
    enqueue.assert_not_called()
