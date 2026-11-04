"""Lay out a graph as the canvas's Organize button does: each container's children inside it, the container grown
to hold them, then the top-level nodes; left to right by depth, each branch's rows in the order the canvas draws its
handles, and no two nodes overlapping.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Final

from services.workflow.authoring.canvas_notes import (
    POSITION_ABSOLUTE_KEY,
    POSITION_KEY,
    Moves,
    NoteSize,
    coverable_nodes,
    is_number,
    measured_length,
    place,
)
from services.workflow.graph_check import CONTAINER_NODE_TYPES, START_NODE_ID_KEY
from services.workflow_variable_reference_validator import SOURCE_HANDLE, source_handle_order

# Where the first node sits, as in the editor layout (core/workflow/editor_graph.py).
ORIGIN: Final[Mapping[NoteSize, float]] = {NoteSize.WIDTH: 80.0, NoteSize.HEIGHT: 280.0}
# Organize's gaps between columns and between the nodes of one column (web workflow/utils/elk-layout.ts).
COLUMN_GAP: Final = 100
ROW_GAP: Final = 80
# The same gaps between the nodes inside a container (CHILD_LAYOUT_OPTIONS, web workflow/utils/elk-layout.ts:116).
CHILD_COLUMN_GAP: Final = 80
CHILD_ROW_GAP: Final = 60
# The room Organize leaves on every side of a container's children: NODE_LAYOUT_HORIZONTAL_PADDING and
# NODE_LAYOUT_VERTICAL_PADDING (web workflow/constants.ts:28), applied in hooks/use-workflow-organize.helpers.ts:38,131.
CONTAINER_PADDING: Final[Mapping[NoteSize, float]] = {NoteSize.WIDTH: 60, NoteSize.HEIGHT: 60}
# The size the canvas draws a container's start node at, `size-11` under `mt-1` (web workflow/nodes/iteration-start
# and loop-start index.tsx:12), for one the file gives no measured size.
START_CHILD_SIZE: Final[Mapping[NoteSize, float]] = {NoteSize.WIDTH: 44, NoteSize.HEIGHT: 48}
_UNMEASURED: Final[Mapping[NoteSize, float]] = {size: size.node_default for size in NoteSize}


@dataclass(frozen=True)
class _Link:
    source: str
    handle_rank: int


@dataclass(frozen=True)
class _Spacing:
    """Where a level's first node sits, and the gaps between its columns and between the nodes of one column."""

    origin: Mapping[NoteSize, float]
    column_gap: float
    row_gap: float


_TOP_LEVEL: Final = _Spacing(ORIGIN, COLUMN_GAP, ROW_GAP)
_INSIDE_CONTAINER: Final = _Spacing(CONTAINER_PADDING, CHILD_COLUMN_GAP, CHILD_ROW_GAP)

type _Lengths = Mapping[NoteSize, float]


@dataclass(frozen=True)
class _Level:
    """Nodes laid out together, the top level or one container's children, with their sizes and incoming links."""

    nodes: Mapping[str, dict[str, Any]]
    lengths: Mapping[str, _Lengths]
    links: Mapping[str, Sequence[_Link]]
    spacing: _Spacing


def lay_out_nodes(graph: dict[str, Any]) -> Moves:
    """Place every node that is not a note: each container's children inside it, inner containers first, with the
    container grown to hold them, then the top-level nodes at their containers' new sizes. Returns how far each
    top-level node that had a position moved. Laying out a container inside a container goes beyond Organize: the
    canvas cannot make one, so Organize lays out only top-level containers, but the engine runs one, so fill lays it
    out inside out.
    """
    nodes = graph.get("nodes")
    if not isinstance(nodes, list):
        return {}
    graph_edges = graph.get("edges")
    edges = graph_edges if isinstance(graph_edges, list) else []
    top = _placeable(nodes, parent=None)
    before = {node_id: _position(node) for node_id, node in top.items()}
    for node in top.values():
        _fit_children(node, nodes=nodes, edges=edges)
    lengths = {node_id: _lengths(node) for node_id, node in top.items()}
    _lay_out(_Level(top, lengths, _links(edges, top), _TOP_LEVEL))
    for node_id, node in top.items():
        _anchor_children(node_id, at=node[POSITION_KEY], nodes=nodes)
    return {
        node_id: {axis: top[node_id][POSITION_KEY][axis] - start for axis, start in old.items()}
        for node_id, old in before.items()
        if old is not None
    }


def _placeable(nodes: Sequence[object], *, parent: str | None) -> dict[str, dict[str, Any]]:
    """The nodes directly inside `parent` that are not notes and whose data can be read, by id."""
    return {
        node_id: node
        for node_id, node in coverable_nodes(nodes, parent=parent).items()
        if isinstance(node, dict)
        if isinstance(node.get("data"), dict)
    }


def _drawn_from(node: Mapping[str, Any]) -> tuple[Mapping[str, Any], ...]:
    """Where the canvas reads a node's size: a container is drawn at its data's (web workflow/nodes/_base/node.tsx:173),
    its wrapper's only when the data has none.
    """
    if _is_container(node["data"]):
        return node["data"], node
    return (node,)


def _lengths(node: Mapping[str, Any], *, unmeasured: Mapping[NoteSize, float] = _UNMEASURED) -> dict[NoteSize, float]:
    """The node's size as the canvas draws it, `unmeasured`'s on an axis the file gives no size for."""
    lengths: dict[NoteSize, float] = {}
    for size in NoteSize:
        measured = measured_length(*_drawn_from(node), size=size)
        lengths[size] = unmeasured[size] if measured is None else measured
    return lengths


def _is_container(data: Mapping[str, Any]) -> bool:
    node_type = data.get("type")
    if not isinstance(node_type, str):
        return False
    return node_type in CONTAINER_NODE_TYPES


def _fit_children(container: dict[str, Any], *, nodes: Sequence[object], edges: Sequence[object]) -> None:
    """Lay out a container's children inside it, any container among them first, and grow the container to hold
    them as Organize does, never shrinking it (web hooks/use-workflow-organize.helpers.ts:44). A node that is not a
    container, or a container with no children, is left as it is.
    """
    data = container["data"]
    if not _is_container(data):
        return
    children = _placeable(nodes, parent=container["id"])
    if not children:
        return
    for child in children.values():
        _fit_children(child, nodes=nodes, edges=edges)
    start = data.get(START_NODE_ID_KEY)
    lengths = {
        child_id: _lengths(child, unmeasured=START_CHILD_SIZE if child_id == start else _UNMEASURED)
        for child_id, child in children.items()
    }
    _lay_out(_Level(children, lengths, _links(edges, children), _INSIDE_CONTAINER))
    for size in NoteSize:
        end = max(child[POSITION_KEY][size.axis] + lengths[child_id][size] for child_id, child in children.items())
        current = measured_length(*_drawn_from(container), size=size) or 0
        # The canvas reads the size from the data and the wrapper, so both get it.
        container[size.value] = data[size.value] = max(current, end + CONTAINER_PADDING[size])


def _anchor_children(parent_id: str, *, at: Mapping[str, float], nodes: Sequence[object]) -> None:
    """Give each node inside `parent_id` that saves an absolute position the one it now has, `at` being the
    parent's, and the same for the nodes inside it.
    """
    placed = [
        (child_id, child, position)
        for child_id, child in _placeable(nodes, parent=parent_id).items()
        if (position := _position(child)) is not None
    ]
    for child_id, child, position in placed:
        absolute = {axis: at[axis] + offset for axis, offset in position.items()}
        if POSITION_ABSOLUTE_KEY in child:
            child[POSITION_ABSOLUTE_KEY] = absolute
        _anchor_children(child_id, at=absolute, nodes=nodes)


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


def _lay_out(level: _Level) -> None:
    tops: dict[str, float] = {}
    left = level.spacing.origin[NoteSize.WIDTH]
    for column in _columns(list(level.nodes), level.links):
        _place_column(column, left=left, level=level, tops=tops)
        left += max(level.lengths[node_id][NoteSize.WIDTH] for node_id in column) + level.spacing.column_gap


def _place_column(column: Sequence[str], *, left: float, level: _Level, tops: dict[str, float]) -> None:
    """Stack the column top down: each node level with the upstream node it hangs from, lower branches below,
    pushed down only as far as the node above it needs.
    """
    origin = level.spacing.origin[NoteSize.HEIGHT]

    def anchor(node_id: str) -> tuple[float, int]:
        placed = [(tops[link.source], link.handle_rank) for link in level.links[node_id] if link.source in tops]
        return min(placed, default=(origin, 0))

    floor = origin
    for node_id in sorted(column, key=lambda node_id: (*anchor(node_id), column.index(node_id))):
        top = max(anchor(node_id)[0], floor)
        place(level.nodes[node_id], {NoteSize.WIDTH.axis: left, NoteSize.HEIGHT.axis: top})
        tops[node_id] = top
        floor = top + level.lengths[node_id][NoteSize.HEIGHT] + level.spacing.row_gap
