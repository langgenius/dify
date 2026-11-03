"""Lay out a graph's top-level nodes as the canvas's Organize button does: left to right by depth, each branch's rows
in the order the canvas draws its handles, and no two nodes overlapping.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Final

from services.workflow.authoring.canvas_notes import (
    POSITION_KEY,
    Moves,
    NoteSize,
    coverable_nodes,
    is_number,
    node_length,
    place,
)
from services.workflow_variable_reference_validator import SOURCE_HANDLE, source_handle_order

# Where the first node sits, as in the editor layout (core/workflow/editor_graph.py).
ORIGIN: Final[Mapping[NoteSize, float]] = {NoteSize.WIDTH: 80.0, NoteSize.HEIGHT: 280.0}
# Organize's gaps between columns and between the nodes of one column (web workflow/utils/elk-layout.ts).
COLUMN_GAP: Final = 100
ROW_GAP: Final = 80


@dataclass(frozen=True)
class _Link:
    source: str
    handle_rank: int


def lay_out_nodes(graph: dict[str, Any]) -> Moves:
    """Place every top-level node that is not a note; nodes inside a container keep their place in it. Returns how
    far each node that had a position moved.
    """
    nodes = graph.get("nodes")
    if not isinstance(nodes, list):
        return {}
    placeable = {
        node_id: node
        for node_id, node in coverable_nodes(nodes).items()
        if isinstance(node, dict)
        if isinstance(node.get("data"), Mapping)
    }
    before = {node_id: _position(node) for node_id, node in placeable.items()}
    edges = graph.get("edges")
    links = _links(edges if isinstance(edges, list) else [], placeable)
    tops: dict[str, float] = {}
    left = ORIGIN[NoteSize.WIDTH]
    for column in _columns(list(placeable), links):
        _place_column(column, left=left, placeable=placeable, links=links, tops=tops)
        left += max(node_length(placeable[node_id], size=NoteSize.WIDTH) for node_id in column) + COLUMN_GAP
    return {
        node_id: {axis: placeable[node_id][POSITION_KEY][axis] - start for axis, start in old.items()}
        for node_id, old in before.items()
        if old is not None
    }


def _position(node: Mapping[str, Any]) -> dict[str, float] | None:
    position = node.get(POSITION_KEY)
    if not isinstance(position, Mapping):
        return None
    axes: dict[str, float] = {}
    for size in NoteSize:
        value = position.get(size.axis)
        if not is_number(value):
            return None
        axes[size.axis] = value
    return axes


def _links(edges: Sequence[object], placeable: Mapping[str, Mapping[str, Any]]) -> dict[str, list[_Link]]:
    """Each node's incoming links from other placeable nodes, with the rank of the handle they leave by."""
    links: dict[str, list[_Link]] = {node_id: [] for node_id in placeable}
    for edge in edges:
        if not isinstance(edge, Mapping):
            continue
        source, target = edge.get("source"), edge.get("target")
        if not isinstance(source, str) or not isinstance(target, str):
            continue
        if source == target or source not in placeable or target not in placeable:
            continue
        handles = source_handle_order(placeable[source]["data"])
        handle = edge.get("sourceHandle") or SOURCE_HANDLE
        links[target].append(_Link(source, handles.index(handle) if handle in handles else len(handles)))
    return links


def _columns(order: Sequence[str], links: Mapping[str, Sequence[_Link]]) -> list[list[str]]:
    """The nodes by longest-path depth, in file order; a node on a cycle goes one column past the deepest."""
    successors: dict[str, set[str]] = {node_id: set() for node_id in order}
    for target, incoming in links.items():
        for link in incoming:
            successors[link.source].add(target)
    waiting = {node_id: len({link.source for link in links[node_id]}) for node_id in order}
    depth = dict.fromkeys((node_id for node_id in order if waiting[node_id] == 0), 0)
    queue = list(depth)
    while queue:
        current = queue.pop(0)
        for successor in sorted(successors[current], key=order.index):
            depth[successor] = max(depth.get(successor, 0), depth[current] + 1)
            waiting[successor] -= 1
            if waiting[successor] == 0:
                queue.append(successor)
    overflow = max(depth.values(), default=-1) + 1
    columns: dict[int, list[str]] = {}
    for node_id in order:
        columns.setdefault(depth.get(node_id, overflow), []).append(node_id)
    return [columns[column] for column in sorted(columns)]


def _place_column(
    column: Sequence[str],
    *,
    left: float,
    placeable: Mapping[str, dict[str, Any]],
    links: Mapping[str, Sequence[_Link]],
    tops: dict[str, float],
) -> None:
    """Stack the column top down: each node level with the upstream node it hangs from, lower branches below,
    pushed down only as far as the node above it needs.
    """
    origin = ORIGIN[NoteSize.HEIGHT]

    def anchor(node_id: str) -> tuple[float, int]:
        placed = [(tops[link.source], link.handle_rank) for link in links[node_id] if link.source in tops]
        return min(placed, default=(origin, 0))

    floor = origin
    for node_id in sorted(column, key=lambda node_id: (*anchor(node_id), column.index(node_id))):
        top = max(anchor(node_id)[0], floor)
        place(placeable[node_id], {NoteSize.WIDTH.axis: left, NoteSize.HEIGHT.axis: top})
        tops[node_id] = top
        floor = top + node_length(placeable[node_id], size=NoteSize.HEIGHT) + ROW_GAP
