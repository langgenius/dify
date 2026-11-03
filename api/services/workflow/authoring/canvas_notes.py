"""Canvas notes an agent writes: plain text becomes the editor's text, and a note sits under the nodes it covers."""

import json
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from enum import StrEnum
from typing import Any, Final, Self, TypeGuard

from services.workflow.graph_check import CANVAS_NOTE_TYPE

COVERS_KEY: Final = "covers"
TEXT_KEY: Final = "text"
POSITION_KEY: Final = "position"
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


def fill_canvas_notes(graph: dict[str, Any]) -> None:
    """Fill each note in place: plain text becomes the editor's text, and a note whose `covers` all name nodes with
    a position gets the size and position that frame them. A value already set is kept.
    """
    nodes = graph.get("nodes")
    if not isinstance(nodes, list):
        return
    coverable = coverable_nodes(nodes)
    for note in nodes:
        if is_note(note):
            _fill_text(note["data"])
            _fill_frame(note, coverable)


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


def _fill_frame(note: dict[str, Any], coverable: Mapping[str, Mapping[str, Any]]) -> None:
    boxes = _covered_boxes(note["data"].get(COVERS_KEY), coverable)
    if not boxes:
        return
    position: dict[str, float] = {}
    for size in NoteSize:
        start = min(box[size].start for box in boxes) - size.leading
        end = max(box[size].start + box[size].length for box in boxes) + NOTE_PADDING
        position[size.axis] = start
        _fill_size(note, size, max(end - start, size.minimum))
    if note.get(POSITION_KEY) is None:
        note[POSITION_KEY] = position


def _fill_size(note: dict[str, Any], size: NoteSize, framed: float) -> None:
    """The canvas reads the size from the data and the wrapper, so both get the one the caller set, else `framed`."""
    data = note["data"]
    value = next((value for value in (note.get(size), data.get(size)) if value is not None), framed)
    for target in (note, data):
        if target.get(size) is None:
            target[size.value] = value


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


def _box(node: Mapping[str, Any]) -> _Box | None:
    position = node.get(POSITION_KEY)
    if not isinstance(position, Mapping):
        return None
    box: dict[NoteSize, _Extent] = {}
    for size in NoteSize:
        start = position.get(size.axis)
        if not is_number(start):
            return None
        length = node.get(size)
        box[size] = _Extent(start, length if is_number(length) else size.node_default)
    return box


def is_number(value: object) -> TypeGuard[float]:
    """A JSON number; a bool is not one."""
    if isinstance(value, bool):
        return False
    return isinstance(value, int | float)
