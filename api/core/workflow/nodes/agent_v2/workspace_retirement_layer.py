"""Retire Workflow Agent Workspaces when the Workflow Run terminates."""

from __future__ import annotations

import logging
from typing import override

from core.app.entities.app_invoke_entities import DifyRunContext
from core.workflow.nodes.agent_v2.session_store import WorkflowAgentWorkspaceStore
from core.workflow.system_variables import SystemVariableKey, get_system_text
from graphon.engine.layer import Layer
from graphon.engine_events import (
    EngineEvent,
    GraphRunAbortedEvent,
    GraphRunFailedEvent,
    GraphRunPartialSucceededEvent,
    GraphRunSucceededEvent,
)
from tasks.collect_agent_resources_task import enqueue_agent_resource_collection

logger = logging.getLogger(__name__)


class WorkflowAgentWorkspaceRetirementLayer(Layer):
    """Synchronously retire run Workspaces, then enqueue physical collection."""

    _TERMINAL_EVENTS = (
        GraphRunSucceededEvent,
        GraphRunPartialSucceededEvent,
        GraphRunFailedEvent,
        GraphRunAbortedEvent,
    )

    def __init__(
        self,
        *,
        dify_run_context: DifyRunContext,
    ) -> None:
        super().__init__()
        self._dify_run_context = dify_run_context

    @override
    def on_event(self, event: EngineEvent) -> None:
        if not isinstance(event, self._TERMINAL_EVENTS):
            return
        workflow_run_id = get_system_text(
            self.runtime_state.variable_pool,
            SystemVariableKey.WORKFLOW_EXECUTION_ID,
        )
        if not workflow_run_id:
            logger.warning("Skipping Workflow Agent Workspace retirement: workflow_run_id is missing")
            return
        try:
            workspace_ids = WorkflowAgentWorkspaceStore().retire_workflow_run(
                tenant_id=self._dify_run_context.tenant_id,
                app_id=self._dify_run_context.app_id,
                workflow_run_id=workflow_run_id,
            )
        except Exception:
            logger.exception(
                "Failed to retire Workflow Agent Workspaces",
                extra={
                    "tenant_id": self._dify_run_context.tenant_id,
                    "app_id": self._dify_run_context.app_id,
                    "workflow_run_id": workflow_run_id,
                },
            )
            return
        enqueue_agent_resource_collection(
            tenant_id=self._dify_run_context.tenant_id,
            workspace_ids=workspace_ids,
        )


def retire_standalone_node_execution_workspaces(*, tenant_id: str, app_id: str, node_execution_id: str) -> None:
    """Retire a finished single-step preview's Workspaces, then enqueue physical collection.

    Preconditions: the node execution is terminal; single-step previews run
    synchronously and cannot pause, so no later step reuses the Workspace.
    Postconditions: its ACTIVE Workspaces and Bindings are RETIRED and committed
    before collection is enqueued. Failures are logged and swallowed, like the
    run layer, so cleanup never replaces the preview's own result or error.
    """
    try:
        workspace_ids = WorkflowAgentWorkspaceStore().retire_standalone_node_execution(
            tenant_id=tenant_id,
            app_id=app_id,
            node_execution_id=node_execution_id,
        )
        enqueue_agent_resource_collection(tenant_id=tenant_id, workspace_ids=workspace_ids)
    except Exception:
        logger.exception(
            "Failed to retire single-step Workflow Agent Workspaces",
            extra={"tenant_id": tenant_id, "app_id": app_id, "node_execution_id": node_execution_id},
        )


def build_workflow_agent_workspace_retirement_layer(
    *, dify_run_context: DifyRunContext
) -> WorkflowAgentWorkspaceRetirementLayer:
    return WorkflowAgentWorkspaceRetirementLayer(dify_run_context=dify_run_context)


__all__ = [
    "WorkflowAgentWorkspaceRetirementLayer",
    "build_workflow_agent_workspace_retirement_layer",
    "retire_standalone_node_execution_workspaces",
]
