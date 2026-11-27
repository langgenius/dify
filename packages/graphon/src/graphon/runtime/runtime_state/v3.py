from __future__ import annotations

# Version codecs are package internals and intentionally serialize private state.
# ruff: file-ignore[private-member-access]
from typing import TYPE_CHECKING, Literal

from .snapshot import FrameSnapshot, ReadyQueueFactory, restore_frame_snapshot

if TYPE_CHECKING:
    from .state import RuntimeState


class Snapshot(FrameSnapshot):
    """Current frame-scoped RuntimeState snapshot format."""

    version: Literal["3.0"]


def dumps(state: RuntimeState) -> str:
    """Serialize one RuntimeState with the current version 3 schema.

    Graph state is read from the attached graph when available and otherwise
    from staged state restored before graph attachment. Container state is read
    under the same lock used by live frame updates so the two collections form
    one consistent snapshot.

    Args:
        state: Mutable runtime state to serialize.

    Returns:
        A validated version 3 JSON snapshot.

    """
    with state._container_state_lock:
        container_runs = tuple(state._container_runs.values())
        container_frames = tuple(state._container_frames.values())
    if state._graph is None:
        graph_node_states = state._pending_graph_node_states
        graph_edge_states = state._pending_graph_edge_states
    else:
        graph_node_states = {
            node_id: node.state for node_id, node in state._graph.nodes.items()
        }
        graph_edge_states = {
            edge_id: edge.state for edge_id, edge in state._graph.edges.items()
        }
    return Snapshot(
        version="3.0",
        start_at=state._start_at,
        node_run_steps=state._node_run_steps,
        llm_usage=state._llm_usage,
        outputs=state.outputs,
        variable_pool=state.variable_pool,
        ready_queue=state.ready_queue.dumps(),
        graph_execution=state.graph_execution.dumps(),
        deferred_ready_tasks=state._deferred_ready_queue.dumps(),
        container_runs=container_runs,
        container_frames=container_frames,
        graph_node_states=graph_node_states,
        graph_edge_states=graph_edge_states,
    ).model_dump_json()


def loads(
    data: str,
    *,
    state_type: type[RuntimeState],
    ready_queue_factory: ReadyQueueFactory,
) -> RuntimeState:
    """Validate and restore an exact version 3 RuntimeState snapshot.

    Args:
        data: Serialized JSON whose version must be exactly ``"3.0"``.
        state_type: RuntimeState class selected by the public classmethod caller.
        ready_queue_factory: Factory used to restore both task queues.

    Returns:
        Runtime state using current frame-local graph identities.

    """
    return restore_frame_snapshot(
        Snapshot.model_validate_json(data),
        state_type=state_type,
        ready_queue_factory=ready_queue_factory,
    )
