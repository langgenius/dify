import io
import itertools
import zipfile
from collections.abc import Mapping, Sequence
from pathlib import Path

import pytest
import yaml

from constants.dsl_version import CURRENT_APP_DSL_VERSION
from core.plugin.impl.tool import PluginToolManager
from graphon.enums import BuiltinNodeTypes
from libs.archive_writer import ArchiveLimits
from models.model import AppMode
from services.workflow.authoring import FillContext, PackageCheck, check_package
from services.workflow.authoring.checks import AuthoringIssue, AuthoringIssueCode
from services.workflow.authoring.package_io import PackageUnreadableError, read_package_entries
from services.workflow.graph_check import IssueCode, IssueSeverity, check_graph

CTX = FillContext(tenant_id="tenant-1", account_id="account-1")
LIMITS = ArchiveLimits(max_entries=64, max_bytes=16 * 1024 * 1024)
FIXTURES = Path(__file__).parents[4] / "fixtures" / "workflow"
APP = "app.yaml"
ITERATION_AND_NOTES_EXPORT = "book_translation_iteration_note_workflow.yml"
# Exports whose plugins resolve in a bare workspace and that check_graph passes; time is a built-in tool.
CLEAN_EXPORTS = [
    "array_iteration_formatting_workflow.yml",
    "basic_chatflow.yml",
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
END = {"id": "end", "data": {"type": BuiltinNodeTypes.END}}


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


def _check_text(app: str) -> PackageCheck:
    return check_package(read_package_entries(io.BytesIO(_package({APP: app}))), CTX, limits=LIMITS)


def _check(nodes: Sequence[_Item], edges: Sequence[_Item] = ()) -> PackageCheck:
    return _check_text(_dsl(nodes, edges))


def _chain(*nodes: _Item) -> PackageCheck:
    ids = [node["id"] for node in nodes]
    return _check(nodes, [{"source": s, "target": t} for s, t in itertools.pairwise(ids)])


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


def test_an_llm_node_without_a_model_gets_hinted_missing_field_issues() -> None:
    check = _chain(START, {"id": "llm", "data": {"type": BuiltinNodeTypes.LLM}}, END)

    issues = _issues_of(check, "llm")
    assert issues
    assert {issue.code for issue in issues} == {IssueCode.NODE_DATA_INVALID}
    assert all(issue.hint is not None and issue.hint.required for issue in issues)
    [model] = [issue for issue in issues if issue.loc == ("nodes", "llm", "data", "model")]
    assert model.hint is not None
    assert model.hint.loc == ("model",)
    assert model.hint.type
    assert model.severity == IssueSeverity.ERROR
    assert model.refuses_import is True
    assert check.valid is False


def _unconnected_branch() -> PackageCheck:
    no_conditions: list[object] = []
    branch = {
        "id": "if",
        "data": {
            "type": BuiltinNodeTypes.IF_ELSE,
            "cases": [{"case_id": "yes", "logical_operator": "and", "conditions": no_conditions}],
        },
    }
    return _check([START, branch], [{"source": "start", "target": "if"}])


def test_a_wrapped_issue_keeps_its_code_and_severity() -> None:
    check = _unconnected_branch()

    assert check.issues
    assert {issue.code for issue in check.issues} == {IssueCode.BRANCH_UNCONNECTED}
    assert all(issue.severity == IssueSeverity.WARNING for issue in check.issues)
    assert all(issue.refuses_import is False for issue in check.issues)
    assert all(issue.hint is None for issue in check.issues)


def test_warnings_alone_leave_the_package_valid() -> None:
    assert _unconnected_branch().valid is True


def test_a_clean_graph_has_no_issues() -> None:
    check = _chain(START, END)

    assert check == PackageCheck(valid=True, issues=(), node_specs=check.node_specs)


def test_an_empty_graph_has_no_root_node() -> None:
    check = _check([])

    [issue] = check.issues
    assert issue.code == AuthoringIssueCode.NO_ROOT_NODE
    assert issue.loc == ("nodes",)
    assert issue.node_id is None
    assert check.valid is False


def test_a_graph_of_only_non_root_nodes_has_no_root_node() -> None:
    assert AuthoringIssueCode.NO_ROOT_NODE in _codes(_check([END]))


def test_a_trigger_is_a_root_node() -> None:
    trigger = {"id": "hook", "data": {"type": "trigger-webhook"}}

    assert AuthoringIssueCode.NO_ROOT_NODE not in _codes(_chain(trigger, END))


def test_a_workflow_with_no_graph_has_no_root_node() -> None:
    app = yaml.safe_dump({"kind": "app", "app": {"mode": "workflow", "name": "x"}, "workflow": {}})

    assert _codes(_check_text(app)) == {AuthoringIssueCode.NO_ROOT_NODE}


def test_an_app_without_a_graph_mode_is_not_graph_checked() -> None:
    app = yaml.safe_dump({"kind": "app", "app": {"mode": "chat", "name": "x"}, "model_config": {}})

    check = _check_text(app)

    assert check == PackageCheck(valid=True, issues=(), node_specs=())


def test_new_codes_are_errors_that_never_refuse_an_import() -> None:
    for code in AuthoringIssueCode:
        assert code.severity == IssueSeverity.ERROR
        assert code.refuses_import is False


def test_a_tool_from_a_missing_provider_is_plugin_not_found(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(PluginToolManager, "fetch_tool_provider", lambda _self, _tenant_id, _provider: None)

    check = _chain(START, _tool("current_time", provider_id="missing"), END)

    [issue] = [issue for issue in check.issues if issue.code == AuthoringIssueCode.PLUGIN_NOT_FOUND]
    assert issue.node_id == "tool"
    assert issue.loc == ("nodes", "tool", "data")
    assert "builtin/missing/current_time" in issue.message
    assert "not installed" not in issue.message
    assert issue.refuses_import is False
    assert check.valid is False


def test_a_typo_in_the_tool_name_is_plugin_not_found() -> None:
    check = _chain(START, _tool("current_tme"), END)

    assert AuthoringIssueCode.PLUGIN_NOT_FOUND in _codes(check)


def test_a_required_tool_parameter_with_no_value_is_missing() -> None:
    check = _chain(START, _tool("timezone_conversion"), END)

    [issue] = [issue for issue in check.issues if issue.code == AuthoringIssueCode.PLUGIN_PARAMETER_MISSING]
    assert issue.loc == ("nodes", "tool", "data", "tool_parameters", "current_time")
    assert "current_time" in issue.message


def test_a_required_tool_parameter_with_a_value_is_not_missing() -> None:
    written = {"current_time": {"type": "mixed", "value": "2024-01-01 00:00:00"}}

    check = _chain(START, _tool("timezone_conversion", tool_parameters=written), END)

    assert AuthoringIssueCode.PLUGIN_PARAMETER_MISSING not in _codes(check)


def test_an_unknown_node_type_is_reported_not_raised() -> None:
    check = _chain(START, {"id": "future", "data": {"type": "node-from-the-future"}}, END)

    assert [issue.code for issue in _issues_of(check, "future")] == [IssueCode.UNKNOWN_NODE_TYPE]
    assert "future" not in {spec.node_id for spec in check.node_specs}


def test_every_readable_node_gets_a_spec() -> None:
    check = _chain(START, {"id": "llm", "data": {"type": BuiltinNodeTypes.LLM}}, END)

    assert [spec.node_id for spec in check.node_specs] == ["start", "llm", "end"]


@pytest.mark.parametrize("content", ["{not yaml", "- a list\n"])
def test_an_unreadable_app_yaml_is_refused(content: str) -> None:
    with pytest.raises(PackageUnreadableError):
        _check_text(content)


def test_a_package_without_app_yaml_is_refused() -> None:
    entries = read_package_entries(io.BytesIO(_package({"readme.md": "hello"})))

    with pytest.raises(PackageUnreadableError):
        check_package(entries, CTX, limits=LIMITS)


def test_a_console_export_with_an_iteration_and_notes_has_no_issues() -> None:
    check = _check_text((FIXTURES / ITERATION_AND_NOTES_EXPORT).read_text())

    assert check.issues == ()
    assert check.valid is True
    assert {spec.type for spec in check.node_specs} >= {BuiltinNodeTypes.START, BuiltinNodeTypes.ITERATION}


@pytest.mark.parametrize("fixture", CLEAN_EXPORTS)
def test_a_console_export_has_no_issues(fixture: str) -> None:
    assert _check_text((FIXTURES / fixture).read_text()).issues == ()


def test_check_graph_does_not_report_the_new_checks() -> None:
    assert check_graph({"nodes": [], "edges": []}, mode=AppMode.WORKFLOW) == []
