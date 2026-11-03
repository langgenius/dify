import copy

from core.workflow.editor_graph import EDITOR_CUSTOM_TYPE
from graphon.enums import BuiltinNodeTypes
from services.workflow.authoring.graph_wiring import fill_graph_wiring
from services.workflow_variable_reference_validator import SOURCE_HANDLE


def _node(node_id: str, node_type: str, **data: object) -> dict[str, object]:
    return {"id": node_id, "data": {"type": node_type, **data}}


def _at(value: object, *path: str | int) -> object:
    for key in path:
        if isinstance(key, int):
            assert isinstance(value, list)
            value = value[key]
        else:
            assert isinstance(value, dict)
            value = value[key]
    return value


def _skeleton() -> dict[str, list[dict[str, object]]]:
    return {
        "nodes": [
            _node("start", BuiltinNodeTypes.START),
            _node("scrape", BuiltinNodeTypes.TOOL),
            _node("llm", BuiltinNodeTypes.LLM),
            _node("end", BuiltinNodeTypes.END),
        ],
        "edges": [
            {"source": "start", "target": "scrape"},
            {"source": "scrape", "target": "llm"},
            {"source": "llm", "target": "end"},
        ],
    }


def test_skeleton_gets_wrappers_edges_and_layout() -> None:
    graph = _skeleton()

    fill_graph_wiring(graph)

    for node in graph["nodes"]:
        assert node["type"] == EDITOR_CUSTOM_TYPE
        assert _at(node, "data", "title") == _at(node, "data", "type")
        assert node["targetPosition"] == "left"
        assert node["sourcePosition"] == "right"
    positions = {(_at(n, "position", "x"), _at(n, "position", "y")) for n in graph["nodes"]}
    assert len(positions) == 4
    assert [e["id"] for e in graph["edges"]] == [
        "start-source-scrape-target",
        "scrape-source-llm-target",
        "llm-source-end-target",
    ]
    first = graph["edges"][0]
    assert first["sourceHandle"] == SOURCE_HANDLE
    assert first["targetHandle"] == "target"
    assert first["type"] == EDITOR_CUSTOM_TYPE
    assert _at(first, "data", "sourceType") == BuiltinNodeTypes.START
    assert _at(first, "data", "targetType") == BuiltinNodeTypes.TOOL


def test_seed_title_is_kept() -> None:
    graph = _skeleton()
    graph["nodes"][1] = _node("scrape", BuiltinNodeTypes.TOOL, title="Scrape page")

    fill_graph_wiring(graph)

    assert _at(graph, "nodes", 1, "data", "title") == "Scrape page"


def test_branch_source_without_handle_is_left_without_one() -> None:
    graph = {
        "nodes": [
            _node("branch", BuiltinNodeTypes.IF_ELSE, cases=[{"case_id": "case-1"}]),
            _node("end", BuiltinNodeTypes.END),
        ],
        "edges": [{"source": "branch", "target": "end"}],
    }

    fill_graph_wiring(graph)

    edge = graph["edges"][0]
    assert "sourceHandle" not in edge
    assert "id" not in edge
    assert edge["targetHandle"] == "target"


def test_branch_source_with_handle_gets_an_id() -> None:
    graph = {
        "nodes": [
            _node("branch", BuiltinNodeTypes.IF_ELSE, cases=[{"case_id": "case-1"}]),
            _node("end", BuiltinNodeTypes.END),
        ],
        "edges": [{"source": "branch", "sourceHandle": "case-1", "target": "end"}],
    }

    fill_graph_wiring(graph)

    assert graph["edges"][0]["id"] == "branch-case-1-end-target"


def test_fail_branch_source_without_handle_keeps_the_default() -> None:
    graph = {
        "nodes": [
            _node("scrape", BuiltinNodeTypes.TOOL, error_strategy="fail-branch"),
            _node("end", BuiltinNodeTypes.END),
        ],
        "edges": [{"source": "scrape", "target": "end"}],
    }

    fill_graph_wiring(graph)

    assert graph["edges"][0]["sourceHandle"] == SOURCE_HANDLE


def test_iteration_children_are_left_alone() -> None:
    child = {
        "id": "inner",
        "parentId": "loop-1",
        "type": "custom",
        "position": {"x": 5, "y": 6},
        "data": {"type": BuiltinNodeTypes.LLM},
    }
    expected_child = copy.deepcopy(child)
    graph = {
        "nodes": [
            _node("start", BuiltinNodeTypes.START),
            _node("loop-1", BuiltinNodeTypes.ITERATION),
            child,
        ],
        "edges": [{"source": "start", "target": "loop-1"}],
    }

    fill_graph_wiring(graph)

    assert child == expected_child
    assert graph["nodes"][1]["type"] == EDITOR_CUSTOM_TYPE


def test_non_custom_wrapper_is_left_alone() -> None:
    empty_edges: list[dict[str, object]] = []
    note = {"id": "note", "type": "custom-note", "data": {"type": "", "text": "hi"}}
    expected = copy.deepcopy(note)
    graph = {"nodes": [_node("start", BuiltinNodeTypes.START), note], "edges": empty_edges}

    fill_graph_wiring(graph)

    assert note == expected


def test_unknown_node_type_gets_only_the_wrapper() -> None:
    graph = {
        "nodes": [_node("mystery", "from-the-future", flag=True), _node("end", BuiltinNodeTypes.END)],
        "edges": [{"source": "mystery", "target": "end"}],
    }

    fill_graph_wiring(graph)

    node = graph["nodes"][0]
    assert node["type"] == EDITOR_CUSTOM_TYPE
    assert _at(node, "data", "flag") is True
    assert graph["edges"][0]["sourceHandle"] == SOURCE_HANDLE


def test_existing_positions_skip_layout() -> None:
    graph = _skeleton()
    graph["nodes"][0]["position"] = {"x": 1, "y": 2}

    fill_graph_wiring(graph)

    assert graph["nodes"][0]["position"] == {"x": 1, "y": 2}
    assert "position" not in graph["nodes"][1]


def test_second_call_changes_nothing() -> None:
    graph = _skeleton()
    fill_graph_wiring(graph)
    once = copy.deepcopy(graph)

    fill_graph_wiring(graph)

    assert graph == once


def test_graph_without_nodes_or_edges_is_untouched() -> None:
    graph: dict[str, list[dict[str, object]]] = {}

    fill_graph_wiring(graph)

    assert graph == {}


def test_node_without_readable_data_is_left_as_written() -> None:
    broken = {"id": "broken", "data": None}
    graph = {
        "nodes": [_node("start", BuiltinNodeTypes.START), broken],
        "edges": [{"source": "start", "target": "broken"}, {"source": "broken", "target": "start"}],
    }

    fill_graph_wiring(graph)

    assert broken == {"id": "broken", "data": None}
    assert _at(graph, "edges", 0, "id") == "start-source-broken-target"
    unreadable_source = _at(graph, "edges", 1)
    assert isinstance(unreadable_source, dict)
    assert "sourceHandle" not in unreadable_source
    assert "id" not in unreadable_source


def test_edge_from_a_missing_node_gets_no_source_handle() -> None:
    graph = {
        "nodes": [_node("end", BuiltinNodeTypes.END)],
        "edges": [{"source": "ghost", "target": "end"}],
    }

    fill_graph_wiring(graph)

    assert _at(graph, "edges", 0) == {"source": "ghost", "target": "end", "targetHandle": "target"}


def test_edge_to_a_missing_node_gets_no_edge_data() -> None:
    graph = {
        "nodes": [_node("start", BuiltinNodeTypes.START)],
        "edges": [{"source": "start", "target": "ghost"}],
    }

    fill_graph_wiring(graph)

    assert _at(graph, "edges", 0) == {
        "source": "start",
        "sourceHandle": "source",
        "target": "ghost",
        "targetHandle": "target",
        "id": "start-source-ghost-target",
    }


def test_edge_that_cannot_be_read_is_left_as_written() -> None:
    bad_data = {"source": "start", "target": "end", "data": None}
    bad_source = {"source": ["start"], "target": "end"}
    graph = {
        "nodes": [_node("start", BuiltinNodeTypes.START), _node("end", BuiltinNodeTypes.END)],
        "edges": [bad_data, bad_source, "start->end", None],
    }

    fill_graph_wiring(graph)

    assert bad_data == {"source": "start", "target": "end", "data": None}
    assert bad_source == {"source": ["start"], "target": "end"}
    assert graph["edges"][2:] == ["start->end", None]


def test_node_with_unreadable_parent_id_is_left_as_written() -> None:
    odd = {"id": "odd", "parentId": ["x"], "data": {"type": BuiltinNodeTypes.LLM}}
    expected = copy.deepcopy(odd)
    graph = {"nodes": [odd, _node("end", BuiltinNodeTypes.END)], "edges": [{"source": "odd", "target": "end"}]}

    fill_graph_wiring(graph)

    assert odd == expected
    edge = _at(graph, "edges", 0)
    assert isinstance(edge, dict)
    assert "sourceHandle" not in edge


def test_nodes_and_edges_that_are_not_lists_are_left_alone() -> None:
    graph = {"nodes": "none", "edges": {"a": 1}}

    fill_graph_wiring(graph)

    assert graph == {"nodes": "none", "edges": {"a": 1}}


def test_edge_between_iteration_children_gets_iteration_fields_and_children_stay() -> None:
    first = {"id": "a", "parentId": "iter", "type": "custom", "position": {"x": 1, "y": 1}, "data": {"type": "llm"}}
    second = {"id": "b", "parentId": "iter", "type": "custom", "position": {"x": 2, "y": 2}, "data": {"type": "llm"}}
    expected = copy.deepcopy([first, second])
    graph = {
        "nodes": [_node("iter", BuiltinNodeTypes.ITERATION), first, second],
        "edges": [{"source": "a", "target": "b"}],
    }

    fill_graph_wiring(graph)

    assert [first, second] == expected
    edge = _at(graph, "edges", 0)
    assert isinstance(edge, dict)
    assert edge["zIndex"] == 1002
    assert _at(edge, "data", "iteration_id") == "iter"
    assert _at(edge, "data", "isInIteration") is True
    assert edge["id"] == "a-source-b-target"


def test_null_position_counts_as_no_position() -> None:
    graph = _skeleton()
    graph["nodes"][0]["position"] = None

    fill_graph_wiring(graph)

    assert _at(graph, "nodes", 0, "position", "x") is not None
    assert _at(graph, "nodes", 1, "position", "x") is not None


def test_child_position_does_not_suppress_top_level_layout() -> None:
    child = {"id": "inner", "parentId": "iter", "type": "custom", "position": {"x": 5, "y": 6}, "data": {"type": "llm"}}
    no_edges: list[dict[str, object]] = []
    graph = {"nodes": [_node("iter", BuiltinNodeTypes.ITERATION), child], "edges": no_edges}

    fill_graph_wiring(graph)

    assert "position" in graph["nodes"][0]
    assert child["position"] == {"x": 5, "y": 6}
