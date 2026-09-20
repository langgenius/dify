"""Dify-specific response stream filter wiring on top of Graphon."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from graphon.enums import NodeExecutionType
from graphon.filters import GraphEventFilterContext, ResponseStreamFilter
from graphon.graph.graph import Graph

NodeID = str


def _node_config_by_id(graph: Graph) -> Mapping[str, Mapping[str, Any]]:
    graph_config = graph.graph_config
    if not graph_config:
        return {}
    nodes = graph_config.get("nodes")
    if not isinstance(nodes, list):
        return {}
    mapping: dict[str, Mapping[str, Any]] = {}
    for node in nodes:
        if not isinstance(node, Mapping):
            continue
        node_id = node.get("id")
        if isinstance(node_id, str) and node_id:
            mapping[node_id] = node
    return mapping


def is_response_node_inside_loop_or_iteration(graph: Graph, node_id: str) -> bool:
    """Return True when an Answer/End node lives inside a loop or iteration body."""
    node_config = _node_config_by_id(graph).get(node_id)
    if node_config is None:
        return False

    if node_config.get("parentId"):
        return True

    data = node_config.get("data")
    if not isinstance(data, Mapping):
        return False

    if data.get("isInLoop") or data.get("isInIteration"):
        return True
    if data.get("loop_id") or data.get("iteration_id"):
        return True

    return False


class DifyResponseStreamFilter(ResponseStreamFilter):
    """Response stream filter that skips Answer/End nodes scoped to loop/iteration.

    Graphon registers every ``NodeExecutionType.RESPONSE`` node with
    ``ResponseStreamFilter``. Answer nodes inside loop/iteration containers are
    not terminal workflow outputs; treating them as global response nodes breaks
    multi-pass streaming and can stop container execution early (see #42547).

    Those nodes still stream via ``QueueTextChunkEvent`` published from
    ``WorkflowBasedAppRunner`` when the node succeeds inside a container, and
    live LLM deltas pass through when ``pass_unmatched_chunks`` is enabled.
    """

    filter_id = "dify.response_stream.v1"

    def __init__(self, *, pass_unmatched_chunks: bool = False) -> None:
        super().__init__(pass_unmatched_chunks=pass_unmatched_chunks)
        self._registration_graph: Graph | None = None

    def initialize(self, context: GraphEventFilterContext) -> None:
        graph = context.graph
        self._registration_graph = graph
        has_container_response_nodes = any(
            node.execution_type == NodeExecutionType.RESPONSE
            and is_response_node_inside_loop_or_iteration(graph, node.id)
            for node in graph.nodes.values()
        )
        if has_container_response_nodes:
            self._pass_unmatched_chunks = True
        try:
            super().initialize(context)
        finally:
            self._registration_graph = None

    def _register(self, response_node_id: NodeID) -> None:
        graph = self._registration_graph
        if graph is not None and is_response_node_inside_loop_or_iteration(graph, response_node_id):
            return
        super()._register(response_node_id)
