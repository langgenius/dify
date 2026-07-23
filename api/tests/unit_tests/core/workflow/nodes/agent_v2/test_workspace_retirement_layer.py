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
    delay = MagicMock()
    monkeypatch.setattr("tasks.retire_workflow_agents_task.retire_workflow_agent_workspaces.delay", delay)
    layer = WorkflowAgentWorkspaceRetirementLayer(dify_run_context=_run_context())
    layer.initialize(MagicMock(), MagicMock())
    monkeypatch.setattr(layer_module, "get_system_text", lambda *_: "workflow-run-1")

    layer.on_event(MagicMock(spec=GraphRunSucceededEvent))

    delay.assert_called_once_with(
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_run_id="workflow-run-1",
    )


def test_non_terminal_event_does_not_retire_workspace(monkeypatch) -> None:
    delay = MagicMock()
    monkeypatch.setattr("tasks.retire_workflow_agents_task.retire_workflow_agent_workspaces.delay", delay)
    layer = WorkflowAgentWorkspaceRetirementLayer(dify_run_context=_run_context())

    layer.on_event(MagicMock(spec=NodeRunStartedEvent))

    delay.assert_not_called()


def test_terminal_retirement_failure_does_not_replace_terminal_event(monkeypatch) -> None:
    delay = MagicMock(side_effect=RuntimeError("queue unavailable"))
    log_exception = MagicMock()
    monkeypatch.setattr("tasks.retire_workflow_agents_task.retire_workflow_agent_workspaces.delay", delay)
    monkeypatch.setattr(layer_module.logger, "exception", log_exception)
    layer = WorkflowAgentWorkspaceRetirementLayer(dify_run_context=_run_context())
    layer.initialize(MagicMock(), MagicMock())
    monkeypatch.setattr(layer_module, "get_system_text", lambda *_: "workflow-run-1")

    layer.on_event(MagicMock(spec=GraphRunSucceededEvent))

    log_exception.assert_called_once_with(
        "Failed to enqueue Workflow Agent Workspace retirement",
        extra={
            "tenant_id": "tenant-1",
            "app_id": "app-1",
            "workflow_run_id": "workflow-run-1",
        },
    )
