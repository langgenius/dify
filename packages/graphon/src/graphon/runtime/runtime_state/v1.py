from __future__ import annotations

# Version codecs are package internals and intentionally restore private state.
# ruff: file-ignore[private-member-access]
from typing import TYPE_CHECKING, Literal

from pydantic import BaseModel, ConfigDict

from graphon.enums import NodeState
from graphon.runtime.execution import ROOT_FRAME_ID
from graphon.runtime.ready_queue import StartTask

from .protocol import GraphProtocol
from .snapshot import BaseSnapshot, ReadyQueueFactory, new_state
from .v2 import migrate_graph_state as migrate_positional_graph_state

if TYPE_CHECKING:
    from .state import RuntimeState

# TODO(https://github.com/langgenius/graphon/issues/248): Delete this legacy  # ruff:ignore[line-contains-todo]
# version module together with v2.py after the migration window. No dispatcher
# or current-version edits are required.


class GraphStateSnapshot(BaseModel):
    """Full-graph node and positional edge state stored by version 1."""

    model_config = ConfigDict(frozen=True)

    nodes: dict[str, NodeState]
    edges: dict[str, NodeState]


class Snapshot(BaseSnapshot):
    """Runtime snapshot produced before frame-aware execution."""

    version: Literal["1.0"]
    paused_nodes: tuple[str, ...]
    deferred_nodes: tuple[str, ...]
    graph_state: GraphStateSnapshot


def _reject_unrestorable_tasks(state: RuntimeState, graph: GraphProtocol) -> None:
    """Reject version 1 child work that lacks the frame data needed to resume.

    Version 1 persisted only node IDs for paused work; it did not retain the
    owning invocation, container round or item, child variables, or suspended
    continuation. Every task is removed temporarily for validation and restored
    in its original queue order even when validation fails.

    Args:
        state: Restored version 1 runtime state holding root-shaped tasks.
        graph: Attached root graph used to identify valid root node IDs.

    Raises:
        RuntimeError: If any queued item is not a root-frame StartTask for a node
            present in the materialized root graph.

    """
    invalid_tasks: list[str] = []
    for task_queue in (state._ready_queue, state._deferred_ready_queue):
        tasks = task_queue.take_all()
        try:
            invalid_tasks.extend(
                (
                    f"{task.frame_id}:{task.node_id}"
                    if isinstance(task, StartTask)
                    else task.kind
                )
                for task in tasks
                if not isinstance(task, StartTask)
                or task.frame_id != ROOT_FRAME_ID
                or task.node_id not in graph.nodes
            )
        finally:
            for task in tasks:
                task_queue.put(task)
    if invalid_tasks:
        msg = (
            "Version 1 snapshot contains child-frame tasks that cannot be restored "
            f"without frame state: {invalid_tasks}"
        )
        raise RuntimeError(msg)


def _migrate_graph_state(state: RuntimeState, graph: GraphProtocol) -> None:
    """Validate version 1 tasks and convert its positional graph identities.

    Task validation happens before the shared positional conversion so a failed
    resume leaves the staged version 1 graph maps untouched and retryable. The
    graph identity layout is the predecessor of version 2, so its exact,
    graph-aware conversion is reused after the version 1-only task check.

    Args:
        state: Restored version 1 runtime state with staged full-graph maps.
        graph: Materialized root graph providing current scoped identities.

    """
    _reject_unrestorable_tasks(state, graph)
    migrate_positional_graph_state(state, graph)


def loads(
    data: str,
    *,
    state_type: type[RuntimeState],
    ready_queue_factory: ReadyQueueFactory,
) -> RuntimeState:
    """Validate and restore the exact pre-frame version 1 snapshot format.

    Legacy paused and deferred node IDs are deduplicated into root StartTasks.
    Full-graph state is staged with this module's migration callback so it cannot
    be serialized as current data until graph attachment validates its identity.

    Args:
        data: Serialized JSON whose version must be exactly ``"1.0"``.
        state_type: RuntimeState class selected by the public classmethod caller.
        ready_queue_factory: Factory used to create both restored task queues.

    Returns:
        Runtime state awaiting version 1 graph-aware migration when state exists.

    """
    snapshot = Snapshot.model_validate_json(data)
    ready_queue = ready_queue_factory()
    ready_queue.loads(snapshot.ready_queue)
    deferred_ready_queue = ready_queue_factory()
    for node_id in dict.fromkeys((
        *snapshot.paused_nodes,
        *snapshot.deferred_nodes,
    )):
        deferred_ready_queue.put(
            StartTask(frame_id=ROOT_FRAME_ID, node_id=node_id),
        )
    state = new_state(
        snapshot,
        state_type=state_type,
        ready_queue=ready_queue,
        deferred_ready_queue=deferred_ready_queue,
    )
    if snapshot.graph_state.nodes or snapshot.graph_state.edges:
        state.restore_graph_state(
            node_states=snapshot.graph_state.nodes,
            edge_states=snapshot.graph_state.edges,
        )
        state._graph_state_migration = _migrate_graph_state
    return state
