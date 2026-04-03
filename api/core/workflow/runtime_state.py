"""Helpers for explicitly wiring GraphRuntimeState collaborators.

GraphOn currently supports lazy construction of several runtime-state
collaborators such as the ready queue, graph execution aggregate, and response
coordinator. Dify initializes those collaborators eagerly so repository code
does not depend on that implicit behavior.
"""

from __future__ import annotations

from contextlib import AbstractContextManager

from graphon.graph import Graph
from graphon.graph_engine.domain.graph_execution import GraphExecution
from graphon.graph_engine.ready_queue import InMemoryReadyQueue
from graphon.graph_engine.response_coordinator import ResponseStreamCoordinator
from graphon.model_runtime.entities.llm_entities import LLMUsage
from graphon.runtime import GraphRuntimeState, VariablePool


def _require_workflow_id(workflow_id: str) -> str:
    """Validate that workflow-scoped runtime collaborators receive a real id."""

    if not workflow_id:
        raise ValueError("workflow_id must be a non-empty string")
    return workflow_id


def create_graph_runtime_state(
    *,
    variable_pool: VariablePool,
    start_at: float,
    workflow_id: str,
    total_tokens: int = 0,
    llm_usage: LLMUsage | None = None,
    outputs: dict[str, object] | None = None,
    node_run_steps: int = 0,
    execution_context: AbstractContextManager[object] | None = None,
) -> GraphRuntimeState:
    """Create a runtime state with explicit non-graph collaborators.

    The graph itself is attached later, once node construction has completed and
    the final Graph instance exists.
    """
    workflow_id = _require_workflow_id(workflow_id)

    return GraphRuntimeState(
        variable_pool=variable_pool,
        start_at=start_at,
        total_tokens=total_tokens,
        llm_usage=llm_usage or LLMUsage.empty_usage(),
        outputs=outputs or {},
        node_run_steps=node_run_steps,
        ready_queue=InMemoryReadyQueue(),
        graph_execution=GraphExecution(workflow_id=workflow_id),
        execution_context=execution_context,
    )


def ensure_graph_runtime_state_initialized(
    graph_runtime_state: GraphRuntimeState,
    *,
    workflow_id: str,
) -> GraphRuntimeState:
    """Materialize non-graph collaborators when loading legacy or sparse state."""
    workflow_id = _require_workflow_id(workflow_id)

    if graph_runtime_state._ready_queue is None:
        graph_runtime_state._ready_queue = InMemoryReadyQueue()

    graph_execution = graph_runtime_state._graph_execution
    if graph_execution is None:
        graph_runtime_state._graph_execution = GraphExecution(
            workflow_id=workflow_id,
        )
    elif not graph_execution.workflow_id:
        graph_execution.workflow_id = workflow_id
    elif graph_execution.workflow_id != workflow_id:
        raise ValueError("GraphRuntimeState workflow_id does not match graph execution workflow_id")

    return graph_runtime_state


def bind_graph_runtime_state_to_graph(
    graph_runtime_state: GraphRuntimeState,
    graph: Graph,
    *,
    workflow_id: str,
) -> GraphRuntimeState:
    """Attach graph-scoped collaborators without relying on GraphOn lazy setup."""

    ensure_graph_runtime_state_initialized(
        graph_runtime_state,
        workflow_id=workflow_id,
    )

    attached_graph = graph_runtime_state._graph
    if attached_graph is not None and attached_graph is not graph:
        raise ValueError("GraphRuntimeState already attached to a different graph instance")

    if graph_runtime_state._response_coordinator is None:
        response_coordinator = ResponseStreamCoordinator(
            variable_pool=graph_runtime_state.variable_pool,
            graph=graph,
        )
        graph_runtime_state._response_coordinator = response_coordinator

    graph_runtime_state.attach_graph(graph)
    return graph_runtime_state


def snapshot_graph_runtime_state(
    graph_runtime_state: GraphRuntimeState,
    *,
    workflow_id: str,
) -> str:
    """Serialize runtime state after explicit collaborator initialization."""

    ensure_graph_runtime_state_initialized(
        graph_runtime_state,
        workflow_id=workflow_id,
    )
    return graph_runtime_state.dumps()
