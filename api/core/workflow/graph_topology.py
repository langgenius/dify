"""Draft-workflow graph topology helper, shared by Agent v2 publish validation
and the agent-composer candidates endpoint (ENG-615).

Extracted from ``core/workflow/nodes/agent_v2/validators.py`` so both call sites
parse the same ``Workflow.graph`` JSON shape (``nodes`` with string ids,
``edges`` with ``source``/``target``).
"""

from __future__ import annotations

from collections import defaultdict, deque
from collections.abc import Mapping, Sequence
from typing import Any


class WorkflowGraphTopology:
    def __init__(self, *, node_ids: set[str], incoming: Mapping[str, Sequence[str]]) -> None:
        self._node_ids = node_ids
        self._incoming = incoming

    @classmethod
    def from_graph(cls, graph: Mapping[str, Any]) -> WorkflowGraphTopology:
        node_ids = cls._node_ids_from_graph(graph)
        incoming: dict[str, list[str]] = defaultdict(list)
        edges = graph.get("edges")
        if isinstance(edges, list):
            for edge in edges:
                if not isinstance(edge, Mapping):
                    continue
                source = edge.get("source")
                target = edge.get("target")
                if isinstance(source, str) and isinstance(target, str):
                    incoming[target].append(source)
        return cls(node_ids=node_ids, incoming=incoming)

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
    def _node_ids_from_graph(graph: Mapping[str, Any]) -> set[str]:
        node_ids: set[str] = set()
        nodes = graph.get("nodes")
        if not isinstance(nodes, list):
            return node_ids
        for node in nodes:
            if not isinstance(node, Mapping):
                continue
            node_id = node.get("id")
            if isinstance(node_id, str):
                node_ids.add(node_id)
        return node_ids


__all__ = ["WorkflowGraphTopology"]
