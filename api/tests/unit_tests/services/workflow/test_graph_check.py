from collections.abc import Mapping

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
        ({"nodes": [START, START], "edges": []}, ("nodes", 1, "id")),
        ({"nodes": [START, {"id": "start", "data": None}], "edges": []}, ("nodes", 1, "id")),
        ({"nodes": [START, {"id": "start", "type": "custom-note", "data": {}}], "edges": []}, ("nodes", 1, "id")),
        ({"nodes": [START], "edges": 5}, ("edges",)),
        ({"nodes": [START], "edges": "start->end"}, ("edges",)),
        ({"nodes": [START], "edges": [{"source": "start", "target": "end"}, 7]}, ("edges", 1)),
    ],
)
def test_malformed_shapes_are_graph_issues_not_errors(
    sqlite_session: Session, graph: Mapping[str, object], loc: tuple[object, ...]
) -> None:
    issues = check_graph(graph, mode=AppMode.WORKFLOW, resources=credential_check("ws-1", {}, sqlite_session))
    assert [(i.code, i.loc) for i in issues] == [(IssueCode.GRAPH_INVALID, loc)]


def test_every_repeat_of_a_node_id_is_reported() -> None:
    issues = check_graph({"nodes": [START, END, START, START], "edges": []}, mode=AppMode.WORKFLOW)
    assert [(i.code, i.node_id, i.loc) for i in issues] == [
        (IssueCode.GRAPH_INVALID, "start", ("nodes", 2, "id")),
        (IssueCode.GRAPH_INVALID, "start", ("nodes", 3, "id")),
    ]


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


def _unconnected(graph: Mapping[str, object]) -> list[str]:
    issues = check_graph(graph, mode=AppMode.WORKFLOW)
    return [i.message for i in issues if i.code is IssueCode.BRANCH_UNCONNECTED]


def test_fail_branch_classifier_is_not_asked_for_a_source_edge() -> None:
    classifier = _node(
        "qc",
        {
            "type": "question-classifier",
            "title": "Q",
            "classes": [{"id": "c1", "name": "a"}],
            "error_strategy": "fail-branch",
        },
    )
    edges = [
        {"id": "e0", "source": "start", "target": "qc", "sourceHandle": "source"},
        {"id": "e1", "source": "qc", "target": "end", "sourceHandle": "c1"},
        {"id": "e2", "source": "qc", "target": "end", "sourceHandle": "fail-branch"},
    ]
    assert _unconnected({"nodes": [START, classifier, END], "edges": edges}) == []


def test_fail_branch_ordinary_node_still_needs_its_source_edge() -> None:
    code = _node("c", {"type": "code", "title": "C", "error_strategy": "fail-branch"})
    edges = [
        {"id": "e0", "source": "start", "target": "c", "sourceHandle": "source"},
        {"id": "e1", "source": "c", "target": "end", "sourceHandle": "fail-branch"},
    ]
    [message] = _unconnected({"nodes": [START, code, END], "edges": edges})
    assert "'source'" in message


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
def service_without_storage(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(WorkflowService, "__init__", lambda _self: None)
    monkeypatch.setattr(WorkflowService, "_is_load_balancing_enabled", lambda *_args: False)


def _validate_llm_raising(monkeypatch: pytest.MonkeyPatch, error: Exception) -> list[tuple[str, str, str]]:
    calls: list[tuple[str, str, str]] = []

    def validate(_self: WorkflowService, tenant_id: str, provider: str, model_name: str) -> None:
        calls.append((tenant_id, provider, model_name))
        raise error

    monkeypatch.setattr(WorkflowService, "_validate_llm_model_config", validate)
    return calls


def test_credential_check_reports_what_publish_refuses_for_a_node(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    llm = _node("l", {"type": "llm", "model": {"provider": "openai", "name": "gpt-4o"}})
    check = credential_check("ws-1", {}, sqlite_session)
    calls = _validate_llm_raising(monkeypatch, ValueError("no credential"))

    assert check(llm) == "no credential"
    assert calls == [("ws-1", "openai", "gpt-4o")]


def test_credential_check_wraps_unexpected_errors_with_the_node(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    llm = _node("l", {"type": "llm", "model": {"provider": "openai", "name": "gpt-4o"}})
    check = credential_check("ws-1", {}, sqlite_session)
    _validate_llm_raising(monkeypatch, RuntimeError("boom"))

    assert check(llm) == "Node l (llm): boom"


@pytest.mark.parametrize("node_type", ["knowledge-retrieval", "parameter-extractor", "question-classifier"])
def test_credential_check_matches_publish_for_model_nodes_publish_skips(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session, node_type: str
) -> None:
    """Publish lists these types with underscores, so it never checks them; the release check must agree."""
    node = _node("n", {"type": node_type, "model": {"provider": "openai", "name": "gpt-4o"}})
    check = credential_check("ws-1", {}, sqlite_session)
    calls = _validate_llm_raising(monkeypatch, ValueError("no credential"))

    assert check(node) is None
    assert calls == []


def test_chatflow_starter_draft_only_lacks_a_model(sqlite_session: Session) -> None:
    from services.app.console_gateway import _STARTER_DRAFT_GRAPHS

    issues = check_graph(
        _STARTER_DRAFT_GRAPHS[AppMode.ADVANCED_CHAT],
        mode=AppMode.ADVANCED_CHAT,
        resources=credential_check("ws-1", {}, sqlite_session),
    )

    assert [(i.code, i.node_id, i.message) for i in issues] == [
        (IssueCode.RESOURCE_UNAVAILABLE, "llm", "Node llm (llm): Missing provider or model configuration")
    ]


# --- End node outputs: names may repeat only on mutually exclusive branches, with one type ---------------

_OUTPUT_CODES = (IssueCode.OUTPUT_NAME_DUPLICATE, IssueCode.OUTPUT_TYPE_CONFLICT)


def _end(node_id: str, value_type: str | None = "string", *, parent: str | None = None) -> dict[str, object]:
    output: dict[str, object] = {"variable": "result", "value_selector": ["sys", "query"]}
    if value_type is not None:
        output["value_type"] = value_type
    node: dict[str, object] = {"id": node_id, "data": {"type": "end", "title": node_id, "outputs": [output]}}
    if parent is not None:
        node["parentId"] = parent
    return node


def _if_else(node_id: str) -> dict[str, object]:
    case: dict[str, object] = {"case_id": "true", "logical_operator": "and", "conditions": []}
    return _node(node_id, {"type": "if-else", "title": node_id, "cases": [case]})


def _edge(source: str, target: str, handle: str = "source") -> dict[str, object]:
    return {"id": f"{source}-{handle}-{target}", "source": source, "target": target, "sourceHandle": handle}


def _output_issues(nodes: list[dict[str, object]], edges: list[dict[str, object]]) -> list[tuple[IssueCode, str]]:
    issues = check_graph({"nodes": nodes, "edges": edges}, mode=AppMode.WORKFLOW)
    return sorted((i.code, i.node_id or "") for i in issues if i.code in _OUTPUT_CODES)


def _exclusive(first: dict[str, object], second: dict[str, object]) -> list[tuple[IssueCode, str]]:
    return _output_issues(
        [START, _if_else("branch"), first, second],
        [
            _edge("start", "branch"),
            _edge("branch", str(first["id"]), "true"),
            _edge("branch", str(second["id"]), "false"),
        ],
    )


def test_output_name_used_by_end_nodes_running_together_is_a_duplicate() -> None:
    issues = _output_issues([START, _end("a"), _end("b")], [_edge("start", "a"), _edge("start", "b")])
    assert issues == [(IssueCode.OUTPUT_NAME_DUPLICATE, "a"), (IssueCode.OUTPUT_NAME_DUPLICATE, "b")]


def test_output_name_reused_on_exclusive_if_else_branches_is_accepted() -> None:
    assert _exclusive(_end("a"), _end("b")) == []


@pytest.mark.parametrize("other", ["any", None])
def test_any_or_omitted_type_is_compatible_on_exclusive_branches(other: str | None) -> None:
    assert _exclusive(_end("a"), _end("b", other)) == []


def test_clashing_types_on_exclusive_branches_are_a_type_conflict() -> None:
    issues = _exclusive(_end("a", "string"), _end("b", "object"))
    assert issues == [(IssueCode.OUTPUT_TYPE_CONFLICT, "a"), (IssueCode.OUTPUT_TYPE_CONFLICT, "b")]


@pytest.mark.parametrize(("strategy", "expected"), [("fail-branch", []), (None, [IssueCode.OUTPUT_NAME_DUPLICATE] * 2)])
def test_success_and_fail_branch_are_exclusive_only_with_the_fail_branch_strategy(
    strategy: str | None, expected: list[IssueCode]
) -> None:
    template = _template(["sys", "query"])
    if strategy:
        template = {**template, "data": {**template["data"], "error_strategy": strategy}}  # type: ignore[dict-item]
    issues = _output_issues(
        [START, template, _end("a"), _end("b")],
        [_edge("start", "t"), _edge("t", "a", "source"), _edge("t", "b", "fail-branch")],
    )
    assert [code for code, _ in issues] == expected


def test_exclusive_outputs_stay_accepted_when_upstream_joins_exceed_the_tracked_paths() -> None:
    chain = [f"chain-{i}" for i in range(7)]  # both exits of each wired onward: 2^7 path conditions
    nodes = [START, *(_if_else(c) for c in chain), _if_else("final"), _end("a"), _end("b")]
    edges = [_edge("start", chain[0])]
    for index, node_id in enumerate(chain):
        following = chain[index + 1] if index + 1 < len(chain) else "final"
        edges += [_edge(node_id, following, "true"), _edge(node_id, following, "false")]
    edges += [_edge("final", "a", "true"), _edge("final", "b", "false")]
    assert _output_issues(nodes, edges) == []


def test_output_names_are_compared_only_within_one_scope() -> None:
    nodes = [START, _end("a"), _end("b", parent="iteration")]
    assert _output_issues(nodes, [_edge("start", "a")]) == []
