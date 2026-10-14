"""Execution-path completeness for fresh, full Builder generation only.

A value selector describes data, not execution wiring. Refuse incomplete fresh
candidates so the existing bounded generation correction can repair their plan;
never infer edges, rewrite configurations, or constrain authored partial drafts.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import TYPE_CHECKING, Any, Literal

if TYPE_CHECKING:
    from core.dify_builder.models import MutationIntent

_CONTAINER_TYPES = frozenset({"iteration", "loop"})
_MARKER_TYPES = frozenset({"iteration-start", "loop-start"})


def generated_build_completeness_problems(
    intents: Sequence[MutationIntent],
    *,
    mode: Literal["workflow", "advanced-chat"],
    current_graph: Mapping[str, Any] | None,
) -> list[str]:
    """Check execution topology projected from the grounded applicable batch.

    Fresh generation creates explicit IDs and connects them. The native create
    owner sets data.type from node_type and parentId from parent_id; defaults
    and config heals do not change those fields or connect endpoints. Project
    exactly those owned effects rather than checking the pre-grounding response.
    """
    nodes: list[dict[str, Any]] = []
    edges: list[dict[str, Any]] = []
    for intent in intents:
        args = intent.args
        if intent.op == "create_node":
            nodes.append(
                {
                    "id": args["node_id"],
                    "data": {"type": args["node_type"]},
                    "parentId": args.get("parent_id"),
                }
            )
        elif intent.op == "connect":
            edges.append({"source": args["from_node"], "target": args["to_node"]})
    return generated_graph_completeness_problems(
        {"nodes": nodes, "edges": edges}, mode=mode, current_graph=current_graph
    )


def generated_graph_completeness_problems(
    graph: Mapping[str, Any],
    *,
    mode: Literal["workflow", "advanced-chat"],
    current_graph: Mapping[str, Any] | None,
) -> list[str]:
    """Require each top-level executable node on a Start-to-terminal path.

    ``current_graph`` is the caller's generation context, not model output:
    any existing graph identifies refinement and receives no new restriction.
    Containers are top-level execution units; their properly parented children
    and synthetic start markers are not ordinary workflow-level entry/sink
    nodes. Their internal topology remains the native container validator's
    responsibility. Notes are canvas-only. Native ordinary node identities,
    including legacy aggregator aliases, require no rewriting to participate.
    """
    if current_graph is not None:
        return []
    nodes, edges = graph.get("nodes"), graph.get("edges")
    if not isinstance(nodes, list) or not isinstance(edges, list):
        return ["the full generated graph requires nodes and edges arrays"]

    by_id: dict[str, Mapping[str, Any]] = {}
    types: dict[str, str] = {}
    for node in nodes:
        if not isinstance(node, Mapping) or node.get("type") == "custom-note":
            continue
        data = node.get("data")
        if not isinstance(data, Mapping) or not data.get("type"):
            continue
        node_id = node.get("id")
        if not isinstance(node_id, str) or not node_id:
            return ["an executable node in the full generated graph has no valid ID"]
        if node_id in by_id:
            return [f"the full generated graph has duplicate node ID {node_id!r}"]
        by_id[node_id] = node
        types[node_id] = str(data["type"])

    top_level: set[str] = set()
    for node_id, node in by_id.items():
        parent = node.get("parentId")
        if parent:
            # Only actual, acyclic container ownership exempts an inner node.
            seen = {node_id}
            while parent:
                if not isinstance(parent, str) or parent in seen or types.get(parent) not in _CONTAINER_TYPES:
                    return [f"node {node_id!r} has no valid container parent in the full generated graph"]
                seen.add(parent)
                parent = by_id[parent].get("parentId")
            continue
        if types[node_id] in _MARKER_TYPES:
            return [f"container start marker {node_id!r} has no container parent"]
        top_level.add(node_id)

    starts = {node_id for node_id in top_level if types[node_id] == "start"}
    terminal_type = "end" if mode == "workflow" else "answer"
    terminals = {node_id for node_id in top_level if types[node_id] == terminal_type}
    if len(starts) != 1:
        return [f"the full generated graph requires exactly one top-level Start node; found {len(starts)}"]
    if not terminals:
        return [f"the full generated {mode} graph requires a top-level {terminal_type!r} terminal node"]

    successors: dict[str, set[str]] = {}
    predecessors: dict[str, set[str]] = {}
    for edge in edges:
        if not isinstance(edge, Mapping):
            continue
        source, target = edge.get("source"), edge.get("target")
        if isinstance(source, str) and isinstance(target, str) and source in top_level and target in top_level:
            successors.setdefault(source, set()).add(target)
            predecessors.setdefault(target, set()).add(source)

    def reachable(seeds: set[str], adjacency: Mapping[str, set[str]]) -> set[str]:
        visited: set[str] = set()
        pending = list(seeds)
        while pending:
            node_id = pending.pop()
            if node_id in visited:
                continue
            visited.add(node_id)
            pending.extend(adjacency.get(node_id, set()) - visited)
        return visited

    from_start = reachable(starts, successors)
    to_terminal = reachable(terminals, predecessors)
    problems = [
        f"node {node_id!r} ({types[node_id]}) is unreachable from Start in the full generated graph; "
        "regenerate the complete execution wiring"
        for node_id in sorted(top_level - from_start)
    ]
    problems.extend(
        f"node {node_id!r} ({types[node_id]}) has no execution path to an {terminal_type!r} terminal; "
        "regenerate the complete execution wiring instead of relying on value selectors"
        for node_id in sorted(from_start - to_terminal)
    )
    return problems
