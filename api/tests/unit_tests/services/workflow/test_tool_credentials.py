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
                "allowed_credential_types": ["oauth2"],
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


@pytest.mark.parametrize("auth", [None, {}, {"allowed_credential_types": []}, {"purpose": " "}])
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
        (
            {"end_user_auth": {"allowed_credential_types": ["unauthorized"]}},
            ("end_user_auth", "allowed_credential_types", 0),
        ),
        ({"end_user_auth": {"allowed_credential_types": "oauth2"}}, ("end_user_auth", "allowed_credential_types")),
        (
            {"end_user_auth": {"allowed_credential_types": ["oauth2", "oauth2"]}},
            ("end_user_auth", "allowed_credential_types"),
        ),
        ({"reuse_node_id": ""}, ("reuse_node_id",)),
        ({"end_user_auth": {"purpose": "x" * 51}}, ("end_user_auth", "purpose")),
        ({"end_user_auth": {"connection_id": "personal-connection"}}, ("end_user_auth", "connection_id")),
    ],
)
def test_malformed_draft_fields_are_located(overrides: dict[str, object], path: tuple[str | int, ...]) -> None:
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


@pytest.mark.parametrize("methods", [["oauth2"], ["api-key"], ["oauth2", "api-key"]])
def test_end_user_nodes_allow_one_or_both_authentication_methods(methods: list[str]) -> None:
    node = tool_node()
    cast(dict[str, object], node["data"]["end_user_auth"])["allowed_credential_types"] = methods

    assert check_tool_credentials({"nodes": [node]}, complete=True) == []


@pytest.mark.parametrize(
    ("first_methods", "second_methods"),
    [
        (["oauth2"], ["api-key"]),
        (["oauth2", "api-key"], ["api-key"]),
        (["oauth2", "api-key"], ["api-key", "oauth2"]),
    ],
)
def test_same_provider_nodes_have_independent_authentication_requirements(
    first_methods: list[str], second_methods: list[str]
) -> None:
    first = tool_node("first")
    second = tool_node("second")
    cast(dict[str, object], first["data"]["end_user_auth"])["allowed_credential_types"] = first_methods
    cast(dict[str, object], second["data"]["end_user_auth"])["allowed_credential_types"] = second_methods

    graph = {"nodes": [first, second]}
    original = deepcopy(graph)

    assert check_tool_credentials(graph, complete=True) == []
    assert check_graph(graph, mode=AppMode.WORKFLOW) == []
    assert graph == original


def test_provider_grouping_does_not_merge_node_requirements_or_test_credentials() -> None:
    nodes = [tool_node("both"), tool_node("oauth"), tool_node("api-key")]
    for node, methods in zip(nodes, (["oauth2", "api-key"], ["oauth2"], ["api-key"]), strict=True):
        cast(dict[str, object], node["data"]["end_user_auth"])["allowed_credential_types"] = methods
        node["data"]["test_credential_id"] = f"test-{node['id']}"

    graph = {"nodes": nodes}
    original = deepcopy(graph)

    assert check_graph(graph, mode=AppMode.WORKFLOW) == []
    assert graph == original


def reuse_node(node_id: str, target: str | None) -> ToolNodeFixture:
    node = tool_node(node_id, credential_source="reuse_node", reuse_node_id=target)
    del node["data"]["end_user_auth"]
    return node


def test_explicit_reuse_does_not_constrain_other_nodes_of_the_same_provider() -> None:
    oauth = tool_node("oauth")
    api_key = tool_node("api-key")
    cast(dict[str, object], api_key["data"]["end_user_auth"])["allowed_credential_types"] = ["api-key"]
    graph = {"nodes": [oauth, api_key, reuse_node("reuse", "oauth")]}

    assert check_graph(graph, mode=AppMode.WORKFLOW) == []


@pytest.mark.parametrize("source", ["workspace", "end_user"])
@pytest.mark.parametrize("target_first", [False, True])
def test_reuse_inherits_direct_workspace_or_end_user_auth_without_duplicate_settings(
    source: str, target_first: bool
) -> None:
    target = tool_node("target")
    if source == "workspace":
        target["data"].update(credential_source="workspace", end_user_auth=None, credential_id="shared")
    else:
        target["data"]["test_credential_id"] = "test-credential"
    reuse = reuse_node("reuse", "target")
    graph = {"nodes": [target, reuse] if target_first else [reuse, target]}

    assert check_tool_credentials(graph, complete=True) == []
    assert check_graph(graph, mode=AppMode.WORKFLOW) == []
    assert "end_user_auth" not in reuse["data"]
    assert "test_credential_id" not in reuse["data"]


def test_reuse_of_legacy_workspace_auth_keeps_default_credential_resolution() -> None:
    target = tool_node("target")
    del target["data"]["credential_source"]
    del target["data"]["end_user_auth"]

    assert check_tool_credentials({"nodes": [target, reuse_node("reuse", "target")]}, complete=True) == []


@pytest.mark.parametrize(
    "overrides",
    [
        {"credential_id": "own-credential"},
        {"test_credential_id": "own-test-credential"},
        {"end_user_auth": {"allowed_credential_types": ["api-key"], "purpose": "Override target."}},
    ],
)
def test_reuse_cannot_override_the_target_authentication(overrides: dict[str, object]) -> None:
    reuse = reuse_node("reuse", "target")
    reuse["data"].update(overrides)

    [issue] = check_tool_credentials({"nodes": [tool_node("target"), reuse]}, complete=True)

    assert issue.node_id == "reuse"
    assert issue.path == (next(iter(overrides)),)


@pytest.mark.parametrize(
    "target", [None, "missing", "start", "incomplete", "other-provider", "other-plugin", "other-tool"]
)
def test_invalid_reuse_targets_are_located(target: str | None) -> None:
    nodes = [
        reuse_node("reuse", target),
        {"id": "start", "data": {"type": "start"}},
        tool_node("incomplete", end_user_auth={}),
        tool_node("other-provider", provider_id="langgenius/calendar/other"),
        tool_node("other-plugin", provider_id="vendor/calendar/calendar"),
        tool_node("other-tool", tool_name="send"),
    ]
    issues = check_tool_credentials({"nodes": nodes}, complete=True)
    [issue] = [issue for issue in issues if issue.node_id == "reuse"]

    assert issue.path == ("reuse_node_id",)


@pytest.mark.parametrize("source", ["workspace", "end_user"])
def test_direct_authentication_cannot_reference_a_reuse_target(source: str) -> None:
    node = tool_node(credential_source=source, reuse_node_id="other")
    if source == "workspace":
        node["data"]["end_user_auth"] = None

    [issue] = check_tool_credentials({"nodes": [node]}, complete=True)

    assert issue.path == ("reuse_node_id",)


def test_reuse_chains_are_rejected_even_without_a_cycle() -> None:
    graph = {"nodes": [reuse_node("child", "middle"), reuse_node("middle", "root"), tool_node("root")]}

    [issue] = check_tool_credentials(graph, complete=True)

    assert issue.node_id == "child"
    assert issue.path == ("reuse_node_id",)
    assert "directly" in issue.message


@pytest.mark.parametrize("cycle", [["self"], ["a", "b"], ["a", "b", "c"]])
def test_self_reuse_and_reuse_cycles_are_rejected(cycle: list[str]) -> None:
    nodes = [reuse_node(node_id, cycle[(index + 1) % len(cycle)]) for index, node_id in enumerate(cycle)]
    issues = check_tool_credentials({"nodes": nodes}, complete=True)

    assert [issue.node_id for issue in issues] == cycle
    assert all(issue.path == ("reuse_node_id",) for issue in issues)


def test_unfinished_reuse_drafts_can_be_saved() -> None:
    graph = {"nodes": [reuse_node("reuse", None)]}

    assert check_tool_credentials(graph, complete=False) == []
    [issue] = check_tool_credentials(graph, complete=True)
    assert issue.path == ("reuse_node_id",)


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
