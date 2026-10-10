from collections.abc import Mapping

from models import AppMode
from services.workflow.graph_check import IssueCode, IssueSeverity, check_graph


def _node(node_id: str, data: dict[str, object]) -> dict[str, object]:
    return {"id": node_id, "data": data}


START = _node("start", {"type": "start", "title": "Start", "variables": []})
END = _node("end", {"type": "end", "title": "End", "outputs": []})


def _template(selector: list[str]) -> dict[str, object]:
    return _node(
        "t",
        {
            "type": "template-transform",
            "title": "T",
            "template": "{{ x }}",
            "variables": [{"variable": "x", "value_selector": selector}],
        },
    )


def _codes(graph: Mapping[str, object], mode: AppMode = AppMode.WORKFLOW) -> list[IssueCode]:
    return [issue.code for issue in check_graph(graph, mode=mode)]


def test_clean_graph_has_no_issues() -> None:
    graph = {
        "nodes": [START, END],
        "edges": [{"id": "e", "source": "start", "target": "end", "sourceHandle": "source"}],
    }
    assert _codes(graph) == []


def test_graph_without_nodes() -> None:
    assert _codes({"edges": []}) == [IssueCode.GRAPH_INVALID]
    assert _codes({"nodes": "x"}) == [IssueCode.GRAPH_INVALID]


def test_mode_incompatible_nodes() -> None:
    answer = _node("a", {"type": "answer", "title": "A", "answer": "hi"})
    issues = check_graph({"nodes": [START, answer], "edges": []}, mode=AppMode.WORKFLOW)
    assert [(i.code, i.node_id) for i in issues] == [(IssueCode.MODE_INCOMPATIBLE, "a")]


def test_unknown_type_and_invalid_data_are_located() -> None:
    weird = _node("w", {"type": "future-node", "title": "W"})
    llm = _node("l", {"type": "llm", "title": "L"})
    issues = {i.node_id: i for i in check_graph({"nodes": [START, weird, llm], "edges": []}, mode=AppMode.WORKFLOW)}
    assert issues["w"].code is IssueCode.UNKNOWN_NODE_TYPE
    assert issues["l"].code is IssueCode.NODE_DATA_INVALID
    assert issues["l"].loc[:3] == ("nodes", "l", "data")


def test_edges_must_point_at_nodes() -> None:
    graph = {"nodes": [START], "edges": [{"id": "e", "source": "start", "target": "ghost", "sourceHandle": "source"}]}
    assert _codes(graph) == [IssueCode.EDGE_ENDPOINT_MISSING]


def test_if_else_handles() -> None:
    branch = _node(
        "if",
        {"type": "if-else", "title": "If", "cases": [{"case_id": "c1", "logical_operator": "and", "conditions": []}]},
    )
    ok = {"id": "e1", "source": "if", "target": "end", "sourceHandle": "c1"}
    ok_false = {"id": "e2", "source": "if", "target": "end", "sourceHandle": "false"}
    bad = {"id": "e3", "source": "if", "target": "end", "sourceHandle": "true"}
    graph = {"nodes": [START, branch, END], "edges": [ok, ok_false, bad]}
    assert [(i.code, i.loc) for i in check_graph(graph, mode=AppMode.WORKFLOW)] == [
        (IssueCode.BRANCH_HANDLE_INVALID, ("edges", "e3", "sourceHandle"))
    ]


def test_references_to_missing_nodes() -> None:
    assert _codes({"nodes": [START, _template(["ghost", "text"])], "edges": []}) == [IssueCode.REFERENCE_MISSING]


def test_system_selectors_are_not_missing() -> None:
    assert _codes({"nodes": [START, _template(["sys", "user_id"])], "edges": []}) == []


def test_resource_problems_are_warnings() -> None:
    issues = check_graph({"nodes": [START, END], "edges": []}, mode=AppMode.WORKFLOW, resources=lambda _node: "no key")
    assert {i.code for i in issues} == {IssueCode.RESOURCE_UNAVAILABLE}
    assert all(i.code.severity is IssueSeverity.WARNING for i in issues)


def test_note_widgets_are_not_nodes() -> None:
    note = {"id": "n", "type": "custom-note", "data": {"type": "", "title": "", "text": "a note"}}
    assert _codes({"nodes": [START, note], "edges": []}) == []


def test_legacy_if_else_branches_on_true() -> None:
    branch = _node("if", {"type": "if-else", "title": "If", "logical_operator": "and", "conditions": []})
    edges = [
        {"id": "e1", "source": "if", "target": "end", "sourceHandle": "true"},
        {"id": "e2", "source": "if", "target": "end", "sourceHandle": "false"},
    ]
    assert _codes({"nodes": [START, branch, END], "edges": edges}) == []


def test_scalar_branch_lists_are_reported_not_raised() -> None:
    if_else = _node("if", {"type": "if-else", "title": "If", "cases": 5})
    classifier = _node("qc", {"type": "question-classifier", "title": "Q", "classes": 7})
    edges = [
        {"id": "e1", "source": "if", "target": "start", "sourceHandle": "true"},
        {"id": "e2", "source": "qc", "target": "start", "sourceHandle": "c1"},
    ]
    issues = check_graph({"nodes": [START, if_else, classifier], "edges": edges}, mode=AppMode.WORKFLOW)
    assert {i.node_id for i in issues if i.code is IssueCode.NODE_DATA_INVALID} == {"if", "qc"}


def test_unexpected_node_validation_error_is_located_and_later_nodes_are_checked() -> None:
    http = _node(
        "h",
        {
            "type": "http-request",
            "title": "H",
            "method": "get",
            "url": "https://x",
            "authorization": {"type": "oauth2", "config": {"type": "basic", "api_key": "k"}},
        },
    )
    llm = _node("l", {"type": "llm", "title": "L"})
    issues = check_graph({"nodes": [START, http, llm], "edges": []}, mode=AppMode.WORKFLOW)
    assert IssueCode.GRAPH_INVALID not in [i.code for i in issues]
    by_node = {i.node_id: i for i in issues}
    assert (by_node["h"].code, by_node["h"].loc) == (IssueCode.NODE_DATA_INVALID, ("nodes", "h", "data"))
    assert by_node["l"].code is IssueCode.NODE_DATA_INVALID
