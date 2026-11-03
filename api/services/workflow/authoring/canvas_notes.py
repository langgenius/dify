"""Canvas notes: plain text becomes the editor's text, and a note sits under the nodes it covers."""

import json
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from enum import StrEnum
from typing import Any, Final, Self, TypeGuard

from services.workflow.graph_check import CANVAS_NOTE_TYPE

COVERS_KEY: Final = "covers"
TEXT_KEY: Final = "text"
POSITION_KEY: Final = "position"
POSITION_ABSOLUTE_KEY: Final = "positionAbsolute"
_PARENT_KEY: Final = "parentId"
# The data type the canvas writes for a note: a note runs nothing, so it names no node type.
NOTE_DATA_TYPE: Final = ""

# The web's NODE_WIDTH, for a node the file gives no measured width.
NODE_WIDTH: Final = 240
# The node height the editor layout assumes (core/workflow/editor_graph.py), for a node with no measured height.
NODE_HEIGHT: Final = 100
# Clear air around the covered nodes, and room under them for the author line (12px padding and a 16px line).
NOTE_PADDING: Final = 32
# Room above the covered nodes for the note's 8px top bar, its 10px padding and three 18px lines of 12px text.
NOTE_TEXT_ROOM: Final = 72


class NoteTheme(StrEnum):
    """The themes the canvas draws a note in (web note-node/types.ts)."""

    BLUE = "blue"
    CYAN = "cyan"
    GREEN = "green"
    YELLOW = "yellow"
    PINK = "pink"
    VIOLET = "violet"


def _is_theme(value: object) -> bool:
    if not isinstance(value, str):
        return False
    return value in NoteTheme


def _is_text(value: object) -> bool:
    return isinstance(value, str)


def _is_flag(value: object) -> bool:
    return isinstance(value, bool)


class NoteField(StrEnum):
    """A note field only the web gives a value (operator/hooks.ts), so fill never writes it; with what the canvas
    can read there.
    """

    accepts: Callable[[object], bool]
    requirement: str

    def __new__(cls, value: str, accepts: Callable[[object], bool], requirement: str) -> Self:
        member = str.__new__(cls, value)
        member._value_ = value
        member.accepts = accepts
        member.requirement = requirement
        return member

    THEME = ("theme", _is_theme, f"a theme, one of {', '.join(NoteTheme)}")
    AUTHOR = ("author", _is_text, "an author, as text that may be empty")
    SHOW_AUTHOR = ("showAuthor", _is_flag, "showAuthor, true or false")


class NoteSize(StrEnum):
    """A note's size field, with its axis, the smallest value the canvas resizer allows, the size a node without a
    measured one is taken to have, and the room the note leaves before its covered nodes on that axis.
    """

    axis: str
    minimum: int
    node_default: int
    leading: int

    def __new__(cls, value: str, axis: str, minimum: int, node_default: int, leading: int) -> Self:
        member = str.__new__(cls, value)
        member._value_ = value
        member.axis = axis
        member.minimum = minimum
        member.node_default = node_default
        member.leading = leading
        return member

    WIDTH = ("width", "x", 240, NODE_WIDTH, NOTE_PADDING)
    HEIGHT = ("height", "y", 88, NODE_HEIGHT, NOTE_PADDING + NOTE_TEXT_ROOM)


@dataclass(frozen=True)
class _Extent:
    start: float
    length: float


type _Box = Mapping[NoteSize, _Extent]
# How far each node moved, by id, on each axis ("x", "y").
type Moves = Mapping[str, Mapping[str, float]]


def is_note(node: object) -> TypeGuard[dict[str, Any]]:
    """A canvas note whose data is a mapping."""
    if not isinstance(node, dict):
        return False
    if node.get("type") != CANVAS_NOTE_TYPE:
        return False
    return isinstance(node.get("data"), dict)


def coverable_nodes(nodes: Sequence[object]) -> dict[str, Mapping[str, Any]]:
    """The nodes a note can cover, by id: every top-level node that is not a note."""
    return {
        node["id"]: node
        for node in nodes
        if isinstance(node, Mapping)
        if isinstance(node.get("id"), str)
        if not node.get(_PARENT_KEY)
        if node.get("type") != CANVAS_NOTE_TYPE
    }


def fill_canvas_notes(graph: dict[str, Any], *, moves: Moves) -> None:
    """Fill each note in place: plain text becomes the editor's text, and a note whose `covers` all name nodes with
    a position is framed around them, replacing any size and position it had. Any other note moves as far as the
    node nearest it did, by `moves`.
    """
    nodes = graph.get("nodes")
    if not isinstance(nodes, list):
        return
    coverable = coverable_nodes(nodes)
    for note in nodes:
        if is_note(note):
            _fill_text(note["data"])
            if not _fill_frame(note, coverable):
                _follow_nearest(note, coverable, moves)


def fill_note_covers(graph: dict[str, Any]) -> None:
    """Give each note without `covers` the top-level nodes whose centre it is drawn over, so it can follow them when
    the nodes move. A note over no node is left as it is.
    """
    nodes = graph.get("nodes")
    if not isinstance(nodes, list):
        return
    coverable = coverable_nodes(nodes)
    for note in nodes:
        if is_note(note) and COVERS_KEY not in note["data"]:
            covered = _nodes_under(note, coverable)
            if covered:
                note["data"][COVERS_KEY] = covered


def _nodes_under(note: Mapping[str, Any], coverable: Mapping[str, Mapping[str, Any]]) -> list[str]:
    frame = _box(note, sizes=(note, note["data"]))
    if frame is None:
        return []
    return [node_id for node_id, node in coverable.items() if _centre_inside(_box(node), frame)]


def _centre_inside(box: _Box | None, frame: _Box) -> bool:
    if box is None:
        return False
    return all(frame[size].start <= _centre(box[size]) <= frame[size].start + frame[size].length for size in NoteSize)


class _LexicalType(StrEnum):
    ROOT = "root"
    PARAGRAPH = "paragraph"
    TEXT = "text"


_CHILDREN_KEY: Final = "children"
_LEXICAL_VERSION: Final = 1
_LEFT_TO_RIGHT: Final = "ltr"
_PLAIN_TEXT_FORMAT: Final = 0
_PLAIN_BLOCK_FORMAT: Final = ""
_NORMAL_MODE: Final = "normal"


def json_object(text: str) -> dict[str, Any] | None:
    """`text` read as a JSON object; None when it is not one."""
    try:
        value = json.loads(text)
    except ValueError:
        return None
    return value if isinstance(value, dict) else None


def text_loads(data: Mapping[str, Any]) -> bool:
    """Whether the canvas can open the note's text: none, plain text, which fill converts, or editor JSON."""
    text = data.get(TEXT_KEY)
    if text is None:
        return True
    if not isinstance(text, str):
        return False
    if json_object(text) is None:
        return True
    return is_lexical(text)


def is_lexical(text: str) -> bool:
    """Whether the note editor can load `text`: a JSON object whose `root` holds a list of children."""
    document = json_object(text)
    if document is None:
        return False
    root = document.get(_LexicalType.ROOT)
    if not isinstance(root, dict):
        return False
    return isinstance(root.get(_CHILDREN_KEY), list)


def lexical_text(text: str) -> str:
    """Plain text as the note editor stores it: one paragraph per line, each a single unstyled text run."""
    lines = text.splitlines()
    root = _block(_LexicalType.ROOT, [_paragraph(line) for line in lines], has_text=any(lines))
    return json.dumps({_LexicalType.ROOT: root}, ensure_ascii=False, separators=(",", ":"))


def _paragraph(line: str) -> dict[str, Any]:
    children = [_text_run(line)] if line else []
    return {**_block(_LexicalType.PARAGRAPH, children, has_text=bool(line)), "textFormat": _PLAIN_TEXT_FORMAT}


def _block(block_type: _LexicalType, children: list[dict[str, Any]], *, has_text: bool) -> dict[str, Any]:
    return {
        _CHILDREN_KEY: children,
        "direction": _LEFT_TO_RIGHT if has_text else None,
        "format": _PLAIN_BLOCK_FORMAT,
        "indent": 0,
        "type": block_type,
        "version": _LEXICAL_VERSION,
    }


def _text_run(line: str) -> dict[str, Any]:
    return {
        "detail": 0,
        "format": _PLAIN_TEXT_FORMAT,
        "mode": _NORMAL_MODE,
        "style": "",
        "text": line,
        "type": _LexicalType.TEXT,
        "version": _LEXICAL_VERSION,
    }


def _fill_text(data: dict[str, Any]) -> None:
    text = data.get(TEXT_KEY)
    if not isinstance(text, str):
        return
    if not text:
        return
    if json_object(text) is not None:
        return
    data[TEXT_KEY] = lexical_text(text)


def _fill_frame(note: dict[str, Any], coverable: Mapping[str, Mapping[str, Any]]) -> bool:
    boxes = _covered_boxes(note["data"].get(COVERS_KEY), coverable)
    if not boxes:
        return False
    position: dict[str, float] = {}
    for size in NoteSize:
        start = min(box[size].start for box in boxes) - size.leading
        end = max(box[size].start + box[size].length for box in boxes) + NOTE_PADDING
        position[size.axis] = start
        # The canvas reads the size from the data and the wrapper, so both get it.
        note[size.value] = note["data"][size.value] = max(end - start, size.minimum)
    place(note, position)
    return True


def _follow_nearest(note: dict[str, Any], coverable: Mapping[str, Mapping[str, Any]], moves: Moves) -> None:
    """Keep a note beside the node it was nearest before the nodes moved."""
    frame = _box(note, sizes=(note, note["data"]))
    if frame is None:
        return
    distances = {
        node_id: _distance(frame, box, moves[node_id])
        for node_id, node in coverable.items()
        if node_id in moves
        if (box := _box(node)) is not None
    }
    if not distances:
        return
    move = moves[min(distances, key=distances.__getitem__)]
    place(note, {size.axis: frame[size].start + move[size.axis] for size in NoteSize})


def _distance(frame: _Box, box: _Box, move: Mapping[str, float]) -> float:
    """From the note's centre to the node's centre where the node was before it moved."""
    return sum((_centre(frame[size]) - (_centre(box[size]) - move[size.axis])) ** 2 for size in NoteSize)


def _centre(extent: _Extent) -> float:
    return extent.start + extent.length / 2


def place(node: dict[str, Any], position: Mapping[str, float]) -> None:
    """Move a top-level node, and the absolute position the canvas saves beside it when the node has one."""
    node[POSITION_KEY] = dict(position)
    if POSITION_ABSOLUTE_KEY in node:
        node[POSITION_ABSOLUTE_KEY] = dict(position)


def _covered_boxes(covers: object, coverable: Mapping[str, Mapping[str, Any]]) -> list[_Box] | None:
    """The box of each covered node; None unless `covers` is a list whose every id names a node with a position."""
    if not isinstance(covers, list):
        return None
    boxes: list[_Box] = []
    for node_id in covers:
        if not isinstance(node_id, str):
            return None
        node = coverable.get(node_id)
        if node is None:
            return None
        box = _box(node)
        if box is None:
            return None
        boxes.append(box)
    return boxes


def _box(node: Mapping[str, Any], *, sizes: Sequence[Mapping[str, Any]] | None = None) -> _Box | None:
    """The node's extent on each axis; its size is read from the first of `sizes` that has one, default the node."""
    position = node.get(POSITION_KEY)
    if not isinstance(position, Mapping):
        return None
    box: dict[NoteSize, _Extent] = {}
    for size in NoteSize:
        start = position.get(size.axis)
        if not is_number(start):
            return None
        box[size] = _Extent(start, node_length(*(sizes or (node,)), size=size))
    return box


def node_length(*sources: Mapping[str, Any], size: NoteSize) -> float:
    """The first measured length of `size` among `sources`, else the one the canvas gives an unmeasured node."""
    return next((length for source in sources if is_number(length := source.get(size.value))), size.node_default)


def is_number(value: object) -> TypeGuard[float]:
    """A JSON number; a bool is not one."""
    if isinstance(value, bool):
        return False
    return isinstance(value, int | float)
