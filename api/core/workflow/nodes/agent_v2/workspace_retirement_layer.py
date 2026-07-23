"""Enqueue Workflow Agent Workspace retirement when the Workflow Run terminates."""

from __future__ import annotations

import logging
from typing import override

from core.app.entities.app_invoke_entities import DifyRunContext
from core.workflow.system_variables import SystemVariableKey, get_system_text
from graphon.graph_engine.layers import GraphEngineLayer
from graphon.graph_events import (
    GraphEngineEvent,
    GraphRunAbortedEvent,
    GraphRunFailedEvent,
    GraphRunPartialSucceededEvent,
    GraphRunSucceededEvent,
)

logger = logging.getLogger(__name__)


class WorkflowAgentWorkspaceRetirementLayer(GraphEngineLayer):
    """Dispatch best-effort asynchronous retirement at the Workflow Run boundary."""

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
            from tasks.retire_workflow_agents_task import retire_workflow_agent_workspaces

            retire_workflow_agent_workspaces.delay(
                tenant_id=self._dify_run_context.tenant_id,
                app_id=self._dify_run_context.app_id,
                workflow_run_id=workflow_run_id,
            )
        except Exception:
            logger.exception(
                "Failed to enqueue Workflow Agent Workspace retirement",
                extra={
                    "tenant_id": self._dify_run_context.tenant_id,
                    "app_id": self._dify_run_context.app_id,
                    "workflow_run_id": workflow_run_id,
                },
            )

    @override
    def on_graph_end(self, error: Exception | None) -> None:
        return


def build_workflow_agent_workspace_retirement_layer(
    *, dify_run_context: DifyRunContext
) -> WorkflowAgentWorkspaceRetirementLayer:
    return WorkflowAgentWorkspaceRetirementLayer(dify_run_context=dify_run_context)


__all__ = ["WorkflowAgentWorkspaceRetirementLayer", "build_workflow_agent_workspace_retirement_layer"]
