from collections.abc import Mapping
from typing import cast
from unittest.mock import Mock, patch

import pytest
from sqlalchemy.orm import Session

from models import AppMode
from services.workflow.graph_check import IssueCode, IssueSeverity, check_graph, credential_check
from services.workflow_service import WorkflowService


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


@pytest.mark.parametrize(
    ("graph", "loc"),
    [
        ({"nodes": [{"id": "a", "data": None}], "edges": []}, ("nodes", "a", "data")),
        ({"nodes": [{"id": "a", "data": [1]}], "edges": []}, ("nodes", "a", "data")),
        ({"nodes": [{"id": "a"}], "edges": []}, ("nodes", "a", "data")),
        ({"nodes": [5], "edges": []}, ("nodes", 0)),
        ({"nodes": [START, None], "edges": []}, ("nodes", 1)),
        ({"nodes": [{"data": {"type": "start"}}], "edges": []}, ("nodes", 0, "id")),
        ({"nodes": [{"id": {"x": 1}, "data": {"type": "start"}}], "edges": []}, ("nodes", 0, "id")),
        ({"nodes": [{"id": "", "data": {"type": "start"}}], "edges": []}, ("nodes", 0, "id")),
        ({"nodes": [START], "edges": 5}, ("edges",)),
        ({"nodes": [START], "edges": "start->end"}, ("edges",)),
        ({"nodes": [START], "edges": [{"source": "start", "target": "end"}, 7]}, ("edges", 1)),
    ],
)
def test_malformed_shapes_are_graph_issues_not_errors(graph: Mapping[str, object], loc: tuple[object, ...]) -> None:
    issues = check_graph(graph, mode=AppMode.WORKFLOW, resources=credential_check("ws-1", {}, cast(Session, Mock())))
    assert [(i.code, i.loc) for i in issues] == [(IssueCode.GRAPH_INVALID, loc)]


def test_missing_edges_are_no_edges() -> None:
    assert _codes({"nodes": [START]}) == []


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


@pytest.fixture(autouse=True)
def service_without_storage():
    with (
        patch.object(WorkflowService, "__init__", return_value=None),
        patch.object(WorkflowService, "_is_load_balancing_enabled", return_value=False),
    ):
        yield


def test_credential_check_reports_what_publish_refuses_for_a_node() -> None:
    llm = _node("l", {"type": "llm", "model": {"provider": "openai", "name": "gpt-4o"}})
    check = credential_check("ws-1", {}, cast(Session, Mock()))

    with patch.object(WorkflowService, "_validate_llm_model_config", side_effect=ValueError("no credential")) as v:
        assert check(llm) == "no credential"

    v.assert_called_once_with("ws-1", "openai", "gpt-4o")


def test_credential_check_wraps_unexpected_errors_with_the_node() -> None:
    llm = _node("l", {"type": "llm", "model": {"provider": "openai", "name": "gpt-4o"}})
    check = credential_check("ws-1", {}, cast(Session, Mock()))

    with patch.object(WorkflowService, "_validate_llm_model_config", side_effect=RuntimeError("boom")):
        assert check(llm) == "Node l (llm): boom"


@pytest.mark.parametrize("node_type", ["knowledge-retrieval", "parameter-extractor", "question-classifier"])
def test_credential_check_matches_publish_for_model_nodes_publish_skips(node_type: str) -> None:
    """Publish lists these types with underscores, so it never checks them; the release check must agree."""
    node = _node("n", {"type": node_type, "model": {"provider": "openai", "name": "gpt-4o"}})
    check = credential_check("ws-1", {}, cast(Session, Mock()))

    with patch.object(WorkflowService, "_validate_llm_model_config", side_effect=ValueError("no credential")) as v:
        assert check(node) is None

    v.assert_not_called()
