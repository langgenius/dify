import io
import itertools
import zipfile
from abc import ABC, abstractmethod
from collections.abc import Mapping, Sequence, Sized
from dataclasses import replace
from pathlib import Path
from uuid import uuid4

import pytest
import yaml
from sqlalchemy.orm import Session, sessionmaker

from constants.dsl_version import CURRENT_APP_DSL_VERSION
from core.plugin.impl.tool import PluginToolManager
from core.workflow.node_factory import LATEST_VERSION, get_node_type_classes_mapping
from core.workflow.nodes.knowledge_index import KNOWLEDGE_INDEX_NODE_TYPE
from graphon.enums import BuiltinNodeTypes
from libs.archive_writer import ArchiveLimits
from machinery.context import RequestContext
from models.model import App, AppMode
from repositories.app.dsl_import_repository import DslImportRepository
from services.app.console_service import ConsoleAppNotFoundError
from services.tools.tool_sources import resolve_tool
from services.workflow.authoring import FillContext, PackageCheck, check_package, fill_package, tool_reference
from services.workflow.authoring.canvas_defaults import CanvasNode, with_canvas_defaults
from services.workflow.authoring.checks import _CHECKS, AuthoringIssue, AuthoringIssueCode, Check, DslCheckRequest
from services.workflow.authoring.fill import fill_graph_document
from services.workflow.authoring.package_io import PackageUnreadableError, new_manifest, read_package_entries
from services.workflow.dsl_import import DslImportService, DslNotCheckableError
from services.workflow.graph_check import CANVAS_NOTE_TYPE, IssueCode, IssueSeverity, check_graph, data_loc
from tests.unit_tests.services.workflow.authoring.test_fill_package import _skeleton_dsl

pytestmark = pytest.mark.usefixtures("bare_workspace_credentials")

CTX = FillContext(tenant_id="tenant-1", account_id="account-1")
CONTEXT = RequestContext("request-1", None, "account-1", "tenant-1")
LIMITS = ArchiveLimits(max_entries=64, max_bytes=16 * 1024 * 1024)
FIXTURES = Path(__file__).parents[4] / "fixtures" / "workflow"
APP = "app.yaml"
MISSING_ERROR_TYPE = "missing"
MANIFEST = "manifest.yaml"
ITERATION_AND_NOTES_EXPORT = "book_translation_iteration_note_workflow.yml"
# basic_chatflow.yml is left out of the clean exports and of the quiet purpose test: the export never picked a model.
UNPICKED_MODEL_EXPORT = "basic_chatflow.yml"
# Exports whose plugins resolve in a bare workspace and that check_graph passes; time is a built-in tool. Their
# models are not set up in a bare workspace, so they carry resource_unavailable warnings.
CLEAN_EXPORTS = [
    "array_iteration_formatting_workflow.yml",
    "basic_llm_chat_workflow.yml",
    "chatflow_time_tool_static_output_workflow.yml",
    "dual_switch_variable_aggregator_workflow.yml",
    "end_node_without_value_type_field_workflow.yml",
    "increment_loop_with_break_condition_workflow.yml",
    "knowledge_retrieval_v2_workflow.yml",
    "loop_contains_answer.yml",
    "test_complex_branch.yml",
    "update-conversation-variable-in-iteration.yml",
]
START = {"id": "start", "data": {"type": BuiltinNodeTypes.START}}
END = {
    "id": "end",
    "data": {"type": BuiltinNodeTypes.END, "outputs": [{"variable": "out", "value_selector": ["start", "query"]}]},
}
BARE_END = {"id": "end", "data": {"type": BuiltinNodeTypes.END}}
LLM_WITHOUT_MODEL = {"id": "llm", "data": {"type": BuiltinNodeTypes.LLM}}


def _package(members: dict[str, str]) -> bytes:
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w") as archive:
        for name, data in members.items():
            archive.writestr(name, data)
    return output.getvalue()


type _Item = Mapping[str, object]


def _dsl(nodes: Sequence[_Item], edges: Sequence[_Item], mode: AppMode = AppMode.WORKFLOW) -> str:
    return yaml.safe_dump(
        {
            "kind": "app",
            "version": CURRENT_APP_DSL_VERSION,
            "app": {"mode": mode.value, "name": "Skeleton"},
            "workflow": {"graph": {"nodes": [dict(node) for node in nodes], "edges": [dict(edge) for edge in edges]}},
        }
    )


@pytest.fixture
def dsl(sqlite_session_factory: sessionmaker[Session]) -> DslCheckRequest:
    service = DslImportService(store=DslImportRepository(session_factory=sqlite_session_factory))
    return DslCheckRequest(service=service, context=CONTEXT, app_id=None)


def _with_manifest(app: str) -> dict[str, str]:
    return {APP: app, MANIFEST: new_manifest(app.encode()).decode()}


def _check_members(members: dict[str, str], dsl: DslCheckRequest) -> PackageCheck:
    return check_package(read_package_entries(io.BytesIO(_package(members))), CTX, limits=LIMITS, dsl=dsl)


def _check_text(app: str, dsl: DslCheckRequest) -> PackageCheck:
    return _check_members(_with_manifest(app), dsl)


def _check(dsl: DslCheckRequest, nodes: Sequence[_Item], edges: Sequence[_Item] = ()) -> PackageCheck:
    return _check_text(_dsl(nodes, edges), dsl)


def _chain_dsl(*nodes: _Item) -> str:
    ids = [node["id"] for node in nodes]
    return _dsl(nodes, [{"source": s, "target": t} for s, t in itertools.pairwise(ids)])


def _chain(dsl: DslCheckRequest, *nodes: _Item) -> PackageCheck:
    return _check_text(_chain_dsl(*nodes), dsl)


def _issues_of(check: PackageCheck, node_id: str) -> list[AuthoringIssue]:
    return [issue for issue in check.issues if issue.node_id == node_id]


def _codes(check: PackageCheck) -> set[str]:
    return {issue.code for issue in check.issues}


def _tool(tool_name: str, **data: object) -> dict[str, object]:
    return {
        "id": "tool",
        "data": {
            "type": BuiltinNodeTypes.TOOL,
            "provider_type": "builtin",
            "provider_id": "time",
            "provider_name": "time",
            "tool_name": tool_name,
            "tool_label": tool_name,
            "tool_node_version": "2",
            **data,
        },
    }


def test_a_node_without_a_required_field_the_canvas_gives_no_default_gets_a_hinted_issue(
    dsl: DslCheckRequest,
) -> None:
    extractor = {"id": "extractor", "data": {"type": BuiltinNodeTypes.PARAMETER_EXTRACTOR}}
    check = _chain(dsl, START, extractor, END)

    issues = _issues_of(check, "extractor")
    missing = [issue for issue in issues if issue.code == IssueCode.NODE_DATA_INVALID]
    assert missing
    assert {issue.code for issue in issues} == {IssueCode.NODE_DATA_INVALID, AuthoringIssueCode.FIELD_EMPTY}
    assert _empty_locs(check, "extractor") == {
        _data("extractor", "query"),
        _data("extractor", "model", "provider"),
        _data("extractor", "model", "name"),
    }
    assert all(issue.hint is not None and issue.hint.required for issue in missing)
    [parameters] = [issue for issue in missing if issue.loc == ("nodes", "extractor", "data", "parameters")]
    assert parameters.hint is not None
    assert parameters.hint.loc == ("parameters",)
    assert parameters.hint.type
    assert parameters.severity == IssueSeverity.ERROR
    assert parameters.refuses_import is True
    assert check.valid is False


def _unconnected_branch_dsl() -> str:
    condition = {"id": "c1", "variable_selector": ["start", "query"], "comparison_operator": "empty"}
    branch = {
        "id": "if",
        "data": {
            "type": BuiltinNodeTypes.IF_ELSE,
            "cases": [{"case_id": "yes", "logical_operator": "and", "conditions": [condition]}],
        },
    }
    return _dsl([START, branch], [{"source": "start", "target": "if"}])


def _unconnected_branch(dsl: DslCheckRequest) -> PackageCheck:
    return _check_text(_unconnected_branch_dsl(), dsl)


def test_a_wrapped_issue_keeps_its_code_and_severity(dsl: DslCheckRequest) -> None:
    check = _unconnected_branch(dsl)

    assert check.issues
    assert {issue.code for issue in check.issues} == {IssueCode.BRANCH_UNCONNECTED}
    assert all(issue.severity == IssueSeverity.WARNING for issue in check.issues)
    assert all(issue.refuses_import is False for issue in check.issues)
    assert all(issue.hint is None for issue in check.issues)


def test_warnings_alone_leave_the_package_valid(dsl: DslCheckRequest) -> None:
    assert _unconnected_branch(dsl).valid is True


def test_a_clean_graph_has_no_issues(dsl: DslCheckRequest) -> None:
    check = _chain(dsl, START, END)

    assert check == PackageCheck(valid=True, issues=(), node_specs=check.node_specs)


def test_an_empty_graph_has_no_root_node(dsl: DslCheckRequest) -> None:
    check = _check(dsl, [])

    [issue] = check.issues
    assert issue.code == AuthoringIssueCode.NO_ROOT_NODE
    assert issue.loc == ("nodes",)
    assert issue.node_id is None
    assert check.valid is False


def test_a_graph_of_only_non_root_nodes_has_no_root_node(dsl: DslCheckRequest) -> None:
    assert AuthoringIssueCode.NO_ROOT_NODE in _codes(_check(dsl, [END]))


def test_a_trigger_is_a_root_node(dsl: DslCheckRequest) -> None:
    trigger = {"id": "hook", "data": {"type": "trigger-webhook"}}

    assert AuthoringIssueCode.NO_ROOT_NODE not in _codes(_chain(dsl, trigger, END))


def test_a_workflow_with_no_graph_has_no_root_node(dsl: DslCheckRequest) -> None:
    app = yaml.safe_dump({"kind": "app", "app": {"mode": "workflow", "name": "x"}, "workflow": {}})

    assert _codes(_check_text(app, dsl)) == {IssueCode.GRAPH_INVALID, AuthoringIssueCode.NO_ROOT_NODE}


def test_an_app_without_a_graph_mode_is_not_graph_checked(dsl: DslCheckRequest) -> None:
    app = yaml.safe_dump({"kind": "app", "app": {"mode": "chat", "name": "x"}, "model_config": {}})

    check = _check_text(app, dsl)

    assert check == PackageCheck(valid=True, issues=(), node_specs=())


def _empty_locs(check: PackageCheck, node_id: str) -> set[tuple[str | int, ...]]:
    return {issue.loc for issue in _issues_of(check, node_id) if issue.code == AuthoringIssueCode.FIELD_EMPTY}


def _data(node_id: str, *loc: str | int) -> tuple[str | int, ...]:
    return ("nodes", node_id, "data", *loc)


def test_a_bare_llm_reports_model_and_prompt_as_empty(dsl: DslCheckRequest) -> None:
    check = _chain(dsl, START, LLM_WITHOUT_MODEL, END)

    assert _empty_locs(check, "llm") == {
        _data("llm", "model", "provider"),
        _data("llm", "model", "name"),
        _data("llm", "prompt_template"),
    }
    issues = [issue for issue in _issues_of(check, "llm") if issue.code == AuthoringIssueCode.FIELD_EMPTY]
    assert all(issue.hint is not None and issue.hint.example is not None for issue in issues)
    assert all(issue.hint is not None and issue.hint.required for issue in issues)
    assert all((issue.severity, issue.refuses_import) == (IssueSeverity.ERROR, False) for issue in issues)
    assert check.valid is False


def test_an_llm_with_memory_is_not_asked_for_a_prompt(dsl: DslCheckRequest) -> None:
    llm = {"id": "llm", "data": {"type": BuiltinNodeTypes.LLM, "memory": {"window": {"enabled": False, "size": 10}}}}

    check = _chain(dsl, START, llm, END)

    assert _data("llm", "prompt_template") not in _empty_locs(check, "llm")


@pytest.mark.parametrize(
    ("prompt", "empty"),
    [
        pytest.param([{"role": "system", "text": ""}, {"role": "user", "text": "  "}], True, id="all-blank"),
        pytest.param([{"role": "system", "text": ""}, {"role": "user", "text": "Hi {{#start.q#}}"}], False, id="one"),
        pytest.param(
            [{"role": "user", "edition_type": "jinja2", "text": "x", "jinja2_text": ""}], True, id="jinja-empty"
        ),
        pytest.param(
            [{"role": "user", "edition_type": "jinja2", "text": "", "jinja2_text": "{{ a }}"}], False, id="jinja"
        ),
        pytest.param({"text": ""}, True, id="completion-blank"),
        pytest.param({"text": "Say hi"}, False, id="completion-text"),
        pytest.param([], True, id="no-messages"),
        pytest.param([{"role": "user", "text": "{{#x.y#}}"}], False, id="reference-only"),
    ],
)
def test_an_llm_prompt_is_empty_only_when_no_message_has_text(
    prompt: object, empty: bool, dsl: DslCheckRequest
) -> None:
    llm = {"id": "llm", "data": {"type": BuiltinNodeTypes.LLM, "prompt_template": prompt}}

    check = _chain(dsl, START, llm, END)

    assert (_data("llm", "prompt_template") in _empty_locs(check, "llm")) is empty


def _no_conditions() -> list[object]:
    return []


def test_an_if_else_case_without_conditions_is_reported_per_case(dsl: DslCheckRequest) -> None:
    branch = {
        "id": "if",
        "data": {
            "type": BuiltinNodeTypes.IF_ELSE,
            "cases": [
                {"case_id": "a", "logical_operator": "and", "conditions": _no_conditions()},
                {"case_id": "b", "logical_operator": "and", "conditions": _no_conditions()},
            ],
        },
    }

    check = _check(dsl, [START, branch], [{"source": "start", "target": "if"}])

    assert _empty_locs(check, "if") == {_data("if", "cases", 0, "conditions"), _data("if", "cases", 1, "conditions")}


def test_an_end_without_outputs_and_an_answer_without_text_are_reported(dsl: DslCheckRequest) -> None:
    workflow = _chain(dsl, START, BARE_END)
    answer = {"id": "answer", "data": {"type": BuiltinNodeTypes.ANSWER}}
    chatflow = _check_text(_dsl([START, answer], [{"source": "start", "target": "answer"}], AppMode.ADVANCED_CHAT), dsl)

    assert _empty_locs(workflow, "end") == {_data("end", "outputs")}
    assert _empty_locs(chatflow, "answer") == {_data("answer", "answer")}


@pytest.mark.parametrize(
    ("text", "empty"),
    [("{{#start.q#}}", False), ("Hello", False), ("   ", True), ("", True)],
)
def test_text_holding_only_a_reference_is_not_empty(text: str, empty: bool, dsl: DslCheckRequest) -> None:
    answer = {"id": "answer", "data": {"type": BuiltinNodeTypes.ANSWER, "answer": text}}

    check = _check_text(_dsl([START, answer], [{"source": "start", "target": "answer"}], AppMode.ADVANCED_CHAT), dsl)

    assert (_data("answer", "answer") in _empty_locs(check, "answer")) is empty


ITERATION = {"id": "loop", "data": {"type": BuiltinNodeTypes.ITERATION}}


@pytest.mark.parametrize(
    "extra",
    [
        pytest.param([_tool("current_time")], id="tool"),
        pytest.param([{"id": "tool", "data": {"type": BuiltinNodeTypes.AGENT}}], id="agent"),
        pytest.param([{"id": "tool", "data": {"type": KNOWLEDGE_INDEX_NODE_TYPE}}], id="knowledge-index"),
        pytest.param(
            [ITERATION, {"id": "tool", "parentId": "loop", "data": {"type": BuiltinNodeTypes.ITERATION_START}}],
            id="iteration-start",
        ),
        pytest.param([{"id": "tool", "data": {"type": "node-from-the-future"}}], id="unknown"),
    ],
)
def test_a_type_with_no_canvas_entry_gets_no_purpose_issue(
    extra: list[dict[str, object]], dsl: DslCheckRequest
) -> None:
    check = _check(dsl, [START, *extra, END])

    assert AuthoringIssueCode.FIELD_EMPTY not in {issue.code for issue in _issues_of(check, "tool")}


def test_an_iterations_child_llm_gets_the_same_purpose_issues_as_a_top_level_one(dsl: DslCheckRequest) -> None:
    child = {"id": "child", "parentId": "loop", "data": {"type": BuiltinNodeTypes.LLM}}

    check = _check(dsl, [START, ITERATION, LLM_WITHOUT_MODEL, child, END])

    top_level = {loc[3:] for loc in _empty_locs(check, "llm")}
    assert top_level
    assert {loc[3:] for loc in _empty_locs(check, "child")} == top_level


def test_a_field_gets_one_issue_when_the_dsl_check_already_reported_it(dsl: DslCheckRequest) -> None:
    llm = {"id": "llm", "data": {"type": BuiltinNodeTypes.LLM, "model": "gpt"}}

    check = _chain(dsl, START, llm, END)

    invalid = [issue.loc for issue in _issues_of(check, "llm") if issue.code == IssueCode.NODE_DATA_INVALID]
    assert _data("llm", "model") in invalid
    assert {loc for loc in _empty_locs(check, "llm") if loc[:4] == _data("llm", "model")} == set()


def test_a_node_data_invalid_hint_carries_the_canvas_example(dsl: DslCheckRequest) -> None:
    classifier = {
        "id": "classifier",
        "data": {"type": BuiltinNodeTypes.QUESTION_CLASSIFIER, "classes": [{"id": "1", "label": "One"}]},
    }

    check = _chain(dsl, START, classifier, END)

    [issue] = [
        issue
        for issue in _issues_of(check, "classifier")
        if issue.code == IssueCode.NODE_DATA_INVALID and issue.loc == _data("classifier", "classes", 0, "name")
    ]
    assert issue.hint is not None
    assert issue.hint.example == ""
    assert _data("classifier", "classes", 0, "name") not in _empty_locs(check, "classifier")


def test_an_unknown_node_version_gets_no_purpose_issue(dsl: DslCheckRequest) -> None:
    future = {"id": "human", "data": {"type": BuiltinNodeTypes.HUMAN_INPUT, "version": "99"}}

    check = _chain(dsl, START, future, END)

    assert _empty_locs(check, "human") == set()


def _group(name: str, variables: list[list[str]]) -> dict[str, object]:
    return {"group_name": name, "output_type": "string", "variables": variables}


def _grouped_aggregator(*groups: dict[str, object]) -> dict[str, object]:
    settings = {"group_enabled": True, "groups": list(groups)}
    return {
        "id": "agg",
        "data": {"type": BuiltinNodeTypes.VARIABLE_AGGREGATOR, "variables": [], "advanced_settings": settings},
    }


def test_a_grouped_aggregator_with_full_groups_is_not_asked_for_its_own_variables(dsl: DslCheckRequest) -> None:
    aggregator = _grouped_aggregator(_group("a", [["start", "query"]]), _group("b", [["start", "query"]]))

    check = _chain(dsl, START, aggregator, END)

    assert _empty_locs(check, "agg") == set()


def test_a_grouped_aggregator_reports_each_empty_variable_of_a_group(dsl: DslCheckRequest) -> None:
    aggregator = _grouped_aggregator(_group("a", [["start", "query"]]), _group("b", [["start", "query"], []]))

    check = _chain(dsl, START, aggregator, END)

    assert _empty_locs(check, "agg") == {_data("agg", "advanced_settings", "groups", 1, "variables", 1)}


def test_a_grouped_aggregator_without_groups_reports_the_groups(dsl: DslCheckRequest) -> None:
    check = _chain(dsl, START, _grouped_aggregator(), END)

    assert _empty_locs(check, "agg") == {_data("agg", "advanced_settings", "groups")}


def test_a_group_without_variables_is_not_reported_as_the_web_does_not(dsl: DslCheckRequest) -> None:
    aggregator = _grouped_aggregator(_group("a", [["start", "query"]]), _group("b", []))

    check = _chain(dsl, START, aggregator, END)

    assert _empty_locs(check, "agg") == set()


def test_an_ungrouped_aggregator_reports_its_own_variables(dsl: DslCheckRequest) -> None:
    variables: list[list[str]] = [["start", "q"], []]
    aggregator = {"id": "agg", "data": {"type": BuiltinNodeTypes.VARIABLE_AGGREGATOR, "variables": variables}}

    check = _chain(dsl, START, aggregator, END)

    assert _empty_locs(check, "agg") == {_data("agg", "variables", 1)}


def test_an_llm_whose_model_comes_from_an_environment_variable_is_not_asked_for_one(dsl: DslCheckRequest) -> None:
    llm = {"id": "llm", "data": {"type": BuiltinNodeTypes.LLM, "model_selector": ["env", "MODEL"]}}

    check = _chain(dsl, START, llm, END)

    assert _empty_locs(check, "llm") == {_data("llm", "prompt_template")}


@pytest.mark.parametrize("selector", [[], ["env"], ["env", ""], ["start", "MODEL"], "env"])
def test_an_llm_with_a_selector_that_names_no_environment_model_is_asked_for_one(
    selector: object, dsl: DslCheckRequest
) -> None:
    llm = {"id": "llm", "data": {"type": BuiltinNodeTypes.LLM, "model_selector": selector}}

    check = _chain(dsl, START, llm, END)

    assert {_data("llm", "model", "provider"), _data("llm", "model", "name")} <= _empty_locs(check, "llm")


@pytest.mark.parametrize("container", [BuiltinNodeTypes.ITERATION, BuiltinNodeTypes.LOOP])
def test_a_filled_bare_container_still_needs_its_start_child(container: str, dsl: DslCheckRequest) -> None:
    check = _check(dsl, [START, {"id": "box", "data": {"type": container}}, END])

    invalid = {issue.loc for issue in _issues_of(check, "box") if issue.code == IssueCode.NODE_DATA_INVALID}
    assert _data("box", "start_node_id") in invalid


def _plain_seed(node: CanvasNode) -> dict[str, object]:
    version = get_node_type_classes_mapping()[node.value][LATEST_VERSION].version()
    return {"type": node.value, "version": version, "title": node.value}


def _field(loc: tuple[str | int, ...]) -> str | int | None:
    relative = loc[len(data_loc("node")) :]
    return relative[0] if relative else None


def _missing_fields(data: dict[str, object]) -> set[str | int | None]:
    issues = check_graph({"nodes": [{"id": "node", "data": data}], "edges": []}, mode=AppMode.WORKFLOW)
    return {
        _field(issue.loc)
        for issue in issues
        if issue.code == IssueCode.NODE_DATA_INVALID
        if issue.error_type == MISSING_ERROR_TYPE
    }


# Empty canvas values that are a true "none": a code node with no outputs, a request with no headers or params.
NONE_DEFAULTS = frozenset(
    {(CanvasNode.CODE, "outputs"), (CanvasNode.HTTP_REQUEST, "headers"), (CanvasNode.HTTP_REQUEST, "params")}
)


def _holds_nothing(data: Mapping[str, object], field: str | int | None) -> bool:
    value = data.get(str(field))
    if isinstance(value, Sized):
        return len(value) == 0
    return value is None


@pytest.mark.parametrize("node", list(CanvasNode))
def test_fill_never_hides_a_required_field_behind_an_empty_canvas_value(node: CanvasNode, dsl: DslCheckRequest) -> None:
    seed = _plain_seed(node)
    filled = with_canvas_defaults(seed)

    check = _check(dsl, [{"id": "node", "data": seed}])

    reported = {
        _field(issue.loc)
        for issue in _issues_of(check, "node")
        if issue.code in {IssueCode.NODE_DATA_INVALID, AuthoringIssueCode.FIELD_EMPTY}
    }
    unset = {
        field for field in _missing_fields(seed) if (node, field) not in NONE_DEFAULTS if _holds_nothing(filled, field)
    }
    assert unset <= reported


@pytest.mark.parametrize(
    "fixture", sorted(path.name for path in FIXTURES.glob("*.y*ml") if path.name != UNPICKED_MODEL_EXPORT)
)
def test_purpose_issues_are_quiet_on_every_console_export_fixture(fixture: str, dsl: DslCheckRequest) -> None:
    check = _check_text((FIXTURES / fixture).read_text(), dsl)

    assert [issue for issue in check.issues if issue.code == AuthoringIssueCode.FIELD_EMPTY] == []


def test_an_export_that_never_picked_a_model_reports_the_model_but_not_the_prompt(dsl: DslCheckRequest) -> None:
    check = _check_text((FIXTURES / UNPICKED_MODEL_EXPORT).read_text(), dsl)

    empty = [issue for issue in check.issues if issue.code == AuthoringIssueCode.FIELD_EMPTY]
    assert sorted(issue.loc for issue in empty) == [_data("llm", "model", "name"), _data("llm", "model", "provider")]
    assert _beyond_missing_models(check) == empty


def test_new_codes_are_errors_but_a_small_note_and_only_manifest_issues_refuse_an_import() -> None:
    manifest_codes = {AuthoringIssueCode.MANIFEST_STALE, AuthoringIssueCode.MANIFEST_MISSING}
    for code in AuthoringIssueCode:
        expected = IssueSeverity.WARNING if code == AuthoringIssueCode.NOTE_TOO_SMALL else IssueSeverity.ERROR
        assert code.severity == expected
        assert code.refuses_import is (code in manifest_codes)


def test_a_tool_from_a_missing_provider_is_plugin_not_found(
    monkeypatch: pytest.MonkeyPatch, dsl: DslCheckRequest
) -> None:
    monkeypatch.setattr(PluginToolManager, "fetch_tool_provider", lambda _self, _tenant_id, _provider: None)

    check = _chain(dsl, START, _tool("current_time", provider_id="missing"), END)

    [issue] = [issue for issue in check.issues if issue.code == AuthoringIssueCode.PLUGIN_NOT_FOUND]
    assert issue.node_id == "tool"
    assert issue.loc == ("nodes", "tool", "data")
    assert "builtin/missing/current_time" in issue.message
    assert "not installed" not in issue.message
    assert "could not be resolved" in issue.message
    assert issue.refuses_import is False
    assert check.valid is False


def test_check_looks_each_tool_up_once_after_fill(monkeypatch: pytest.MonkeyPatch, dsl: DslCheckRequest) -> None:
    looked_up: list[str] = []

    def counting(**kwargs: str) -> object:
        looked_up.append(kwargs["tool_name"])
        return resolve_tool(**kwargs)

    monkeypatch.setattr(tool_reference, "resolve_tool", counting)

    _chain(dsl, START, _tool("timezone_conversion"), END)

    # One lookup is fill's, the other is shared by every check and the node spec.
    assert looked_up == ["timezone_conversion", "timezone_conversion"]


def test_an_abstract_check_is_not_registered() -> None:
    registered = list(_CHECKS)

    class _Family(Check, ABC):
        @abstractmethod
        def extra(self) -> None: ...

    assert registered == _CHECKS


def test_a_typo_in_the_tool_name_is_plugin_not_found(dsl: DslCheckRequest) -> None:
    check = _chain(dsl, START, _tool("current_tme"), END)

    assert AuthoringIssueCode.PLUGIN_NOT_FOUND in _codes(check)


def test_a_required_tool_parameter_with_no_value_is_missing(dsl: DslCheckRequest) -> None:
    check = _chain(dsl, START, _tool("timezone_conversion"), END)

    [issue] = [issue for issue in check.issues if issue.code == AuthoringIssueCode.PLUGIN_PARAMETER_MISSING]
    assert issue.loc == ("nodes", "tool", "data", "tool_parameters", "current_time")
    assert "current_time" in issue.message


def test_a_required_tool_parameter_with_a_value_is_not_missing(dsl: DslCheckRequest) -> None:
    written = {"current_time": {"type": "mixed", "value": "2024-01-01 00:00:00"}}

    check = _chain(dsl, START, _tool("timezone_conversion", tool_parameters=written), END)

    assert AuthoringIssueCode.PLUGIN_PARAMETER_MISSING not in _codes(check)


def test_an_unknown_node_type_is_reported_not_raised(dsl: DslCheckRequest) -> None:
    check = _chain(dsl, START, {"id": "future", "data": {"type": "node-from-the-future"}}, END)

    assert [issue.code for issue in _issues_of(check, "future")] == [IssueCode.UNKNOWN_NODE_TYPE]
    assert "future" not in {spec.node_id for spec in check.node_specs}


def test_every_readable_node_gets_a_spec(dsl: DslCheckRequest) -> None:
    check = _chain(dsl, START, LLM_WITHOUT_MODEL, END)

    assert [spec.node_id for spec in check.node_specs] == ["start", "llm", "end"]


@pytest.mark.parametrize("content", ["{not yaml", "- a list\n"])
def test_an_unreadable_app_yaml_is_refused(content: str, dsl: DslCheckRequest) -> None:
    with pytest.raises(PackageUnreadableError):
        _check_text(content, dsl)


def test_a_package_without_app_yaml_is_refused(dsl: DslCheckRequest) -> None:
    entries = read_package_entries(io.BytesIO(_package({"readme.md": "hello"})))

    with pytest.raises(PackageUnreadableError):
        check_package(entries, CTX, limits=LIMITS, dsl=dsl)


def _beyond_missing_models(check: PackageCheck) -> list[AuthoringIssue]:
    """The issues other than the warnings a bare workspace gives for the models a graph names."""
    return [issue for issue in check.issues if issue.code != IssueCode.RESOURCE_UNAVAILABLE]


def test_a_console_export_with_an_iteration_and_notes_has_no_issues(dsl: DslCheckRequest) -> None:
    check = _check_text((FIXTURES / ITERATION_AND_NOTES_EXPORT).read_text(), dsl)

    assert _beyond_missing_models(check) == []
    assert check.valid is True
    assert {spec.type for spec in check.node_specs} >= {BuiltinNodeTypes.START, BuiltinNodeTypes.ITERATION}


@pytest.mark.parametrize("fixture", CLEAN_EXPORTS)
def test_a_console_export_has_no_issues(fixture: str, dsl: DslCheckRequest) -> None:
    check = _check_text((FIXTURES / fixture).read_text(), dsl)

    assert _beyond_missing_models(check) == []
    assert check.valid is True


def test_check_graph_does_not_report_the_new_checks() -> None:
    assert check_graph({"nodes": [], "edges": []}, mode=AppMode.WORKFLOW) == []


def test_a_manifest_for_another_app_yaml_is_stale(dsl: DslCheckRequest) -> None:
    app = _dsl([START, END], [{"source": "start", "target": "end"}])
    manifest = new_manifest(_dsl([START], []).encode()).decode()

    check = _check_members({APP: app, MANIFEST: manifest}, dsl)

    [issue] = [issue for issue in check.issues if issue.code == AuthoringIssueCode.MANIFEST_STALE]
    assert (issue.severity, issue.refuses_import, issue.node_id) == (IssueSeverity.ERROR, True, None)
    assert issue.loc == (MANIFEST, "apps", 0)
    assert "fill" in issue.message
    assert check.valid is False


def test_a_manifest_that_matches_the_app_yaml_is_not_stale(dsl: DslCheckRequest) -> None:
    app = _dsl([START, END], [{"source": "start", "target": "end"}])

    check = _check_members({APP: app, MANIFEST: new_manifest(app.encode()).decode()}, dsl)

    assert check.issues == ()


def test_a_package_without_a_manifest_is_reported_and_not_stale(dsl: DslCheckRequest) -> None:
    check = _check_members({APP: _dsl([START, END], [{"source": "start", "target": "end"}])}, dsl)

    [issue] = check.issues
    assert issue.code == AuthoringIssueCode.MANIFEST_MISSING
    assert (issue.severity, issue.refuses_import, issue.node_id, issue.loc) == (
        IssueSeverity.ERROR,
        True,
        None,
        (MANIFEST,),
    )
    assert "fill" in issue.message
    assert check.valid is False


def test_a_package_with_a_manifest_is_not_reported_missing(dsl: DslCheckRequest) -> None:
    app = _dsl([START, END], [{"source": "start", "target": "end"}])

    check = _check_members({APP: app, MANIFEST: new_manifest(app.encode()).decode()}, dsl)

    assert AuthoringIssueCode.MANIFEST_MISSING not in _codes(check)


def test_a_manifest_fill_cannot_read_is_not_judged_stale(dsl: DslCheckRequest) -> None:
    app = _dsl([START, END], [{"source": "start", "target": "end"}])

    check = _check_members({APP: app, MANIFEST: "apps: [unclosed"}, dsl)

    assert AuthoringIssueCode.MANIFEST_STALE not in _codes(check)


def _filled_app(app: str) -> str:
    """The `app.yaml` fill writes for a package of `app` and its manifest."""
    entries = read_package_entries(io.BytesIO(_package(_with_manifest(app))))
    with zipfile.ZipFile(io.BytesIO(fill_package(entries, CTX, limits=LIMITS))) as archive:
        return archive.read(APP).decode()


type _IssueKey = tuple[str, IssueSeverity, str | None, tuple[str | int, ...]]


def _dsl_check_keys(app: str, dsl: DslCheckRequest) -> set[_IssueKey]:
    issues = dsl.service.check(dsl.context, _filled_app(app), dsl.app_id)
    return {(issue.code, issue.code.severity, issue.node_id, issue.loc) for issue in issues}


def _check_keys(check: PackageCheck) -> set[_IssueKey]:
    return {(issue.code, issue.severity, issue.node_id, issue.loc) for issue in check.issues}


_DSL_CHECKED_APPS = [
    *[pytest.param((FIXTURES / fixture).read_text(), id=fixture) for fixture in CLEAN_EXPORTS],
    pytest.param((FIXTURES / UNPICKED_MODEL_EXPORT).read_text(), id=UNPICKED_MODEL_EXPORT),
    pytest.param((FIXTURES / ITERATION_AND_NOTES_EXPORT).read_text(), id=ITERATION_AND_NOTES_EXPORT),
    pytest.param(_skeleton_dsl(), id="skeleton-workflow"),
    pytest.param(_skeleton_dsl(AppMode.ADVANCED_CHAT), id="skeleton-chatflow"),
    pytest.param(_chain_dsl(START, LLM_WITHOUT_MODEL, END), id="llm-without-a-model"),
    pytest.param(_unconnected_branch_dsl(), id="unconnected-branch"),
]


@pytest.mark.parametrize("app_yaml", _DSL_CHECKED_APPS)
def test_check_reports_every_issue_the_dsl_check_reports_on_the_filled_app_yaml(
    app_yaml: str, dsl: DslCheckRequest
) -> None:
    assert _dsl_check_keys(app_yaml, dsl) <= _check_keys(_check_text(app_yaml, dsl))


@pytest.mark.parametrize(
    ("app_yaml", "code", "severity"),
    [
        pytest.param(
            _chain_dsl(START, LLM_WITHOUT_MODEL, END),
            IssueCode.RESOURCE_UNAVAILABLE,
            IssueSeverity.WARNING,
            id="llm-without-a-model",
        ),
        pytest.param(_unconnected_branch_dsl(), IssueCode.BRANCH_UNCONNECTED, IssueSeverity.WARNING, id="branch"),
    ],
)
def test_the_dsl_check_reports_what_the_superset_cases_are_for(
    app_yaml: str, code: IssueCode, severity: IssueSeverity, dsl: DslCheckRequest
) -> None:
    assert {key[:2] for key in _dsl_check_keys(app_yaml, dsl)} >= {(code, severity)}


def test_a_model_the_workspace_lacks_is_a_resource_warning(dsl: DslCheckRequest) -> None:
    check = _chain(dsl, START, LLM_WITHOUT_MODEL, END)

    [issue] = [issue for issue in check.issues if issue.code == IssueCode.RESOURCE_UNAVAILABLE]
    assert (issue.severity, issue.refuses_import, issue.node_id, issue.loc, issue.hint) == (
        IssueSeverity.WARNING,
        False,
        "llm",
        ("nodes", "llm"),
        None,
    )


def _app(session: Session, mode: AppMode, *, tenant_id: str = CTX.tenant_id) -> str:
    app = App(id=str(uuid4()), tenant_id=tenant_id, name="a", mode=mode, enable_site=True, enable_api=True)
    session.add(app)
    session.commit()
    return app.id


def test_check_reads_the_mode_of_the_app_it_is_given(dsl: DslCheckRequest, sqlite_session: Session) -> None:
    app_id = _app(sqlite_session, AppMode.ADVANCED_CHAT)

    check = _chain(replace(dsl, app_id=app_id), START, END)

    assert [(issue.code, issue.node_id) for issue in check.issues] == [(IssueCode.MODE_INCOMPATIBLE, "end")]
    assert check.valid is False


def test_an_app_without_a_graph_mode_is_checked_against_the_app_it_is_given(
    dsl: DslCheckRequest, sqlite_session: Session
) -> None:
    app = yaml.safe_dump({"kind": "app", "app": {"mode": "chat", "name": "x"}, "model_config": {}})
    request = replace(dsl, app_id=_app(sqlite_session, AppMode.WORKFLOW))

    assert _check_keys(_check_text(app, request)) == _dsl_check_keys(app, request)


def test_check_refuses_an_app_outside_the_workspace(dsl: DslCheckRequest, sqlite_session: Session) -> None:
    app_id = _app(sqlite_session, AppMode.WORKFLOW, tenant_id="tenant-2")

    with pytest.raises(ConsoleAppNotFoundError):
        _chain(replace(dsl, app_id=app_id), START, END)


def test_check_refuses_environment_variables_the_dsl_check_cannot_read(dsl: DslCheckRequest) -> None:
    document = yaml.safe_load(_chain_dsl(START, END))
    document["workflow"]["environment_variables"] = "KEY"

    with pytest.raises(DslNotCheckableError, match="environment_variables"):
        _check_text(yaml.safe_dump(document), dsl)


def test_an_app_yaml_fill_leaves_as_utf_16_is_refused(dsl: DslCheckRequest) -> None:
    document = yaml.safe_load((FIXTURES / "simple_passthrough_workflow.yml").read_text())
    fill_graph_document(document, CTX)
    app_yaml = yaml.dump(document, allow_unicode=True).encode("utf-16")
    archive = io.BytesIO()
    with zipfile.ZipFile(archive, "w") as package:
        package.writestr(APP, app_yaml)
        package.writestr(MANIFEST, new_manifest(app_yaml))

    with pytest.raises(PackageUnreadableError, match="UTF-8"):
        check_package(read_package_entries(archive), CTX, limits=LIMITS, dsl=dsl)


NOTE_CODES = {
    AuthoringIssueCode.NOTE_TEXT_INVALID,
    AuthoringIssueCode.NOTE_FIELD_MISSING,
    AuthoringIssueCode.NOTE_COVER_UNKNOWN,
    AuthoringIssueCode.NOTE_TOO_SMALL,
}


def _note(**data: object) -> dict[str, object]:
    complete: dict[str, object] = {
        "type": "",
        "text": "Collects the input",
        "theme": "blue",
        "author": "Builder",
        "showAuthor": True,
        "covers": ["start"],
    }
    return {"id": "note", "type": CANVAS_NOTE_TYPE, "data": {**complete, **data}}


def _bare_note(*absent: str) -> dict[str, object]:
    note = _note()
    data = note["data"]
    assert isinstance(data, dict)
    return {**note, "data": {key: value for key, value in data.items() if key not in absent}}


def _note_issues(dsl: DslCheckRequest, note: _Item, *extra: _Item) -> list[AuthoringIssue]:
    check = _check(dsl, [START, END, *extra, note], [{"source": "start", "target": "end"}])
    return [issue for issue in check.issues if issue.code in NOTE_CODES]


def _note_locs(issues: Sequence[AuthoringIssue]) -> set[tuple[str, tuple[str | int, ...]]]:
    return {(issue.code, issue.loc) for issue in issues}


def test_a_complete_note_has_no_note_issues(dsl: DslCheckRequest) -> None:
    assert _note_issues(dsl, _note()) == []


@pytest.mark.parametrize("text", ["", "plain words", "42", None])
def test_text_the_editor_loads_or_fill_converts_is_valid(text: object, dsl: DslCheckRequest) -> None:
    assert _note_issues(dsl, _note(text=text)) == []


def test_a_note_without_text_is_valid(dsl: DslCheckRequest) -> None:
    assert _note_issues(dsl, _bare_note("text")) == []


@pytest.mark.parametrize("text", ['{"no": "root"}', '{"root": {}}', 42, ["a"]])
def test_text_the_editor_cannot_load_is_invalid(text: object, dsl: DslCheckRequest) -> None:
    [issue] = _note_issues(dsl, _note(text=text))

    assert (issue.code, issue.severity, issue.refuses_import) == (
        AuthoringIssueCode.NOTE_TEXT_INVALID,
        IssueSeverity.ERROR,
        False,
    )
    assert (issue.node_id, issue.loc) == ("note", ("nodes", "note", "data", "text"))


def test_each_missing_web_field_is_reported_at_its_own_loc(dsl: DslCheckRequest) -> None:
    issues = _note_issues(dsl, _bare_note("theme", "author", "showAuthor"))

    assert _note_locs(issues) == {
        (AuthoringIssueCode.NOTE_FIELD_MISSING, ("nodes", "note", "data", field))
        for field in ("theme", "author", "showAuthor")
    }
    assert all(issue.refuses_import is False for issue in issues)


@pytest.mark.parametrize(
    ("field", "value"),
    [("theme", "red"), ("theme", ["blue"]), ("author", None), ("showAuthor", "yes")],
)
def test_a_web_field_the_canvas_cannot_read_is_reported(field: str, value: object, dsl: DslCheckRequest) -> None:
    issues = _note_issues(dsl, _note(**{field: value}))

    assert _note_locs(issues) == {(AuthoringIssueCode.NOTE_FIELD_MISSING, ("nodes", "note", "data", field))}


def test_an_empty_author_is_valid(dsl: DslCheckRequest) -> None:
    assert _note_issues(dsl, _note(author="")) == []


def test_each_unknown_cover_is_reported_at_its_index(dsl: DslCheckRequest) -> None:
    iteration = {"id": "loop", "data": {"type": BuiltinNodeTypes.ITERATION}}
    child = {"id": "child", "parentId": "loop", "data": {"type": BuiltinNodeTypes.CODE}}

    issues = _note_issues(dsl, _note(covers=["start", "missing", "child", 7, "note"]), iteration, child)

    assert _note_locs(issues) >= {
        (AuthoringIssueCode.NOTE_COVER_UNKNOWN, ("nodes", "note", "data", "covers", index)) for index in (1, 2, 3, 4)
    }
    assert {issue.code for issue in issues} == {AuthoringIssueCode.NOTE_COVER_UNKNOWN}


def test_covers_that_are_not_a_list_are_reported(dsl: DslCheckRequest) -> None:
    issues = _note_issues(dsl, _note(covers="start"))

    assert _note_locs(issues) == {(AuthoringIssueCode.NOTE_COVER_UNKNOWN, ("nodes", "note", "data", "covers"))}


def test_a_note_without_covers_is_valid(dsl: DslCheckRequest) -> None:
    assert _note_issues(dsl, _bare_note("covers")) == []


def test_a_note_below_the_resizer_minimum_is_a_warning(dsl: DslCheckRequest) -> None:
    small = {**_note(width=100, height=40, covers=[]), "position": {"x": 0, "y": 0}}
    check = _check(dsl, [START, END, small], [{"source": "start", "target": "end"}])
    issues = [issue for issue in check.issues if issue.code in NOTE_CODES]

    assert _note_locs(issues) == {
        (AuthoringIssueCode.NOTE_TOO_SMALL, ("nodes", "note", "data", "width")),
        (AuthoringIssueCode.NOTE_TOO_SMALL, ("nodes", "note", "data", "height")),
    }
    assert all(issue.severity == IssueSeverity.WARNING for issue in issues)
    assert check.valid is True


def test_a_note_error_makes_the_package_invalid(dsl: DslCheckRequest) -> None:
    check = _check(dsl, [START, END, _bare_note("theme")], [{"source": "start", "target": "end"}])

    assert check.valid is False


def test_a_console_export_with_notes_has_no_note_issues(dsl: DslCheckRequest) -> None:
    check = _check_text((FIXTURES / ITERATION_AND_NOTES_EXPORT).read_text(), dsl)

    assert {issue.code for issue in check.issues}.isdisjoint(NOTE_CODES)
