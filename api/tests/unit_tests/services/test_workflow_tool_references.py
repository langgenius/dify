"""Workflow Tool references are found in every DSL shape that can call one, and retargeted in place."""

import yaml

from services.workflow_tool_references import (
    WorkflowToolTarget,
    iter_workflow_tool_references,
    retarget_workflow_tool_dsl,
)

_SOURCE_ID = "11111111-1111-4111-8111-111111111111"
_TARGET_ID = "22222222-2222-4222-8222-222222222222"
_TOOL_NODE = {
    "type": "tool",
    "provider_type": "workflow",
    "provider_id": _SOURCE_ID,
    "provider_name": "Summarize",
    "tool_name": "summarize",
}
_BUILTIN_NODE = {"type": "tool", "provider_type": "builtin", "provider_id": "time", "tool_name": "now"}
_AGENT_WORKFLOW_TOOL = {"type": "workflow", "provider_name": _SOURCE_ID, "tool_name": "summarize"}
_AGENT_BUILTIN_TOOL = {"type": "builtin", "provider_name": "time", "tool_name": "now"}


def _workflow_dsl() -> dict[str, object]:
    agent_tools = {"type": "constant", "value": [dict(_AGENT_WORKFLOW_TOOL), dict(_AGENT_BUILTIN_TOOL)]}
    return {
        "kind": "app",
        "app": {"mode": "workflow"},
        "workflow": {
            "graph": {
                "nodes": [
                    {"id": "tool", "data": dict(_TOOL_NODE)},
                    {"id": "builtin", "data": dict(_BUILTIN_NODE)},
                    {"id": "agent", "data": {"type": "agent", "agent_parameters": {"tools": agent_tools}}},
                    {"id": "without-data"},
                ]
            }
        },
    }


def test_references_cover_tool_nodes_and_legacy_agent_tools() -> None:
    references = list(iter_workflow_tool_references(_workflow_dsl()))

    assert [(reference.id_key, reference.provider_id) for reference in references] == [
        ("provider_id", _SOURCE_ID),
        ("provider_name", _SOURCE_ID),
    ]


def test_references_cover_agent_chat_tools() -> None:
    data = {
        "model_config": {
            "agent_mode": {
                "tools": [
                    {"provider_type": "workflow", "provider_id": _SOURCE_ID, "tool_name": "summarize"},
                    {"dataset": {"enabled": True, "id": "dataset-1"}},
                    "not-a-tool",
                ]
            }
        }
    }

    assert [reference.provider_id for reference in iter_workflow_tool_references(data)] == [_SOURCE_ID]


def test_retarget_points_known_references_at_their_targets() -> None:
    dsl = yaml.safe_dump(_workflow_dsl())
    targets = {_SOURCE_ID: WorkflowToolTarget(provider_id=_TARGET_ID, name="summarize_2", create=True)}

    nodes = yaml.safe_load(retarget_workflow_tool_dsl(dsl, targets))["workflow"]["graph"]["nodes"]

    assert nodes[0]["data"] == {**_TOOL_NODE, "provider_id": _TARGET_ID, "tool_name": "summarize_2"}
    assert nodes[1]["data"] == _BUILTIN_NODE
    agent_tools = nodes[2]["data"]["agent_parameters"]["tools"]["value"]
    assert agent_tools == [
        {**_AGENT_WORKFLOW_TOOL, "provider_name": _TARGET_ID, "tool_name": "summarize_2"},
        _AGENT_BUILTIN_TOOL,
    ]


def test_retarget_keeps_providers_without_a_target() -> None:
    dsl = yaml.safe_dump(_workflow_dsl())

    assert yaml.safe_load(retarget_workflow_tool_dsl(dsl, {})) == _workflow_dsl()


def test_retarget_leaves_a_dsl_that_is_not_a_mapping_unchanged() -> None:
    targets = {_SOURCE_ID: WorkflowToolTarget(provider_id=_TARGET_ID, name="summarize", create=True)}

    assert retarget_workflow_tool_dsl("[]\n", targets) == "[]\n"
