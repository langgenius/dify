from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Literal

from graphon.enums import NodeExecutionType
from graphon.nodes.base.template import VariableSegment
from graphon.runtime.runtime_state import GraphProtocol, NodeProtocol

from . import v2
from .snapshot import ResponseStreamFilterSnapshot, Selector


class Snapshot(ResponseStreamFilterSnapshot):
    """Legacy ResponseStreamFilter snapshot written before scoped graphs."""

    version: Literal["1.0"] = "1.0"


def loads(data: str) -> Snapshot:
    """Validate JSON against the exact legacy version 1 schema.

    Args:
        data: Serialized ResponseStreamFilter state whose version must be ``1.0``.

    Returns:
        Validated version 1 state, without changing its version or edge IDs.
    """
    return Snapshot.model_validate_json(data)


def dumps(snapshot: ResponseStreamFilterSnapshot) -> str:
    """Prevent unbound version 1 state from being emitted as current state.

    Version 1 edge IDs can only be translated after graph binding. Callers must
    initialize the filter first, which invokes ``for_graph`` and produces v2 state.

    Args:
        snapshot: Unbound legacy state; it is intentionally not serialized.

    Raises:
        RuntimeError: Always, because version 1 output before migration is unsafe.
    """
    del snapshot
    msg = (
        "Version 1 ResponseStreamFilter state must be initialized before serialization"
    )
    raise RuntimeError(msg)


def for_graph(
    snapshot: ResponseStreamFilterSnapshot,
    graph: GraphProtocol,
) -> v2.Snapshot:
    """Migrate a version 1 full-graph snapshot to scoped version 2 state.

    Version 1 stored generated ``edge_N`` IDs over the complete workflow. Version 2
    stores public edge IDs from the root graph. The mapping therefore requires the
    graph that owns the restored filter. Child-frame response state is discarded
    because the current filter is scoped to the root frame.

    TODO: Delete this file when version 1 snapshots leave the migration window.
    Version dispatch derives this module from the persisted version, so no remaining
    code needs to change when the file is removed.

    Args:
        snapshot: Exact version 1 state returned by this module's ``loads``.
        graph: Scoped root graph used to identify retained nodes and public edge IDs.

    Returns:
        Version 2 state restricted to the bound root graph.

    Raises:
        TypeError: If the snapshot or graph configuration has an invalid shape.
        ValueError: If legacy edge IDs cannot be mapped exactly.
    """
    if not isinstance(snapshot, Snapshot):
        msg = "Expected a version 1 ResponseStreamFilter snapshot"
        raise TypeError(msg)

    root_response_nodes = {
        node_id
        for node_id, node in graph.nodes.items()
        if node.execution_type == NodeExecutionType.RESPONSE
    }
    legacy_edge_ids = _legacy_edge_ids(graph)

    try:
        paths_map = {
            node_id: [[legacy_edge_ids[edge_id] for edge_id in path] for path in paths]
            for node_id, paths in snapshot.paths_map.items()
            if node_id in root_response_nodes
        }
    except KeyError as exc:
        msg = f"Unknown version 1 edge ID: {exc.args[0]}"
        raise ValueError(msg) from exc

    active_session = snapshot.active_session
    if active_session is not None and active_session.node_id not in root_response_nodes:
        active_session = None
    waiting_sessions = [
        session
        for session in snapshot.waiting_sessions
        if session.node_id in root_response_nodes
    ]
    if active_session is None and waiting_sessions:
        active_session = waiting_sessions.pop(0)

    referenced_selectors = {
        selector
        for node_id in root_response_nodes
        for selector in _referenced_selectors(graph.nodes[node_id])
    }
    return v2.Snapshot(
        response_nodes=[
            node_id
            for node_id in snapshot.response_nodes
            if node_id in root_response_nodes
        ],
        active_session=active_session,
        waiting_sessions=waiting_sessions,
        pending_sessions=[
            session
            for session in snapshot.pending_sessions
            if session.node_id in root_response_nodes
        ],
        node_execution_ids={
            node_id: execution_id
            for node_id, execution_id in snapshot.node_execution_ids.items()
            if node_id in graph.nodes
        },
        paths_map=paths_map,
        stream_buffers=[
            buffer
            for buffer in snapshot.stream_buffers
            if tuple(buffer.selector) in referenced_selectors
        ],
        stream_positions=[
            position
            for position in snapshot.stream_positions
            if tuple(position.selector) in referenced_selectors
        ],
        closed_streams=[
            selector
            for selector in snapshot.closed_streams
            if tuple(selector) in referenced_selectors
        ],
    )


def _legacy_edge_ids(graph: GraphProtocol) -> dict[str, str]:
    """Build an exact mapping from legacy generated IDs to public graph IDs.

    Imported graphs replay the old full-config counter so child edges keep their
    historical positions. Programmatic graphs lack that config and are accepted only
    when their own IDs prove that no translation is needed.

    Args:
        graph: Root graph receiving the migrated filter state.

    Returns:
        Mapping from persisted ``edge_N`` values to current public edge IDs.

    Raises:
        TypeError: If imported graph configuration has an invalid shape.
        ValueError: If a programmatic graph cannot prove stable legacy IDs.
    """
    graph_config = getattr(graph, "graph_config", None)
    if graph_config is None:
        expected_edge_ids = {
            f"edge_{edge_index}" for edge_index in range(len(graph.edges))
        }
        if set(graph.edges) != expected_edge_ids or any(
            edge_id != edge.id for edge_id, edge in graph.edges.items()
        ):
            msg = (
                "Version 1 ResponseStreamFilter state without graph config "
                "requires stable edge_N IDs"
            )
            raise ValueError(msg)
        return {edge_id: edge_id for edge_id in expected_edge_ids}

    if not isinstance(graph_config, Mapping):
        msg = "Version 1 ResponseStreamFilter state requires graph config"
        raise TypeError(msg)

    edge_configs = graph_config.get("edges")
    if not isinstance(edge_configs, Sequence) or isinstance(
        edge_configs,
        (str, bytes),
    ):
        msg = "Version 1 ResponseStreamFilter state requires graph edge config"
        raise TypeError(msg)

    legacy_edge_ids: dict[str, str] = {}
    edge_index = 0
    for edge_config in edge_configs:
        if not isinstance(edge_config, Mapping):
            msg = "Graph edge config must be a mapping"
            raise TypeError(msg)
        if not isinstance(edge_config.get("source"), str) or not isinstance(
            edge_config.get("target"),
            str,
        ):
            continue

        edge_id = edge_config.get("id")
        if not isinstance(edge_id, str):
            msg = "Graph edge config is missing its public edge ID"
            raise TypeError(msg)

        bound_edge = graph.edges.get(edge_id)
        if (
            bound_edge is not None
            and bound_edge.tail == edge_config["source"]
            and bound_edge.head == edge_config["target"]
        ):
            legacy_edge_ids[f"edge_{edge_index}"] = edge_id
        edge_index += 1

    return legacy_edge_ids


def _referenced_selectors(node: NodeProtocol) -> set[Selector]:
    """Find stream selectors whose legacy buffers remain relevant after scoping.

    Args:
        node: Root response node whose streaming template defines retained inputs.

    Returns:
        Full variable selectors referenced by the node's streaming template.

    Raises:
        TypeError: If a response node does not expose a streaming template.
    """
    get_streaming_template = getattr(node, "get_streaming_template", None)
    if not callable(get_streaming_template):
        msg = "Response streaming requires get_streaming_template() on response nodes"
        raise TypeError(msg)
    return {
        tuple(segment.selector)
        for segment in get_streaming_template().segments
        if isinstance(segment, VariableSegment)
    }
