from __future__ import annotations

# Version codecs are package internals and intentionally restore private state.
# ruff: file-ignore[private-member-access]
from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Literal

from graphon.enums import NodeState
from graphon.runtime.container_state import ContainerFrameState

from .protocol import GraphProtocol
from .snapshot import FrameSnapshot, ReadyQueueFactory, restore_frame_snapshot

if TYPE_CHECKING:
    from .state import RuntimeState

# TODO(https://github.com/langgenius/graphon/issues/248): Delete this legacy  # ruff:ignore[line-contains-todo]
# version module together with v1.py after the migration window. No dispatcher
# or current-version edits are required.


class Snapshot(FrameSnapshot):
    """Version 2 snapshot with full-graph positional edge identities."""

    version: Literal["2.0"]


def _edges_by_owner(
    raw_edges: list[object],
    node_owners: Mapping[str, str],
) -> dict[str, dict[str, str]]:
    """Map version 2 positional edge IDs to frame-local public edge IDs.

    The ordinal advances only for entries with string ``source`` and ``target``
    values, exactly matching the version 2 graph builder. Public IDs are checked
    within their owning graph because sibling graphs may reuse the same edge ID.

    Args:
        raw_edges: Full graph edge list in persisted DSL order.
        node_owners: Direct container owner indexed by node ID.

    Returns:
        Positional-to-public edge mappings grouped by direct container ID.

    Raises:
        RuntimeError: If an edge cannot be assigned unambiguously to one graph.

    """
    edges_by_owner: dict[str, dict[str, str]] = {}
    edge_ordinal = 0
    for edge_config in raw_edges:
        if not isinstance(edge_config, Mapping):
            continue
        source = edge_config.get("source")
        target = edge_config.get("target")
        if not isinstance(source, str) or not isinstance(target, str):
            continue
        legacy_edge_id = f"edge_{edge_ordinal}"
        edge_ordinal += 1
        if not isinstance(edge_config.get("sourceHandle", "source"), str):
            continue
        public_edge_id = edge_config.get("id")
        if not isinstance(public_edge_id, str) or not public_edge_id:
            msg = f"Legacy {legacy_edge_id} has no public DSL edge ID"
            raise RuntimeError(msg)
        source_owner = node_owners.get(source)
        target_owner = node_owners.get(target)
        if source_owner is None or target_owner is None or source_owner != target_owner:
            msg = f"Legacy {legacy_edge_id} does not belong to one graph scope"
            raise RuntimeError(msg)
        scoped_edges = edges_by_owner.setdefault(source_owner, {})
        if public_edge_id in scoped_edges.values():
            msg = (
                f"Duplicate edge ID {public_edge_id!r} in graph scope {source_owner!r}"
            )
            raise RuntimeError(msg)
        scoped_edges[legacy_edge_id] = public_edge_id
    return edges_by_owner


def _graph_scopes(
    graph_config: Mapping[str, Any],
) -> tuple[dict[str, set[str]], dict[str, dict[str, str]]]:
    """Build frame-local node and edge identities for a version 2 snapshot.

    Version 2 stored full-graph state in every frame. This helper resolves each
    node's direct container owner and groups positional edge IDs by that same
    owner so every saved frame can be converted independently.

    Args:
        graph_config: Complete root graph configuration retained by the importer.

    Returns:
        Node IDs by direct owner and positional-to-public edge IDs by owner.

    Raises:
        TypeError: If graph config does not contain node and edge lists.

    """
    from graphon.graph.scoping import (  # ruff:ignore[import-outside-top-level]
        resolve_container_id,
    )

    raw_nodes = graph_config.get("nodes", [])
    raw_edges = graph_config.get("edges", [])
    if not isinstance(raw_nodes, list) or not isinstance(raw_edges, list):
        msg = "Attached graph config cannot migrate legacy runtime state"
        raise TypeError(msg)

    nodes_by_id = {
        node_id: node_config
        for node_config in raw_nodes
        if isinstance(node_config, Mapping)
        and isinstance((node_id := node_config.get("id")), str)
    }
    node_owners: dict[str, str] = {}
    nodes_by_owner: dict[str, set[str]] = {}
    for node_id, node_config in nodes_by_id.items():
        owner = resolve_container_id(node_config, nodes_by_id=nodes_by_id)
        node_owners[node_id] = owner
        nodes_by_owner.setdefault(owner, set()).add(node_id)
    return nodes_by_owner, _edges_by_owner(raw_edges, node_owners)


def _select_scope_state(
    *,
    owner: str,
    node_states: Mapping[str, NodeState],
    edge_states: Mapping[str, NodeState],
    nodes_by_owner: Mapping[str, set[str]],
    edges_by_owner: Mapping[str, Mapping[str, str]],
) -> tuple[dict[str, NodeState], dict[str, NodeState]]:
    """Select and rename one graph scope from version 2 full-graph state.

    All required source entries and unknown identities are checked before any
    RuntimeState field changes. The caller can therefore build replacements for
    every frame and commit them atomically only after all scopes validate.

    Args:
        owner: Direct container node ID, or an empty string for the root graph.
        node_states: Saved node states covering the complete graph.
        edge_states: Saved positional edge states covering the complete graph.
        nodes_by_owner: Node identities grouped by direct container ID.
        edges_by_owner: Positional-to-public edge mappings grouped by owner.

    Returns:
        Exact node and edge state dictionaries for the requested graph scope.

    Raises:
        RuntimeError: If required state is absent or unknown identities exist.

    """
    expected_nodes = nodes_by_owner.get(owner, set())
    scoped_edges = edges_by_owner.get(owner, {})
    missing_nodes = expected_nodes.difference(node_states)
    missing_edges = set(scoped_edges).difference(edge_states)
    known_nodes = set().union(*nodes_by_owner.values())
    known_edges = {
        legacy_edge_id for scope in edges_by_owner.values() for legacy_edge_id in scope
    }
    unknown_nodes = set(node_states).difference(known_nodes)
    unknown_edges = set(edge_states).difference(known_edges)
    if missing_nodes or missing_edges or unknown_nodes or unknown_edges:
        msg = (
            f"Legacy graph state does not match scope {owner!r}: "
            f"missing_nodes={sorted(missing_nodes)}, "
            f"missing_edges={sorted(missing_edges)}, "
            f"unknown_nodes={sorted(unknown_nodes)}, "
            f"unknown_edges={sorted(unknown_edges)}"
        )
        raise RuntimeError(msg)
    return (
        {node_id: node_states[node_id] for node_id in expected_nodes},
        {
            public_edge_id: edge_states[legacy_edge_id]
            for legacy_edge_id, public_edge_id in scoped_edges.items()
        },
    )


def migrate_graph_state(state: RuntimeState, graph: GraphProtocol) -> None:
    """Convert all version 2 graph state after the root graph is attached.

    Positional ``edge_N`` keys require the persisted full graph definition, so
    conversion cannot happen during JSON validation. Root and container-frame
    replacements are built fully before assignment; a malformed later frame
    leaves the RuntimeState retryable in its original form. Programmatic graphs
    without graph config remain valid only when their exact generated IDs match.

    Args:
        state: Restored version 2 runtime state with staged graph maps.
        graph: Materialized root graph providing current scoped identities.

    Raises:
        RuntimeError: If graph config is required but absent, a container frame
            has no matching run, or any saved scope cannot be converted exactly.

    """
    graph_config = getattr(graph, "graph_config", None)
    if graph_config is None:
        if not state._container_frames and (
            set(graph.nodes) == set(state._pending_graph_node_states)
            and set(graph.edges) == set(state._pending_graph_edge_states)
        ):
            return
        msg = "Attached graph must retain graph_config to migrate legacy state"
        raise RuntimeError(msg)
    nodes_by_owner, edges_by_owner = _graph_scopes(graph_config)
    root_node_states, root_edge_states = _select_scope_state(
        owner="",
        node_states=state._pending_graph_node_states,
        edge_states=state._pending_graph_edge_states,
        nodes_by_owner=nodes_by_owner,
        edges_by_owner=edges_by_owner,
    )
    if set(graph.nodes) != set(root_node_states) or set(graph.edges) != set(
        root_edge_states
    ):
        msg = "Saved graph state does not match rebuilt graph"
        raise RuntimeError(msg)

    with state._container_state_lock:
        migrated_frames: dict[str, ContainerFrameState] = {}
        for frame in state._container_frames.values():
            run = state._container_runs.get(frame.parent_invocation_id)
            if run is None:
                msg = f"Legacy frame {frame.frame_id!r} has no matching container run"
                raise RuntimeError(msg)
            node_states, edge_states = _select_scope_state(
                owner=run.node_id,
                node_states=frame.runtime_data.graph_node_states,
                edge_states=frame.runtime_data.graph_edge_states,
                nodes_by_owner=nodes_by_owner,
                edges_by_owner=edges_by_owner,
            )
            runtime_data = frame.runtime_data.model_copy(
                update={
                    "graph_node_states": node_states,
                    "graph_edge_states": edge_states,
                },
            )
            migrated_frames[frame.frame_id] = frame.model_copy(
                update={"runtime_data": runtime_data},
            )

        state._pending_graph_node_states = root_node_states
        state._pending_graph_edge_states = root_edge_states
        state._container_frames = migrated_frames


def loads(
    data: str,
    *,
    state_type: type[RuntimeState],
    ready_queue_factory: ReadyQueueFactory,
) -> RuntimeState:
    """Validate version 2 and stage its graph-aware identity migration.

    Args:
        data: Serialized JSON whose version must be exactly ``"2.0"``.
        state_type: RuntimeState class selected by the public classmethod caller.
        ready_queue_factory: Factory used to restore both task queues.

    Returns:
        Runtime state that will migrate positional IDs on graph attachment.

    """
    return restore_frame_snapshot(
        Snapshot.model_validate_json(data),
        state_type=state_type,
        ready_queue_factory=ready_queue_factory,
        graph_state_migration=migrate_graph_state,
    )
