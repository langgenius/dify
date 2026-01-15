"""Shared helpers for managing GraphRuntimeState across task pipelines."""

from __future__ import annotations

from typing import TYPE_CHECKING

from core.workflow.runtime import GraphRuntimeState

if TYPE_CHECKING:
    from core.app.task_pipeline.based_generate_task_pipeline import BasedGenerateTaskPipeline


class GraphRuntimeStateSupport:
    """
    Mixin that centralises common GraphRuntimeState access patterns used by task pipelines.

    Subclasses are expected to provide:
      * `_base_task_pipeline` – exposing the queue manager with an optional cached runtime state.
      * `_graph_runtime_state` attribute used as the local cache for the runtime state.
    """

    _base_task_pipeline: BasedGenerateTaskPipeline
    _graph_runtime_state: GraphRuntimeState | None = None

    def _ensure_graph_runtime_initialized(
        self,
        graph_runtime_state: GraphRuntimeState | None = None,
    ) -> GraphRuntimeState:
        """Validate and return the active graph runtime state."""
        return self._resolve_graph_runtime_state(graph_runtime_state)

    def _extract_workflow_run_id(self, graph_runtime_state: GraphRuntimeState) -> str:
        system_variables = graph_runtime_state.variable_pool.system_variables
        if not system_variables or not system_variables.workflow_execution_id:
            raise ValueError("workflow_execution_id missing from runtime state")
        return str(system_variables.workflow_execution_id)

    def _resolve_graph_runtime_state(
        self,
        graph_runtime_state: GraphRuntimeState | None = None,
    ) -> GraphRuntimeState:
        """Return the cached runtime state or bootstrap it from the queue manager."""
        if graph_runtime_state is not None:
            self._graph_runtime_state = graph_runtime_state
            return graph_runtime_state

        if self._graph_runtime_state is None:
            candidate = self._base_task_pipeline.queue_manager.graph_runtime_state
            if candidate is not None:
                self._graph_runtime_state = candidate

        if self._graph_runtime_state is None:
            raise ValueError("graph runtime state not initialized.")

        return self._graph_runtime_state
