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

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    JsonValue,
    ValidationError,
    field_validator,
)


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
    """Parse the persisted workflow graph mapping into a typed graph.

    Preconditions: raw is a mapping containing persisted JSON values.
    Postconditions: missing or non-list sections become empty lists; entries rejected
    by their per-item Pydantic models are omitted. The input is not mutated.
    """
    return WorkflowGraph(nodes=_parse_nodes(raw.get("nodes")), edges=_parse_edges(raw.get("edges")))


class _WorkflowGraphNodePayload(BaseModel):
    """Pydantic schema for fields needed from one persisted graph node.

    The identifier is strict, top-level extras are ignored, and absent or
    non-mapping data becomes an empty mapping for legacy compatibility.
    """

    id: str
    data: dict[str, JsonValue] = Field(default_factory=dict)

    model_config = ConfigDict(strict=True, extra="ignore")

    @field_validator("data", mode="before")
    @classmethod
    def _normalize_data(cls, raw_data: object) -> dict[str, object]:
        """Normalize node data before Pydantic validates its JSON values.

        Preconditions: raw_data is a value from the persisted graph.
        Postconditions: mappings become string-keyed dictionaries; other values
        become empty dictionaries. No input is mutated.
        """
        if not isinstance(raw_data, Mapping):
            return {}
        return {str(key): value for key, value in raw_data.items()}


class _WorkflowGraphEdgePayload(BaseModel):
    """Pydantic schema for strict edge endpoints; extra fields are ignored."""

    source: str
    target: str

    model_config = ConfigDict(strict=True, extra="ignore")


def _parse_workflow_graph_node(raw_node: JsonValue) -> WorkflowGraphNode | None:
    """Convert one persisted node payload into the downstream TypedDict.

    Preconditions: raw_node is a JSON value from the graph.
    Postconditions: valid required fields yield a node with normalized data and
    ignored top-level extras; invalid fields return None. Input is not mutated.
    """
    try:
        parsed = _WorkflowGraphNodePayload.model_validate(raw_node)
    except ValidationError:
        return None
    return WorkflowGraphNode(id=parsed.id, data=parsed.data)


def _parse_workflow_graph_edge(raw_edge: JsonValue) -> WorkflowGraphEdge | None:
    """Convert one persisted edge payload into the downstream TypedDict.

    Preconditions: raw_edge is a JSON value from the graph.
    Postconditions: valid string endpoints yield an edge with ignored top-level
    extras; invalid fields return None. Input is not mutated.
    """
    try:
        parsed = _WorkflowGraphEdgePayload.model_validate(raw_edge)
    except ValidationError:
        return None
    return WorkflowGraphEdge(source=parsed.source, target=parsed.target)


def _parse_nodes(raw_nodes: JsonValue) -> list[WorkflowGraphNode]:
    """Parse a node section while preserving malformed-graph tolerance.

    Preconditions: raw_nodes is a JSON value.
    Postconditions: non-list values produce an empty list; valid entries are
    returned and invalid entries are omitted. Input is not mutated.
    """
    if not isinstance(raw_nodes, list):
        return []
    return [node for raw_node in raw_nodes if (node := _parse_workflow_graph_node(raw_node)) is not None]


def _parse_edges(raw_edges: JsonValue) -> list[WorkflowGraphEdge]:
    """Parse an edge section while preserving malformed-graph tolerance.

    Preconditions: raw_edges is a JSON value.
    Postconditions: non-list values produce an empty list; valid entries are
    returned and invalid entries are omitted. Input is not mutated.
    """
    if not isinstance(raw_edges, list):
        return []
    return [edge for raw_edge in raw_edges if (edge := _parse_workflow_graph_edge(raw_edge)) is not None]


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
