import copy
import itertools
import json
import math
from pathlib import Path
from typing import TypedDict

import pytest
import yaml

from constants.dsl_version import CURRENT_APP_DSL_VERSION
from graphon.enums import BuiltinNodeTypes
from models.model import AppMode
from services.workflow.authoring import FillContext
from services.workflow.authoring.canvas_notes import (
    NODE_HEIGHT,
    NODE_WIDTH,
    NOTE_PADDING,
    NOTE_TEXT_ROOM,
    NoteSize,
    is_lexical,
    lexical_text,
)
from services.workflow.authoring.fill import fill_graph_document
from services.workflow.graph_check import CANVAS_NOTE_TYPE

CTX = FillContext(tenant_id="tenant-1", account_id="account-1")
FIXTURES = Path(__file__).parents[4] / "fixtures" / "workflow"
NOTES_EXPORT = "book_translation_iteration_note_workflow.yml"
# The fixture's yellow note: two lines with an empty one between them, all plain text.
PLAIN_NOTE_ID = "1718991882984"
CHAIN = ["start", "first", "second", "end"]
PLAIN_NOTE_LINES = (
    "Avoid using a high token_limit, LLM's performance decreases with longer context length for gpt-4o. ",
    "",
    "Recommend to use less than or equal to 1000 tokens. ",
)


class _Position(TypedDict):
    x: float
    y: float


class _Node(TypedDict, total=False):
    id: str
    type: str
    parentId: str
    data: dict[str, object]
    position: _Position
    width: float
    height: float


def _node(node_id: str, node_type: str) -> _Node:
    return {"id": node_id, "data": {"type": node_type}}


def _note(note_id: str, *covers: str, **data: object) -> _Node:
    return {"id": note_id, "type": CANVAS_NOTE_TYPE, "data": {"type": "", "covers": list(covers), **data}}


def _chain(*extra: _Node) -> list[_Node]:
    """A start, two code nodes and an end, with `extra` after them."""
    types = [BuiltinNodeTypes.START, BuiltinNodeTypes.CODE, BuiltinNodeTypes.CODE, BuiltinNodeTypes.END]
    return [*itertools.starmap(_node, zip(CHAIN, types, strict=True)), *extra]


def _fill(nodes: list[_Node]) -> dict[str, _Node]:
    """Fill a workflow of `nodes`, the first four of them in a chain; the nodes by id, as filled in place."""
    edges = [{"source": source, "target": target} for source, target in itertools.pairwise(CHAIN)]
    document: dict[str, object] = {
        "kind": "app",
        "version": CURRENT_APP_DSL_VERSION,
        "app": {"mode": AppMode.WORKFLOW.value, "name": "Skeleton"},
        "workflow": {"graph": {"nodes": nodes, "edges": edges}},
    }
    fill_graph_document(document, CTX)
    return {node["id"]: node for node in nodes}


def _filled(*extra: _Node) -> dict[str, _Node]:
    return _fill(_chain(*extra))


def _frame(*nodes: _Node) -> dict[str, float]:
    """The note frame around `nodes`, each of the layout's default size."""
    left = min(node["position"]["x"] for node in nodes)
    top = min(node["position"]["y"] for node in nodes)
    right = max(node["position"]["x"] + NODE_WIDTH for node in nodes)
    bottom = max(node["position"]["y"] + NODE_HEIGHT for node in nodes)
    return {
        "x": left - NOTE_PADDING,
        "y": top - NOTE_PADDING - NOTE_TEXT_ROOM,
        "width": right - left + 2 * NOTE_PADDING,
        "height": bottom - top + 2 * NOTE_PADDING + NOTE_TEXT_ROOM,
    }


def _placed(note: _Node) -> dict[str, float]:
    position = note["position"]
    return {"x": position["x"], "y": position["y"], "width": note["width"], "height": note["height"]}


def test_each_note_frames_the_nodes_it_covers() -> None:
    nodes = _filled(_note("intake", "start", "first"), _note("output", "second", "end"))

    for note_id, covered in (("intake", ("start", "first")), ("output", ("second", "end"))):
        note = nodes[note_id]
        assert _placed(note) == _frame(*(nodes[node_id] for node_id in covered))
        assert note["data"]["width"] == note["width"]
        assert note["data"]["height"] == note["height"]
        assert note["data"]["covers"] == list(covered)


def test_a_filled_note_dumps_as_plain_yaml() -> None:
    nodes = _filled(_note("intake", "start", "first", text="a"))

    assert yaml.safe_load(yaml.dump(nodes["intake"])) == nodes["intake"]


def test_measured_node_sizes_are_used() -> None:
    nodes = _chain(_note("intake", "first"))
    nodes[1].update(width=300, height=150)

    note = _fill(nodes)["intake"]

    assert note["width"] == 300 + 2 * NOTE_PADDING
    assert note["height"] == 150 + 2 * NOTE_PADDING + NOTE_TEXT_ROOM


def test_a_note_is_never_smaller_than_the_resizer_allows() -> None:
    nodes = _chain(_note("intake", "first"))
    nodes[1].update(width=10, height=1)

    note = _fill(nodes)["intake"]

    assert note["width"] == NoteSize.WIDTH.minimum
    assert note["height"] == max(1 + 2 * NOTE_PADDING + NOTE_TEXT_ROOM, NoteSize.HEIGHT.minimum)


def test_a_note_is_framed_again_wherever_it_was_and_whatever_its_size() -> None:
    stale = _note("intake", "start", "first", width=500, height=20)
    stale.update(position={"x": 1.0, "y": 2.0}, width=500, height=20)

    nodes = _filled(stale)

    note = nodes["intake"]
    assert _placed(note) == _frame(nodes["start"], nodes["first"])
    assert (note["data"]["width"], note["data"]["height"]) == (note["width"], note["height"])


def test_a_note_drawn_over_nodes_gets_them_as_covers_and_frames_them() -> None:
    chain = _chain()
    first = _fill(chain)["first"]["position"]
    over = _note("over")
    del over["data"]["covers"]
    over.update(position={"x": first["x"] - 10, "y": first["y"] - 10}, width=NODE_WIDTH + 20, height=NODE_HEIGHT + 20)

    nodes = _fill([*chain, over])

    assert nodes["over"]["data"]["covers"] == ["first"]
    assert _placed(nodes["over"]) == _frame(nodes["first"])


def test_a_note_beside_the_nodes_moves_as_far_as_the_nearest_node() -> None:
    beside = _note("beside")
    del beside["data"]["covers"]
    beside.update(position={"x": 30.0, "y": 600.0}, width=240, height=88)
    chain = _chain(beside)
    for index, node in enumerate(chain[: len(CHAIN)]):
        node["position"] = {"x": 30.0 + 300 * index, "y": 300.0}

    nodes = _fill(chain)

    start = nodes["start"]["position"]
    assert "covers" not in nodes["beside"]["data"]
    assert nodes["beside"]["position"] == {"x": start["x"], "y": 600.0 + start["y"] - 300.0}


@pytest.mark.parametrize(
    "covers",
    [
        pytest.param(["first", "missing"], id="an unknown id"),
        pytest.param(["first", "child"], id="a node inside a container"),
        pytest.param([], id="none"),
        pytest.param("first", id="not a list"),
        pytest.param([["first"]], id="an id that is not text"),
    ],
)
def test_a_note_whose_covers_cannot_all_be_framed_is_not_sized(covers: object) -> None:
    child: _Node = {**_node("child", BuiltinNodeTypes.CODE), "parentId": "first", "position": {"x": 0.0, "y": 0.0}}
    note = _note("intake")
    note["data"]["covers"] = covers
    expected = copy.deepcopy(note)

    assert _filled(child, note)["intake"] == expected


def test_plain_text_becomes_editor_text_and_editor_text_is_kept() -> None:
    lexical = lexical_text("kept")
    nodes = _filled(_note("plain", text="one\ntwo"), _note("editor", text=lexical), _note("empty", text=""))

    assert nodes["plain"]["data"]["text"] == lexical_text("one\ntwo")
    assert nodes["editor"]["data"]["text"] == lexical
    assert nodes["empty"]["data"]["text"] == ""


@pytest.mark.parametrize("text", ["42", "true", '"quoted"', "[1, 2]"])
def test_plain_text_that_reads_as_json_other_than_an_object_is_converted(text: str) -> None:
    note = _filled(_note("plain", text=text))["plain"]

    assert note["data"]["text"] == lexical_text(text)


def test_a_json_object_is_kept_as_written_for_check_to_report() -> None:
    note = _filled(_note("broken", text='{"no": "root"}'))["broken"]

    assert note["data"]["text"] == '{"no": "root"}'


def test_fill_writes_no_theme_author_or_show_author() -> None:
    note = _filled(_note("intake", "first", text="hi"))["intake"]

    assert {"theme", "author", "showAuthor"}.isdisjoint(note["data"])


def test_filling_twice_gives_the_same_graph() -> None:
    once = _chain(_note("intake", "start", "first", text="a\nb"), _note("output", "second", "end"))
    _fill(once)
    twice = copy.deepcopy(once)
    _fill(twice)

    assert twice == once


def _centre(node: _Node) -> tuple[float, float]:
    width, height = node.get("width", NODE_WIDTH), node.get("height", NODE_HEIGHT)
    return node["position"]["x"] + width / 2, node["position"]["y"] + height / 2


def _offset(note: _Node, node: _Node) -> tuple[float, float]:
    return note["position"]["x"] - node["position"]["x"], note["position"]["y"] - node["position"]["y"]


def test_console_notes_keep_their_text_and_size_and_their_place_beside_the_nearest_node() -> None:
    document = yaml.safe_load((FIXTURES / NOTES_EXPORT).read_text())
    graph = document["workflow"]["graph"]
    notes = [node for node in graph["nodes"] if node.get("type") == CANVAS_NOTE_TYPE]
    top_level = [node for node in graph["nodes"] if node.get("type") != CANVAS_NOTE_TYPE and not node.get("parentId")]
    before = copy.deepcopy(notes)
    nearest = [min(top_level, key=lambda node, note=note: math.dist(_centre(node), _centre(note))) for note in notes]
    offsets = list(itertools.starmap(_offset, zip(notes, nearest, strict=True)))

    fill_graph_document(document, CTX)

    assert notes
    for note, old, node, offset in zip(notes, before, nearest, offsets, strict=True):
        assert note["data"] == old["data"]
        assert (note["width"], note["height"]) == (old["width"], old["height"])
        assert _offset(note, node) == pytest.approx(offset)


def test_lexical_text_matches_the_console_note_of_the_same_text() -> None:
    document = yaml.safe_load((FIXTURES / NOTES_EXPORT).read_text())
    [console] = [node["data"]["text"] for node in document["workflow"]["graph"]["nodes"] if node["id"] == PLAIN_NOTE_ID]

    assert lexical_text("\n".join(PLAIN_NOTE_LINES)) == console


def test_lexical_text_gives_one_paragraph_per_line() -> None:
    paragraphs = json.loads(lexical_text("a\nb"))["root"]["children"]

    assert [[child["text"] for child in paragraph["children"]] for paragraph in paragraphs] == [["a"], ["b"]]


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        (lexical_text("a"), True),
        ('{"root": {"children": []}}', True),
        ('{"root": {}}', False),
        ('{"root": "a"}', False),
        ('{"no": "root"}', False),
        ("[]", False),
        ("plain", False),
        ("", False),
    ],
)
def test_is_lexical(text: str, expected: bool) -> None:
    assert is_lexical(text) is expected
