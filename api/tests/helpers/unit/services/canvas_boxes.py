"""The boxes laid-out canvas nodes take up, for asserting that nothing overlaps or leaves its container."""

import itertools
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Final

from services.workflow.authoring.canvas_layout import CONTAINER_PADDING, START_CHILD_SIZE
from services.workflow.authoring.canvas_notes import NoteSize, is_number, measured_length
from services.workflow.graph_check import CANVAS_NOTE_TYPE, START_NODE_ID_KEY

type CanvasNode = Mapping[str, object]

_UNMEASURED: Final[Mapping[NoteSize, float]] = {size: size.node_default for size in NoteSize}


@dataclass(frozen=True)
class Box:
    left: float
    top: float
    right: float
    bottom: float

    def overlaps(self, other: "Box") -> bool:
        if self.right <= other.left:
            return False
        if other.right <= self.left:
            return False
        if self.bottom <= other.top:
            return False
        return self.top < other.bottom


def node_box(node: CanvasNode, *, unmeasured: Mapping[NoteSize, float] = _UNMEASURED) -> Box:
    """The node's box at its position, its measured size, else `unmeasured`'s."""
    position = node.get("position")
    assert isinstance(position, Mapping)
    left, top = position.get("x"), position.get("y")
    assert is_number(left)
    assert is_number(top)
    width, height = (_length(node, size, unmeasured) for size in NoteSize)
    return Box(left, top, left + width, top + height)


def _length(node: CanvasNode, size: NoteSize, unmeasured: Mapping[NoteSize, float]) -> float:
    measured = measured_length(node, size=size)
    return unmeasured[size] if measured is None else measured


def top_level_boxes(nodes: Sequence[CanvasNode]) -> dict[str, Box]:
    """The box of each top-level node that is not a note."""
    return {
        str(node["id"]): node_box(node)
        for node in nodes
        if not node.get("parentId")
        if node.get("type") != CANVAS_NOTE_TYPE
    }


def child_boxes(nodes: Sequence[CanvasNode], container: CanvasNode) -> dict[str, Box]:
    """Each child's box from its container's corner, an unmeasured start child at the size the canvas draws it."""
    data = container.get("data")
    assert isinstance(data, Mapping)
    start = data.get(START_NODE_ID_KEY)
    return {
        str(node["id"]): node_box(node, unmeasured=START_CHILD_SIZE if node["id"] == start else _UNMEASURED)
        for node in nodes
        if node.get("parentId") == container["id"]
    }


def overlapping(boxes: Mapping[str, Box]) -> list[tuple[str, str]]:
    return [(a, b) for a, b in itertools.combinations(boxes, 2) if boxes[a].overlaps(boxes[b])]


def assert_holds_its_children(nodes: Sequence[CanvasNode], container: CanvasNode) -> None:
    """The container's children overlap nothing, and its size, the same on its wrapper and data, holds them with
    Organize's padding.
    """
    boxes = child_boxes(nodes, container)
    assert boxes
    assert overlapping(boxes) == []
    data = container.get("data")
    assert isinstance(data, Mapping)
    width, height = container.get("width"), container.get("height")
    assert is_number(width)
    assert is_number(height)
    assert (data.get("width"), data.get("height")) == (width, height)
    for box in boxes.values():
        assert box.left >= 0
        assert box.top >= 0
    assert width >= max(box.right for box in boxes.values()) + CONTAINER_PADDING[NoteSize.WIDTH]
    assert height >= max(box.bottom for box in boxes.values()) + CONTAINER_PADDING[NoteSize.HEIGHT]
