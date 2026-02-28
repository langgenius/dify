from __future__ import annotations

from collections import deque
from collections.abc import Iterable, Mapping


def invert_dependency_map(depends_on_map: Mapping[str, Iterable[str]], all_nodes: Iterable[str]) -> dict[str, set[str]]:
    """Build a reverse lookup map: target_id -> direct referrer ids."""
    reference_map: dict[str, set[str]] = {node_id: set() for node_id in all_nodes}
    for node_id, deps in depends_on_map.items():
        for dep_id in deps:
            if dep_id in reference_map:
                reference_map[dep_id].add(node_id)
    return reference_map


def collect_reachable(start_nodes: Iterable[str], adjacency_map: Mapping[str, Iterable[str]]) -> set[str]:
    """Return all nodes reachable from start nodes in adjacency map, inclusive."""
    visited: set[str] = set()
    queue = deque(start_nodes)
    while queue:
        node_id = queue.popleft()
        if node_id in visited:
            continue
        visited.add(node_id)
        for next_id in adjacency_map.get(node_id, []):
            if next_id not in visited:
                queue.append(next_id)
    return visited
