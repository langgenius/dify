import copy
import itertools
from collections.abc import Sequence
from typing import Unpack

import pytest
from typing_extensions import TypedDict

from core.trigger.constants import TRIGGER_SCHEDULE_NODE_TYPE
from core.workflow.nodes.human_input.constants import TIMEOUT_HANDLE
from graphon.enums import BuiltinNodeTypes, ErrorStrategy
from services.workflow.authoring.canvas_layout import (
    CHILD_COLUMN_GAP,
    CHILD_ROW_GAP,
    COLUMN_GAP,
    CONTAINER_PADDING,
    ORIGIN,
    ROW_GAP,
    START_CHILD_SIZE,
    lay_out_nodes,
)
from services.workflow.authoring.canvas_notes import NODE_HEIGHT, NODE_WIDTH, NoteSize
from services.workflow.graph_check import CANVAS_NOTE_TYPE
from tests.helpers.unit.services.canvas_boxes import assert_holds_its_children, overlapping, top_level_boxes

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

    assert overlapping(top_level_boxes(nodes)) == []
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
    assert overlapping(top_level_boxes(nodes)) == []


def test_nodes_on_a_cycle_go_one_column_past_the_deepest() -> None:
    nodes = [_node("start"), _node("end"), _node("ping"), _node("pong")]
    edges = [_edge("start", "end"), _edge("ping", "pong"), _edge("pong", "ping")]

    positions = _laid_out(nodes, edges)

    assert positions["ping"][0] == positions["pong"][0] == LEFT + 2 * COLUMN
    assert overlapping(top_level_boxes(nodes)) == []


def test_notes_and_unreadable_nodes_keep_their_place() -> None:
    note: _Node = {"id": "note", "type": CANVAS_NOTE_TYPE, "data": {"type": ""}, "position": _at(9, 9)}
    unreadable: _Node = {"id": "broken", "type": "custom", "data": None, "position": _at(7, 7)}
    nodes = [_node("start"), _node("loop", BuiltinNodeTypes.LOOP, width=600), _node("end"), note, unreadable]
    untouched = copy.deepcopy([note, unreadable])
    edges = [*_chain("start", "loop", "end"), _edge("end", "missing"), _edge("end", "end"), "not an edge"]

    positions = _laid_out(nodes, edges)

    assert [note, unreadable] == untouched
    assert positions["end"][0] == positions["loop"][0] + 600 + COLUMN_GAP


_CONTAINERS = [
    pytest.param(BuiltinNodeTypes.ITERATION, BuiltinNodeTypes.ITERATION_START, id="iteration"),
    pytest.param(BuiltinNodeTypes.LOOP, BuiltinNodeTypes.LOOP_START, id="loop"),
]


def _container(
    container_id: str, container_type: str, start_type: str, *children: str, **wrapper: Unpack[_Wrapper]
) -> tuple[list[_Node], list[_Edge]]:
    """A container, its start child and `children` chained after it, all placed where an agent drops them."""
    start = f"{container_id}_start"
    nodes = [
        _node(container_id, container_type, data={"start_node_id": start}, **wrapper),
        _node(start, start_type, parentId=container_id, position=_at(24, 68)),
        *(_node(child, parentId=container_id, position=_at(24, 68)) for child in children),
    ]
    return nodes, _chain(start, *children)


@pytest.mark.parametrize(("container_type", "start_type"), _CONTAINERS)
def test_a_container_lays_out_its_children_inside_it_and_grows_to_hold_them(
    container_type: str, start_type: str
) -> None:
    contained, inner_edges = _container("box", container_type, start_type, "a", "b", "c")
    nodes = [_node("start"), *contained, _node("after")]

    positions = _laid_out(nodes, [*_chain("start", "box", "after"), *inner_edges])

    box = contained[0]
    assert_holds_its_children(nodes, box)
    padding = (CONTAINER_PADDING[NoteSize.WIDTH], CONTAINER_PADDING[NoteSize.HEIGHT])
    assert positions["box_start"] == padding
    step = NODE_WIDTH + CHILD_COLUMN_GAP
    first = padding[0] + START_CHILD_SIZE[NoteSize.WIDTH] + CHILD_COLUMN_GAP
    assert [positions[child] for child in ("a", "b", "c")] == [(first + step * i, padding[1]) for i in range(3)]
    assert box["width"] == first + 2 * step + NODE_WIDTH + padding[0]
    assert box["height"] == NODE_HEIGHT + 2 * padding[1]
    assert positions["after"][0] == positions["box"][0] + box["width"] + COLUMN_GAP
    assert overlapping(top_level_boxes(nodes)) == []


def test_a_container_branch_stacks_its_rows_with_the_child_row_gap() -> None:
    contained, inner_edges = _container("box", BuiltinNodeTypes.ITERATION, BuiltinNodeTypes.ITERATION_START, "split")
    branch = contained[2]
    assert branch["data"] is not None
    branch["data"].update(type=BuiltinNodeTypes.IF_ELSE, cases=[{"case_id": "yes"}])
    nodes = [*contained, _node("yes", parentId="box"), _node("no", parentId="box")]
    edges = [*inner_edges, _edge("split", "yes", "yes"), _edge("split", "no", "false")]

    positions = _laid_out(nodes, edges)

    assert positions["no"] == (positions["yes"][0], positions["yes"][1] + NODE_HEIGHT + CHILD_ROW_GAP)
    assert_holds_its_children(nodes, contained[0])


@pytest.mark.parametrize(
    ("wrapper", "data"),
    [
        pytest.param({"width": 2000, "height": 900}, {}, id="sized on the wrapper"),
        pytest.param({}, {"width": 2000, "height": 900}, id="sized in the data"),
        pytest.param({"width": 3000, "height": 1200}, {"width": 2000, "height": 900}, id="stale wrapper"),
    ],
)
def test_a_container_keeps_the_drawn_size_when_larger_than_its_children_need(
    wrapper: _Wrapper, data: dict[str, object]
) -> None:
    contained, inner_edges = _container("box", BuiltinNodeTypes.LOOP, BuiltinNodeTypes.LOOP_START, "a", **wrapper)
    box_data = contained[0]["data"]
    assert box_data is not None
    box_data.update(data)

    lay_out_nodes({"nodes": contained, "edges": inner_edges})

    assert (contained[0]["width"], contained[0]["height"]) == (2000, 900)
    assert (box_data["width"], box_data["height"]) == (2000, 900)


def test_a_childless_container_sized_in_its_data_widens_its_column() -> None:
    loop = _node("loop", BuiltinNodeTypes.LOOP, data={"width": 700}, width=300)
    nodes = [_node("start"), loop, _node("end")]

    positions = _laid_out(nodes, _chain("start", "loop", "end"))

    assert positions["end"][0] == positions["loop"][0] + 700 + COLUMN_GAP


def test_a_measured_start_child_keeps_its_measured_size() -> None:
    contained, inner_edges = _container("box", BuiltinNodeTypes.LOOP, BuiltinNodeTypes.LOOP_START, "a")
    contained[1].update(width=100, height=50)

    positions = _laid_out(contained, inner_edges)

    assert positions["a"][0] == CONTAINER_PADDING[NoteSize.WIDTH] + 100 + CHILD_COLUMN_GAP


def test_a_childs_absolute_position_follows_its_container() -> None:
    contained, inner_edges = _container("box", BuiltinNodeTypes.ITERATION, BuiltinNodeTypes.ITERATION_START, "a")
    contained[2]["positionAbsolute"] = _at(1, 1)
    nodes = [_node("start"), *contained]

    lay_out_nodes({"nodes": nodes, "edges": [*_chain("start", "box"), *inner_edges]})

    box, child = contained[0], contained[2]
    assert child["positionAbsolute"] == {axis: box["position"][axis] + child["position"][axis] for axis in ("x", "y")}
    assert "positionAbsolute" not in contained[1]


def test_a_container_inside_a_container_is_laid_out_inside_out() -> None:
    outer, outer_edges = _container("outer", BuiltinNodeTypes.LOOP, BuiltinNodeTypes.LOOP_START, "before")
    inner, inner_edges = _container(
        "inner", BuiltinNodeTypes.ITERATION, BuiltinNodeTypes.ITERATION_START, "a", "b", "c"
    )
    inner[0]["parentId"] = "outer"
    inner[0]["positionAbsolute"] = _at(0, 0)
    inner[3]["positionAbsolute"] = _at(0, 0)
    nodes = [_node("start"), *outer, *inner, _node("after")]
    edges = [*_chain("start", "outer", "after"), *outer_edges, _edge("before", "inner"), *inner_edges]

    positions = _laid_out(nodes, edges)

    assert_holds_its_children(nodes, inner[0])
    assert_holds_its_children(nodes, outer[0])
    assert positions["inner"][0] == positions["before"][0] + NODE_WIDTH + CHILD_COLUMN_GAP
    assert positions["after"][0] == positions["outer"][0] + outer[0]["width"] + COLUMN_GAP
    assert inner[3]["positionAbsolute"] == {
        axis: outer[0]["position"][axis] + inner[0]["position"][axis] + inner[3]["position"][axis]
        for axis in ("x", "y")
    }


def test_laying_out_containers_twice_moves_nothing() -> None:
    contained, inner_edges = _container("box", BuiltinNodeTypes.ITERATION, BuiltinNodeTypes.ITERATION_START, "a", "b")
    graph = {
        "nodes": [_node("start"), *contained, _node("end")],
        "edges": [*_chain("start", "box", "end"), *inner_edges],
    }
    lay_out_nodes(graph)
    once = copy.deepcopy(graph)

    lay_out_nodes(graph)

    assert graph == once


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
