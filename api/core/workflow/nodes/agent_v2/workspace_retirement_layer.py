"""Retire Workflow Agent Workspaces when the Workflow Run terminates."""

from __future__ import annotations

import logging
from typing import override

from core.app.entities.app_invoke_entities import DifyRunContext
from core.workflow.nodes.agent_v2.session_store import WorkflowAgentWorkspaceStore
from core.workflow.system_variables import SystemVariableKey, get_system_text
from graphon.graph_engine.layers import GraphEngineLayer
from graphon.graph_events import (
    GraphEngineEvent,
    GraphRunAbortedEvent,
    GraphRunFailedEvent,
    GraphRunPartialSucceededEvent,
    GraphRunSucceededEvent,
)
from tasks.collect_agent_resources_task import enqueue_agent_resource_collection

logger = logging.getLogger(__name__)


class WorkflowAgentWorkspaceRetirementLayer(GraphEngineLayer):
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
    def on_graph_start(self) -> None:
        return

    @override
    def on_event(self, event: GraphEngineEvent) -> None:
        if not isinstance(event, self._TERMINAL_EVENTS):
            return
        workflow_run_id = get_system_text(
            self.graph_runtime_state.variable_pool,
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

    @override
    def on_graph_end(self, error: Exception | None) -> None:
        return


def build_workflow_agent_workspace_retirement_layer(
    *, dify_run_context: DifyRunContext
) -> WorkflowAgentWorkspaceRetirementLayer:
    return WorkflowAgentWorkspaceRetirementLayer(dify_run_context=dify_run_context)


__all__ = ["WorkflowAgentWorkspaceRetirementLayer", "build_workflow_agent_workspace_retirement_layer"]
