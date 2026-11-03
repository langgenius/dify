import copy
import itertools
from collections.abc import Sequence
from typing import Unpack

import pytest
from typing_extensions import TypedDict

from core.trigger.constants import TRIGGER_SCHEDULE_NODE_TYPE
from core.workflow.nodes.human_input.constants import TIMEOUT_HANDLE
from graphon.enums import BuiltinNodeTypes, ErrorStrategy
from services.workflow.authoring.canvas_layout import COLUMN_GAP, ORIGIN, ROW_GAP, lay_out_nodes
from services.workflow.authoring.canvas_notes import NODE_HEIGHT, NODE_WIDTH, NoteSize
from services.workflow.graph_check import CANVAS_NOTE_TYPE

LEFT = ORIGIN[NoteSize.WIDTH]
TOP = ORIGIN[NoteSize.HEIGHT]
COLUMN = NODE_WIDTH + COLUMN_GAP

type _Edge = dict[str, str]


class _Position(TypedDict):
    x: float
    y: float


class _Wrapper(TypedDict, total=False, closed=True):
    position: _Position
    positionAbsolute: _Position
    width: float
    height: float
    parentId: str


class _Node(TypedDict, total=False, closed=True):
    id: str
    type: str
    data: dict[str, object] | None
    position: _Position
    positionAbsolute: _Position
    width: float
    height: float
    parentId: str


def _node(
    node_id: str,
    node_type: str = BuiltinNodeTypes.CODE,
    *,
    data: dict[str, object] | None = None,
    **wrapper: Unpack[_Wrapper],
) -> _Node:
    return _Node(id=node_id, type="custom", data={"type": node_type, **(data or {})}, **wrapper)


def _at(x: float, y: float) -> _Position:
    return {"x": x, "y": y}


def _edge(source: str, target: str, handle: str | None = None) -> _Edge:
    return {"source": source, "target": target, **({"sourceHandle": handle} if handle else {})}


def _chain(*node_ids: str) -> list[_Edge]:
    return list(itertools.starmap(_edge, itertools.pairwise(node_ids)))


def _laid_out(nodes: Sequence[_Node], edges: Sequence[object]) -> dict[str, tuple[float, float]]:
    lay_out_nodes({"nodes": list(nodes), "edges": list(edges)})
    return {node["id"]: (node["position"]["x"], node["position"]["y"]) for node in nodes if "position" in node}


def _overlapping(nodes: Sequence[_Node]) -> list[tuple[str, str]]:
    def box(node: _Node) -> tuple[float, float, float, float]:
        x, y = node["position"]["x"], node["position"]["y"]
        return x, y, x + node.get("width", NODE_WIDTH), y + node.get("height", NODE_HEIGHT)

    placed = [node for node in nodes if node.get("type") != CANVAS_NOTE_TYPE and not node.get("parentId")]
    return [
        (a["id"], b["id"])
        for a, b in itertools.combinations(placed, 2)
        if (ba := box(a))[0] < (bb := box(b))[2] and bb[0] < ba[2] and ba[1] < bb[3] and bb[1] < ba[3]
    ]


def test_a_chain_runs_left_to_right_on_one_row() -> None:
    nodes = [_node(node_id) for node_id in ("start", "a", "b", "end")]

    positions = _laid_out(nodes, _chain("start", "a", "b", "end"))

    assert positions == {
        node_id: (LEFT + COLUMN * index, TOP) for index, node_id in enumerate(("start", "a", "b", "end"))
    }


def test_a_wide_node_widens_its_column() -> None:
    nodes = [_node("start"), _node("wide", width=500), _node("end")]

    positions = _laid_out(nodes, _chain("start", "wide", "end"))

    assert positions["end"][0] == positions["wide"][0] + 500 + COLUMN_GAP


def test_every_node_is_placed_again_and_its_absolute_position_follows() -> None:
    nodes = [
        _node("start", position=_at(5000, 5000), positionAbsolute=_at(5000, 5000)),
        _node("end", position=_at(1, 1)),
    ]

    lay_out_nodes({"nodes": nodes, "edges": _chain("start", "end")})

    assert nodes[0]["position"] == nodes[0]["positionAbsolute"] == {"x": LEFT, "y": TOP}
    assert nodes[1]["position"] == {"x": LEFT + COLUMN, "y": TOP}
    assert "positionAbsolute" not in nodes[1]


def test_a_node_inserted_mid_chain_overlaps_nothing() -> None:
    """The draft an agent built slice by slice: each slice's new nodes were placed around the old ones."""
    nodes = [
        _node("trigger", TRIGGER_SCHEDULE_NODE_TYPE, position=_at(80, 280)),
        _node("get_date", BuiltinNodeTypes.TOOL, position=_at(400, 280)),
        _node("search", BuiltinNodeTypes.TOOL, position=_at(720, 280), height=192),
        _node("trim", position=_at(1040, 280)),
        _node("summarize", BuiltinNodeTypes.LLM, position=_at(1040, 280)),
        _node("check", BuiltinNodeTypes.IF_ELSE, data={"cases": [{"case_id": "has_news"}]}, position=_at(1360, 280)),
        _node("post", BuiltinNodeTypes.TOOL, position=_at(2000, 440)),
        _node("end_post", BuiltinNodeTypes.END, position=_at(720, 280)),
        _node("end_none", BuiltinNodeTypes.END, position=_at(1680, 440)),
    ]
    edges = [
        *_chain("trigger", "get_date", "search", "trim", "summarize", "check"),
        _edge("check", "post", "has_news"),
        _edge("check", "end_none", "false"),
        _edge("post", "end_post"),
    ]

    positions = _laid_out(nodes, edges)

    assert _overlapping(nodes) == []
    chain = ["trigger", "get_date", "search", "trim", "summarize", "check", "post", "end_post"]
    assert [positions[node_id][1] for node_id in chain] == [TOP] * len(chain)
    assert [positions[node_id][0] for node_id in chain] == sorted(positions[node_id][0] for node_id in chain)
    assert positions["end_none"] == (positions["post"][0], TOP + NODE_HEIGHT + ROW_GAP)


@pytest.mark.parametrize(
    ("branch", "handles"),
    [
        pytest.param(
            _node("branch", BuiltinNodeTypes.IF_ELSE, data={"cases": [{"case_id": "first"}, {"case_id": "second"}]}),
            ["first", "second", "false"],
            id="if-else cases, then else",
        ),
        pytest.param(
            _node(
                "branch",
                BuiltinNodeTypes.QUESTION_CLASSIFIER,
                data={"classes": [{"id": "1"}, {"id": "2"}, {"id": "3"}]},
            ),
            ["1", "2", "3"],
            id="classifier classes",
        ),
        pytest.param(
            _node("branch", BuiltinNodeTypes.HUMAN_INPUT, data={"user_actions": [{"id": "approve"}, {"id": "reject"}]}),
            ["approve", "reject", TIMEOUT_HANDLE],
            id="human-input actions, then timeout",
        ),
        pytest.param(
            _node("branch", BuiltinNodeTypes.LLM, data={"error_strategy": ErrorStrategy.FAIL_BRANCH}),
            ["source", ErrorStrategy.FAIL_BRANCH.value],
            id="success, then fail branch",
        ),
    ],
)
def test_branch_rows_follow_the_order_the_canvas_draws_the_handles(branch: _Node, handles: list[str]) -> None:
    targets = [f"to_{handle}" for handle in handles]
    nodes = [_node("start"), branch, *(_node(target) for target in reversed(targets))]
    edges = [_edge("start", "branch"), *(_edge("branch", f"to_{handle}", handle) for handle in reversed(handles))]

    positions = _laid_out(nodes, edges)

    assert [positions[target][1] for target in targets] == [
        TOP + (NODE_HEIGHT + ROW_GAP) * row for row in range(len(targets))
    ]


def test_a_tall_node_pushes_the_row_below_it_down() -> None:
    branch = _node("branch", BuiltinNodeTypes.IF_ELSE, data={"cases": [{"case_id": "yes"}]})
    nodes = [_node("start"), branch, _node("tall", height=300), _node("other")]
    edges = [_edge("start", "branch"), _edge("branch", "tall", "yes"), _edge("branch", "other", "false")]

    positions = _laid_out(nodes, edges)

    assert positions["other"][1] == TOP + 300 + ROW_GAP


def test_a_join_sits_right_of_its_deepest_branch_level_with_its_top_one() -> None:
    branch = _node("branch", BuiltinNodeTypes.IF_ELSE, data={"cases": [{"case_id": "long"}]})
    nodes = [branch, _node("a"), _node("b"), _node("short"), _node("join")]
    edges = [
        _edge("branch", "a", "long"),
        *_chain("a", "b", "join"),
        _edge("branch", "short", "false"),
        _edge("short", "join"),
    ]

    positions = _laid_out(nodes, edges)

    assert positions["join"] == (positions["b"][0] + COLUMN, TOP)
    assert _overlapping(nodes) == []


def test_nodes_on_a_cycle_go_one_column_past_the_deepest() -> None:
    nodes = [_node("start"), _node("end"), _node("ping"), _node("pong")]
    edges = [_edge("start", "end"), _edge("ping", "pong"), _edge("pong", "ping")]

    positions = _laid_out(nodes, edges)

    assert positions["ping"][0] == positions["pong"][0] == LEFT + 2 * COLUMN
    assert _overlapping(nodes) == []


def test_nodes_inside_a_container_notes_and_unreadable_nodes_keep_their_place() -> None:
    child = _node("child", parentId="loop", position=_at(24, 68))
    note: _Node = {"id": "note", "type": CANVAS_NOTE_TYPE, "data": {"type": ""}, "position": _at(9, 9)}
    unreadable: _Node = {"id": "broken", "type": "custom", "data": None, "position": _at(7, 7)}
    nodes = [_node("start"), _node("loop", BuiltinNodeTypes.LOOP, width=600), _node("end"), child, note, unreadable]
    untouched = copy.deepcopy([child, note, unreadable])
    edges = [*_chain("start", "loop", "end"), _edge("end", "missing"), _edge("end", "end"), "not an edge"]

    positions = _laid_out(nodes, edges)

    assert [child, note, unreadable] == untouched
    assert positions["end"][0] == positions["loop"][0] + 600 + COLUMN_GAP


def test_moves_say_how_far_each_placed_node_moved() -> None:
    nodes = [_node("start", position=_at(0, 0)), _node("end")]

    moves = lay_out_nodes({"nodes": nodes, "edges": _chain("start", "end")})

    assert moves == {"start": {"x": LEFT, "y": TOP}}


def test_laying_out_twice_moves_nothing() -> None:
    branch = _node("branch", BuiltinNodeTypes.IF_ELSE, data={"cases": [{"case_id": "yes"}]})
    graph = {
        "nodes": [_node("start"), branch, _node("yes"), _node("no")],
        "edges": [_edge("start", "branch"), _edge("branch", "yes", "yes"), _edge("branch", "no", "false")],
    }
    lay_out_nodes(graph)
    once = copy.deepcopy(graph)

    moves = lay_out_nodes(graph)

    assert graph == once
    assert all(move == {"x": 0, "y": 0} for move in moves.values())


@pytest.mark.parametrize("graph", [{}, {"nodes": "not a list"}, {"nodes": [], "edges": "not a list"}])
def test_a_graph_without_a_node_list_is_left_alone(graph: dict[str, object]) -> None:
    before = copy.deepcopy(graph)

    assert lay_out_nodes(graph) == {}
    assert graph == before
