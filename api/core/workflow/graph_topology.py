"""Draft-workflow graph topology helper, shared by Agent v2 publish validation
and the agent-composer candidates endpoint (ENG-615).

Extracted from ``core/workflow/nodes/agent_v2/validators.py`` so both call sites
parse the same ``Workflow.graph`` JSON shape (``nodes`` with string ids,
``edges`` with ``source``/``target``).

``parse_workflow_graph`` is the single parse step: it reads the stored JSON
mapping into the ``WorkflowGraph`` shape and drops the entries that cannot be
read as a node or an edge. Everything downstream takes ``WorkflowGraph`` and
does not re-check the shape.
"""

from __future__ import annotations

from collections import defaultdict, deque
from collections.abc import Mapping, Sequence
from typing import TypedDict

from pydantic import JsonValue


class WorkflowGraphEdge(TypedDict):
    """One ``source -> target`` edge of a ``Workflow.graph`` payload."""

    source: str
    target: str


class WorkflowGraphNode(TypedDict):
    """One node of a ``Workflow.graph`` payload."""

    id: str
    data: dict[str, JsonValue]


class WorkflowGraph(TypedDict):
    """The ``nodes``/``edges`` JSON shape persisted in ``Workflow.graph``."""

    nodes: list[WorkflowGraphNode]
    edges: list[WorkflowGraphEdge]


def parse_workflow_graph(raw: Mapping[str, JsonValue]) -> WorkflowGraph:
    """Read the persisted ``Workflow.graph`` JSON into a ``WorkflowGraph``."""
    return WorkflowGraph(nodes=_parse_nodes(raw.get("nodes")), edges=_parse_edges(raw.get("edges")))


def _parse_nodes(raw_nodes: JsonValue) -> list[WorkflowGraphNode]:
    if not isinstance(raw_nodes, list):
        return []
    nodes: list[WorkflowGraphNode] = []
    for raw_node in raw_nodes:
        if isinstance(raw_node, Mapping):
            node_id = raw_node.get("id")
            if isinstance(node_id, str):
                nodes.append(WorkflowGraphNode(id=node_id, data=_parse_node_data(raw_node.get("data"))))
    return nodes


def _parse_node_data(raw_data: JsonValue) -> dict[str, JsonValue]:
    if not isinstance(raw_data, Mapping):
        return {}
    return {str(key): value for key, value in raw_data.items()}


def _parse_edges(raw_edges: JsonValue) -> list[WorkflowGraphEdge]:
    if not isinstance(raw_edges, list):
        return []
    edges: list[WorkflowGraphEdge] = []
    for raw_edge in raw_edges:
        if isinstance(raw_edge, Mapping):
            source = raw_edge.get("source")
            target = raw_edge.get("target")
            if isinstance(source, str) and isinstance(target, str):
                edges.append(WorkflowGraphEdge(source=source, target=target))
    return edges


class WorkflowGraphTopology:
    def __init__(self, *, node_ids: set[str], incoming: Mapping[str, Sequence[str]]) -> None:
        self._node_ids = node_ids
        self._incoming = incoming

    @classmethod
    def from_graph(cls, graph: WorkflowGraph) -> WorkflowGraphTopology:
        incoming: dict[str, list[str]] = defaultdict(list)
        for edge in graph["edges"]:
            incoming[edge["target"]].append(edge["source"])
        return cls(node_ids=cls._node_ids_from_graph(graph), incoming=incoming)

    def has_node(self, node_id: str) -> bool:
        return node_id in self._node_ids

    def is_upstream(self, *, source_node_id: str, target_node_id: str) -> bool:
        if source_node_id == target_node_id:
            return False
        visited: set[str] = set()
        queue: deque[str] = deque(self._incoming.get(target_node_id, ()))
        while queue:
            candidate = queue.popleft()
            if candidate == source_node_id:
                return True
            if candidate in visited:
                continue
            visited.add(candidate)
            queue.extend(self._incoming.get(candidate, ()))
        return False

    def upstream_node_ids(self, target_node_id: str) -> set[str]:
        """All graph nodes reachable upstream of ``target_node_id`` (excluding it).

        Edges may reference ids missing from ``nodes`` (half-deleted graphs);
        only real nodes are returned.
        """
        visited: set[str] = set()
        queue: deque[str] = deque(self._incoming.get(target_node_id, ()))
        while queue:
            candidate = queue.popleft()
            if candidate in visited:
                continue
            visited.add(candidate)
            queue.extend(self._incoming.get(candidate, ()))
        visited.discard(target_node_id)
        return visited & self._node_ids

    @staticmethod
    def _node_ids_from_graph(graph: WorkflowGraph) -> set[str]:
        return {node["id"] for node in graph["nodes"]}


__all__ = [
    "WorkflowGraph",
    "WorkflowGraphEdge",
    "WorkflowGraphNode",
    "WorkflowGraphTopology",
    "parse_workflow_graph",
]
