from copy import deepcopy
from typing import TypedDict, cast

import pytest

from graphon.nodes.tool.entities import ToolNodeData
from models import AppMode
from services.workflow.graph_check import IssueCode, check_graph
from services.workflow.node_defaults import node_data_type
from services.workflow.tool_credentials import ToolCredentialConfig, ToolNodeSpec, check_tool_credentials


class ToolNodeFixture(TypedDict):
    id: str
    data: dict[str, object]


def tool_node(node_id: str = "tool", /, **overrides: object) -> ToolNodeFixture:
    return {
        "id": node_id,
        "data": {
            "type": "tool",
            "title": node_id,
            "provider_id": "langgenius/calendar/calendar",
            "provider_type": "builtin",
            "provider_name": "calendar",
            "tool_name": "read",
            "tool_label": "Read",
            "tool_configurations": {},
            "tool_parameters": {},
            "credential_source": "end_user",
            "end_user_auth": {
                "credential_type": "oauth2",
                "selection_mode": "independent",
                "purpose": "Read the user's calendar.",
            },
            **overrides,
        },
    }


def test_legacy_nodes_keep_their_workspace_source_without_rewriting_data() -> None:
    node = tool_node(credential_id="workspace-key")
    del node["data"]["credential_source"]
    del node["data"]["end_user_auth"]
    original = deepcopy(node)

    assert ToolCredentialConfig.model_validate(node["data"]).credential_source == "workspace"
    assert check_tool_credentials({"nodes": [node]}, complete=True) == []
    assert node == original


@pytest.mark.parametrize("auth", [None, {}, {"selection_mode": "reuse_node"}, {"purpose": " "}])
def test_unfinished_drafts_can_be_saved_but_are_not_ready(auth: object) -> None:
    graph = {"nodes": [tool_node(end_user_auth=auth)]}

    assert check_tool_credentials(graph, complete=False) == []
    assert check_tool_credentials(graph, complete=True)


@pytest.mark.parametrize(
    ("overrides", "path"),
    [
        ({"credential_source": "personal"}, ("credential_source",)),
        ({"credential_source": None}, ("credential_source",)),
        ({"test_credential_id": 1}, ("test_credential_id",)),
        ({"test_credential_id": ""}, ("test_credential_id",)),
        ({"end_user_auth": {"credential_type": "unauthorized"}}, ("end_user_auth", "credential_type")),
        ({"end_user_auth": {"selection_mode": "default"}}, ("end_user_auth", "selection_mode")),
        ({"end_user_auth": {"purpose": "x" * 51}}, ("end_user_auth", "purpose")),
        ({"end_user_auth": {"connection_id": "personal-connection"}}, ("end_user_auth", "connection_id")),
    ],
)
def test_malformed_draft_fields_are_located(overrides: dict[str, object], path: tuple[str, ...]) -> None:
    graph = {"nodes": [tool_node(**overrides)]}
    [issue] = check_tool_credentials(graph, complete=False)

    assert (issue.node_id, issue.path) == ("tool", path)


def test_purpose_limit_counts_characters_not_utf8_bytes() -> None:
    node = tool_node()
    auth = cast(dict[str, object], node["data"]["end_user_auth"])
    auth["purpose"] = "\u4e2d" * 50
    graph = {"nodes": [node]}

    assert check_tool_credentials(graph, complete=True) == []

    auth["purpose"] = "\u4e2d" * 51
    [issue] = check_tool_credentials(graph, complete=False)

    assert issue.path == ("end_user_auth", "purpose")


def test_mixed_sources_and_missing_test_credentials_are_valid() -> None:
    nodes = [
        tool_node("workspace", credential_source="workspace", end_user_auth=None, credential_id="shared"),
        tool_node("personal", test_credential_id="deleted-test-credential"),
        tool_node("independent"),
    ]
    graph = {"nodes": nodes}

    assert check_tool_credentials(graph, complete=True) == []
    assert check_graph(graph, mode=AppMode.WORKFLOW) == []


@pytest.mark.parametrize(
    ("overrides", "path"),
    [
        ({"credential_id": "shared"}, ("credential_id",)),
        ({"credential_source": "workspace"}, ("end_user_auth",)),
        ({"provider_type": "mcp"}, ("provider_type",)),
        ({"provider_type": "api"}, ("provider_type",)),
        ({"provider_id": " "}, ("provider_id",)),
    ],
)
def test_complete_configuration_rejects_invalid_sources_and_providers(
    overrides: dict[str, object], path: tuple[str, ...]
) -> None:
    [issue] = check_tool_credentials({"nodes": [tool_node(**overrides)]}, complete=True)

    assert issue.path == path


def test_same_provider_cannot_require_conflicting_personal_authentication() -> None:
    oauth = tool_node("oauth")
    api_key = tool_node("api-key")
    cast(dict[str, object], api_key["data"]["end_user_auth"])["credential_type"] = "api-key"

    [issue] = check_tool_credentials({"nodes": [oauth, api_key]}, complete=True)

    assert issue.node_id == "api-key"
    assert issue.path == ("end_user_auth", "credential_type")
    assert "oauth" in issue.message


def reuse_node(node_id: str, target: str | None) -> ToolNodeFixture:
    node = tool_node(node_id)
    cast(dict[str, object], node["data"]["end_user_auth"]).update(selection_mode="reuse_node", reuse_node_id=target)
    return node


def test_reuse_chains_do_not_depend_on_node_execution_order() -> None:
    graph = {"nodes": [reuse_node("first", "second"), reuse_node("second", "root"), tool_node("root")]}

    assert check_tool_credentials(graph, complete=True) == []


@pytest.mark.parametrize("target", [None, "missing", "start", "workspace", "other-provider"])
def test_invalid_reuse_targets_are_located(target: str | None) -> None:
    nodes = [
        reuse_node("reuse", target),
        {"id": "start", "data": {"type": "start"}},
        tool_node("workspace", credential_source="workspace", end_user_auth=None),
        tool_node("other-provider", provider_id="langgenius/mail/mail"),
    ]
    [issue] = check_tool_credentials({"nodes": nodes}, complete=True)

    assert issue.node_id == "reuse"
    assert issue.path == ("end_user_auth", "reuse_node_id")


def test_independent_nodes_cannot_reference_a_reuse_target() -> None:
    node = tool_node()
    cast(dict[str, object], node["data"]["end_user_auth"])["reuse_node_id"] = "other"

    [issue] = check_tool_credentials({"nodes": [node]}, complete=True)

    assert issue.path == ("end_user_auth", "reuse_node_id")


@pytest.mark.parametrize("cycle", [["self"], ["a", "b"], ["a", "b", "c"]])
def test_reuse_cycles_report_every_member_once(cycle: list[str]) -> None:
    nodes = [reuse_node(node_id, cycle[(index + 1) % len(cycle)]) for index, node_id in enumerate(cycle)]
    nodes.insert(0, reuse_node("outside", cycle[0]))
    issues = check_tool_credentials({"nodes": nodes}, complete=True)

    assert [issue.node_id for issue in issues] == cycle
    assert all("cycle" in issue.message for issue in issues)


def test_reuse_validation_handles_long_chains_without_recursion() -> None:
    nodes = [reuse_node(str(index), str(index + 1)) for index in range(1100)]
    nodes.append(tool_node("1100"))

    assert check_tool_credentials({"nodes": nodes}, complete=True) == []


def test_graph_check_reports_config_errors_once_at_the_field_location() -> None:
    issues = check_graph({"nodes": [tool_node(credential_source="invalid")]}, mode=AppMode.WORKFLOW)

    assert [(issue.code, issue.loc) for issue in issues] == [
        (IssueCode.NODE_DATA_INVALID, ("nodes", "tool", "data", "credential_source"))
    ]


def test_dify_schema_exposes_credentials_without_extending_graphon() -> None:
    from graphon.nodes.tool.tool_node import ToolNode

    assert node_data_type("tool", ToolNode) is ToolNodeSpec
    assert "credential_source" in ToolNodeSpec.model_json_schema()["properties"]
    assert "credential_source" not in ToolNodeData.model_fields
    data = tool_node()["data"]
    assert ToolNodeSpec.model_validate(data).end_user_auth is not None
    assert ToolNodeData.model_validate(data).get("credential_source") == "end_user"
