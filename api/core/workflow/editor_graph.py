"""The fields the console editor adds to a graph's nodes and edges, and the layout it gives them."""

from collections.abc import Mapping
from typing import Any, Final

from graphon.enums import BuiltinNodeTypes

EDITOR_CUSTOM_TYPE: Final = "custom"
_TARGET_POSITION: Final = "left"
_SOURCE_POSITION: Final = "right"
_CONTAINED_EDGE_Z_INDEX: Final = 1002

_NODE_X_OFFSET = 80
_NODE_X_STEP = 320
_NODE_Y = 280
# Vertical gap between lanes when two branches share the same topological
# depth (e.g. the two arms of an if-else). Default node height is 100, so
# 160 leaves clear air between stacked nodes.
_NODE_Y_STEP = 160


def editor_node_wrapper(node: dict[str, Any], *, position: Mapping[str, float] | None) -> None:
    if "type" in node:
        return
    node["type"] = EDITOR_CUSTOM_TYPE
    if position is not None:
        node.setdefault("position", dict(position))
    node.setdefault("targetPosition", _TARGET_POSITION)
    node.setdefault("sourcePosition", _SOURCE_POSITION)


def editor_edge_id(edge: Mapping[str, Any]) -> str:
    return f"{edge['source']}-{edge['sourceHandle']}-{edge['target']}-{edge['targetHandle']}"


def editor_edge_data(edge: dict[str, Any], *, nodes_by_id: Mapping[str, Mapping[str, Any]]) -> None:
    """Fill the edge fields the canvas renders from, keeping any value already set."""
    edge.setdefault("type", EDITOR_CUSTOM_TYPE)
    source = nodes_by_id.get(edge.get("source", ""), {})
    target = nodes_by_id.get(edge.get("target", ""), {})
    data = edge.setdefault("data", {})
    data.setdefault("sourceType", source.get("data", {}).get("type", ""))
    data.setdefault("targetType", target.get("data", {}).get("type", ""))

    parent_id = source.get("parentId")
    shared_parent = nodes_by_id.get(parent_id) if parent_id and parent_id == target.get("parentId") else None
    parent_type = shared_parent.get("data", {}).get("type", "") if shared_parent is not None else ""
    in_iteration = parent_type == BuiltinNodeTypes.ITERATION
    in_loop = parent_type == BuiltinNodeTypes.LOOP
    data.setdefault("isInIteration", in_iteration)
    data.setdefault("isInLoop", in_loop)
    if in_iteration:
        data.setdefault("iteration_id", parent_id)
        edge.setdefault("zIndex", _CONTAINED_EDGE_Z_INDEX)
    if in_loop:
        data.setdefault("loop_id", parent_id)
        edge.setdefault("zIndex", _CONTAINED_EDGE_Z_INDEX)


def layout_top_level_nodes(*, nodes: list[dict[str, Any]], edges: list[dict[str, Any]]) -> None:
    """
    Lay out top-level nodes by graph topology instead of array order.

    x = longest-path depth from the entry layer, y = lane within the
    layer — so an if-else's two arms render as two parallel rows instead
    of overlapping on one line, and a builder that emits nodes out of
    execution order still gets a left-to-right canvas. Longest-path (not
    BFS) layering keeps a join node (variable-aggregator, end) to the
    right of its deepest branch.

    Cycle-safe: Kahn's algorithm simply never reaches nodes on a cycle,
    and those get parked one layer past the deepest laid-out node in
    declaration order — the cycle itself is flagged by the structural
    validator afterwards.
    """
    top_level = [n for n in nodes if not n.get("parentId") and isinstance(n.get("id"), str) and n.get("id")]
    id_set = {n["id"] for n in top_level}

    succs: dict[str, list[str]] = {node_id: [] for node_id in id_set}
    indegree: dict[str, int] = dict.fromkeys(id_set, 0)
    seen_pairs: set[tuple[str, str]] = set()
    for edge in edges:
        src, tgt = edge.get("source"), edge.get("target")
        if not isinstance(src, str) or not isinstance(tgt, str):
            continue
        if src not in id_set or tgt not in id_set or src == tgt or (src, tgt) in seen_pairs:
            continue
        seen_pairs.add((src, tgt))
        succs[src].append(tgt)
        indegree[tgt] += 1

    depth: dict[str, int] = {}
    queue = [n["id"] for n in top_level if indegree[n["id"]] == 0]
    for node_id in queue:
        depth[node_id] = 0
    while queue:
        cur = queue.pop(0)
        for nxt in succs[cur]:
            depth[nxt] = max(depth.get(nxt, 0), depth[cur] + 1)
            indegree[nxt] -= 1
            if indegree[nxt] == 0:
                queue.append(nxt)

    overflow_depth = (max(depth.values()) + 1) if depth else 0
    lanes: dict[int, int] = {}
    for node in top_level:
        d = depth.get(node["id"], overflow_depth)
        lane = lanes.get(d, 0)
        lanes[d] = lane + 1
        node["position"] = {
            "x": float(_NODE_X_OFFSET + _NODE_X_STEP * d),
            "y": float(_NODE_Y + _NODE_Y_STEP * lane),
        }
