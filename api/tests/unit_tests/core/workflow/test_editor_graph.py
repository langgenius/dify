from core.workflow.editor_graph import (
    editor_edge_data,
    editor_edge_id,
    editor_node_wrapper,
    layout_top_level_nodes,
)
from services.app import console_gateway


def _node(node_id: str, node_type: str, **extra: object) -> dict[str, object]:
    return {"id": node_id, "data": {"type": node_type, "title": node_id}, **extra}


def test_edge_id_joins_endpoints_and_handles() -> None:
    edge = {"source": "a", "sourceHandle": "source", "target": "b", "targetHandle": "target"}

    assert editor_edge_id(edge) == "a-source-b-target"


def test_node_wrapper_adds_the_editor_fields() -> None:
    node = _node("a", "llm")

    editor_node_wrapper(node, position={"x": 1.0, "y": 2.0})

    assert node["type"] == "custom"
    assert node["position"] == {"x": 1.0, "y": 2.0}
    assert node["targetPosition"] == "left"
    assert node["sourcePosition"] == "right"


def test_node_wrapper_without_position_leaves_position_out() -> None:
    node = _node("a", "llm")

    editor_node_wrapper(node, position=None)

    assert "position" not in node
    assert node["type"] == "custom"


def test_node_wrapper_skips_a_node_that_already_has_a_wrapper_type() -> None:
    node = _node("inner", "iteration-start", type="custom-iteration-start", position={"x": 5, "y": 6})

    editor_node_wrapper(node, position={"x": 1.0, "y": 2.0})

    assert node == _node("inner", "iteration-start", type="custom-iteration-start", position={"x": 5, "y": 6})


def test_node_wrapper_never_overwrites_an_existing_position() -> None:
    node = _node("a", "llm", position={"x": 7, "y": 8}, sourcePosition="bottom")

    editor_node_wrapper(node, position={"x": 1.0, "y": 2.0})

    assert node["position"] == {"x": 7, "y": 8}
    assert node["sourcePosition"] == "bottom"
    assert node["targetPosition"] == "left"


def test_edge_data_fills_types_and_container_flags() -> None:
    nodes = {"a": _node("a", "start"), "b": _node("b", "llm")}
    edge = {"source": "a", "target": "b"}

    editor_edge_data(edge, nodes_by_id=nodes)

    assert edge == {
        "source": "a",
        "target": "b",
        "type": "custom",
        "data": {"sourceType": "start", "targetType": "llm", "isInIteration": False, "isInLoop": False},
    }


def test_edge_data_marks_edges_inside_a_container() -> None:
    nodes = {
        "it": _node("it", "iteration"),
        "lp": _node("lp", "loop"),
        "i1": _node("i1", "llm", parentId="it"),
        "i2": _node("i2", "llm", parentId="it"),
        "l1": _node("l1", "llm", parentId="lp"),
        "l2": _node("l2", "llm", parentId="lp"),
    }
    in_iteration = {"source": "i1", "target": "i2"}
    in_loop = {"source": "l1", "target": "l2"}
    crossing = {"source": "i1", "target": "l1"}

    for edge in (in_iteration, in_loop, crossing):
        editor_edge_data(edge, nodes_by_id=nodes)

    assert in_iteration == {
        "source": "i1",
        "target": "i2",
        "type": "custom",
        "zIndex": 1002,
        "data": {
            "sourceType": "llm",
            "targetType": "llm",
            "isInIteration": True,
            "isInLoop": False,
            "iteration_id": "it",
        },
    }
    assert in_loop == {
        "source": "l1",
        "target": "l2",
        "type": "custom",
        "zIndex": 1002,
        "data": {"sourceType": "llm", "targetType": "llm", "isInIteration": False, "isInLoop": True, "loop_id": "lp"},
    }
    assert crossing == {
        "source": "i1",
        "target": "l1",
        "type": "custom",
        "data": {"sourceType": "llm", "targetType": "llm", "isInIteration": False, "isInLoop": False},
    }


def test_edge_data_keeps_every_value_the_caller_wrote() -> None:
    nodes = {"a": _node("a", "start"), "b": _node("b", "llm")}
    edge = {
        "source": "a",
        "target": "b",
        "type": "mine",
        "zIndex": 3,
        "data": {"sourceType": "x", "targetType": "y", "isInIteration": True, "isInLoop": True},
    }

    editor_edge_data(edge, nodes_by_id=nodes)

    assert edge == {
        "source": "a",
        "target": "b",
        "type": "mine",
        "zIndex": 3,
        "data": {"sourceType": "x", "targetType": "y", "isInIteration": True, "isInLoop": True},
    }


def test_layout_puts_branches_in_lanes_and_joins_right_of_the_deepest_branch() -> None:
    nodes = [
        _node("start", "start"),
        _node("a", "llm"),
        _node("b", "llm"),
        _node("join", "end"),
    ]
    edges = [
        {"source": "start", "target": "a"},
        {"source": "start", "target": "b"},
        {"source": "a", "target": "join"},
        {"source": "b", "target": "join"},
        {"source": "start", "target": "join"},
    ]

    layout_top_level_nodes(nodes=nodes, edges=edges)

    assert {n["id"]: n["position"] for n in nodes} == {
        "start": {"x": 80.0, "y": 280.0},
        "a": {"x": 400.0, "y": 280.0},
        "b": {"x": 400.0, "y": 440.0},
        "join": {"x": 720.0, "y": 280.0},
    }


def test_layout_leaves_container_children_alone() -> None:
    nodes = [_node("it", "iteration"), _node("inner", "llm", parentId="it", position={"x": 60.0, "y": 78.0})]

    layout_top_level_nodes(nodes=nodes, edges=[])

    assert nodes[1]["position"] == {"x": 60.0, "y": 78.0}


def test_console_starter_nodes_are_shaped_by_the_shared_wrapper() -> None:
    node = console_gateway._editor_node("llm", 1, {"type": "llm", "title": "LLM"})

    assert node == {
        "id": "llm",
        "type": "custom",
        "data": {"type": "llm", "title": "LLM"},
        "position": {"x": 380, "y": 282},
        "targetPosition": "left",
        "sourcePosition": "right",
    }
