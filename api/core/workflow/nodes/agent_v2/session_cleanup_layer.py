"""Workflow terminal layer that retires Agent backend sessions asynchronously."""

from __future__ import annotations

import logging
from typing import override

from clients.agent_backend import AgentBackendSessionCleanupPayload
from core.workflow.system_variables import SystemVariableKey, get_system_text
from graphon.graph_engine.layers import GraphEngineLayer
from graphon.graph_events import (
    GraphEngineEvent,
    GraphRunAbortedEvent,
    GraphRunFailedEvent,
    GraphRunPartialSucceededEvent,
    GraphRunSucceededEvent,
)
from tasks.agent_backend_session_cleanup_task import cleanup_workflow_agent_runtime_session

from .session_store import StoredWorkflowAgentSession, WorkflowAgentRuntimeSessionStore

logger = logging.getLogger(__name__)


class WorkflowAgentSessionCleanupLayer(GraphEngineLayer):
    """Retire workflow-owned Agent runtime sessions when the workflow ends.

    Workflow termination is a product-lifecycle boundary: once the run reaches a
    terminal graph event, the local session row must no longer be resumable. The
    actual Agent backend cleanup is therefore dispatched asynchronously with the
    persisted snapshot/specs payload, while the local row is marked CLEANED
    immediately afterwards regardless of enqueue outcome.
    """

    _TERMINAL_EVENTS = (
        GraphRunSucceededEvent,
        GraphRunPartialSucceededEvent,
        GraphRunFailedEvent,
        GraphRunAbortedEvent,
    )

    def __init__(self, *, session_store: WorkflowAgentRuntimeSessionStore) -> None:
        super().__init__()
        self._session_store = session_store

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
            logger.warning("Skipping workflow Agent session cleanup: workflow_run_id is missing.")
            return

        for stored_session in self._session_store.list_active_sessions(workflow_run_id=workflow_run_id):
            self._cleanup_session(stored_session)

    @override
    def on_graph_end(self, error: Exception | None) -> None:
        return

    def _cleanup_session(self, stored_session: StoredWorkflowAgentSession) -> None:
        scope = stored_session.scope
        try:
            if stored_session.runtime_layer_specs:
                payload = AgentBackendSessionCleanupPayload(
                    session_snapshot=stored_session.session_snapshot,
                    runtime_layer_specs=stored_session.runtime_layer_specs,
                    idempotency_key=f"{scope.workflow_run_id}:{scope.node_id}:{scope.binding_id}:agent-session-cleanup",
                    metadata={
                        "tenant_id": scope.tenant_id,
                        "app_id": scope.app_id,
                        "workflow_id": scope.workflow_id,
                        "workflow_run_id": scope.workflow_run_id,
                        "node_id": scope.node_id,
                        "node_execution_id": scope.node_execution_id,
                        "binding_id": scope.binding_id,
                        "agent_id": scope.agent_id,
                        "agent_config_snapshot_id": scope.agent_config_snapshot_id,
                        "previous_agent_backend_run_id": stored_session.backend_run_id,
                    },
                )
                cleanup_workflow_agent_runtime_session.delay(payload.model_dump(mode="json"))
            else:
                logger.warning(
                    "Skipping workflow Agent backend cleanup enqueue: no runtime_layer_specs persisted. "
                    "workflow_run_id=%s node_id=%s agent_id=%s",
                    scope.workflow_run_id,
                    scope.node_id,
                    scope.agent_id,
                )
        except Exception:
            logger.warning(
                "Failed to enqueue workflow Agent backend cleanup: "
                "workflow_run_id=%s node_id=%s agent_id=%s previous_run_id=%s",
                scope.workflow_run_id,
                scope.node_id,
                scope.agent_id,
                stored_session.backend_run_id,
                exc_info=True,
            )
        finally:
            try:
                self._session_store.mark_cleaned(scope=scope, backend_run_id=stored_session.backend_run_id)
            except Exception:
                logger.warning(
                    "Failed to retire workflow Agent runtime session after cleanup enqueue: "
                    "workflow_run_id=%s node_id=%s agent_id=%s previous_run_id=%s",
                    scope.workflow_run_id,
                    scope.node_id,
                    scope.agent_id,
                    stored_session.backend_run_id,
                    exc_info=True,
                )


def build_workflow_agent_session_cleanup_layer() -> WorkflowAgentSessionCleanupLayer:
    """Wire the cleanup layer with the standard workflow-owned session store."""
    return WorkflowAgentSessionCleanupLayer(session_store=WorkflowAgentRuntimeSessionStore())
