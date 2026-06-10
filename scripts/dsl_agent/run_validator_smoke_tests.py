#!/usr/bin/env python3
from __future__ import annotations

import json
from copy import deepcopy
from typing import Any

import yaml

from validator import validate_yaml_text


GMAIL_UID = "langgenius/dify-gmail:0.2.1@181057c375f10ac3cdd0067aca5866f1a3eea0088d51a48185ef1d314d7838a7"
GMAIL_ALT_UID = "langgenius/dify-gmail:0.2.6@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
OPENAI_UID = "langgenius/openai:0.0.26@bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
AGENT_UID = "langgenius/agent:0.0.31@faea70b63e46a8d42f060bd005cfbc8af8e229b3b7f2b8ed253669efef42846a"
AGENT_ALT_UID = "langgenius/agent:0.0.32@cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"


def base_workflow_doc() -> dict[str, Any]:
    return {
        "version": "0.6.0",
        "kind": "app",
        "app": {
            "name": "validator-smoke",
            "mode": "workflow",
            "icon": "V",
            "icon_background": "#FFEAD5",
            "description": "Validator smoke workflow.",
        },
        "dependencies": [
            {
                "current_identifier": None,
                "type": "marketplace",
                "value": {"marketplace_plugin_unique_identifier": GMAIL_UID},
            }
        ],
        "workflow": {
            "conversation_variables": [],
            "environment_variables": [],
            "features": {},
            "graph": {
                "edges": [
                    {
                        "id": "start-source-gmail-target",
                        "source": "start",
                        "sourceHandle": "source",
                        "target": "gmail",
                        "targetHandle": "target",
                        "type": "custom",
                        "data": {"sourceType": "start", "targetType": "tool", "isInLoop": False},
                    },
                    {
                        "id": "gmail-source-end-target",
                        "source": "gmail",
                        "sourceHandle": "source",
                        "target": "end",
                        "targetHandle": "target",
                        "type": "custom",
                        "data": {"sourceType": "tool", "targetType": "end", "isInLoop": False},
                    },
                ],
                "nodes": [
                    {
                        "id": "start",
                        "type": "custom",
                        "sourcePosition": "right",
                        "targetPosition": "left",
                        "position": {"x": 0, "y": 0},
                        "data": {"title": "Start", "type": "start", "variables": []},
                    },
                    {
                        "id": "gmail",
                        "type": "custom",
                        "sourcePosition": "right",
                        "targetPosition": "left",
                        "position": {"x": 300, "y": 0},
                        "data": {
                            "title": "Draft Gmail",
                            "type": "tool",
                            "provider_id": "langgenius/dify-gmail/dify-gmail",
                            "plugin_unique_identifier": GMAIL_UID,
                            "tool_name": "draft_message",
                            "tool_parameters": {},
                        },
                    },
                    {
                        "id": "end",
                        "type": "custom",
                        "sourcePosition": "right",
                        "targetPosition": "left",
                        "position": {"x": 600, "y": 0},
                        "data": {"title": "End", "type": "end", "outputs": []},
                    },
                ],
                "viewport": {"x": 0, "y": 0, "zoom": 1},
            },
        },
    }


def llm_workflow_doc() -> dict[str, Any]:
    doc = base_workflow_doc()
    doc["dependencies"] = [
        {
            "current_identifier": None,
            "type": "marketplace",
            "value": {"marketplace_plugin_unique_identifier": OPENAI_UID},
        }
    ]
    graph = doc["workflow"]["graph"]
    graph["edges"] = [
        {
            "id": "start-source-llm-target",
            "source": "start",
            "sourceHandle": "source",
            "target": "llm",
            "targetHandle": "target",
            "type": "custom",
            "data": {"sourceType": "start", "targetType": "llm", "isInLoop": False},
        },
        {
            "id": "llm-source-end-target",
            "source": "llm",
            "sourceHandle": "source",
            "target": "end",
            "targetHandle": "target",
            "type": "custom",
            "data": {"sourceType": "llm", "targetType": "end", "isInLoop": False},
        },
    ]
    graph["nodes"][1] = {
        "id": "llm",
        "type": "custom",
        "sourcePosition": "right",
        "targetPosition": "left",
        "position": {"x": 300, "y": 0},
        "data": {
            "title": "LLM",
            "type": "llm",
            "model": {
                "provider": "openai",
                "name": "gpt-4o-mini",
                "mode": "chat",
                "completion_params": {"temperature": 0.2},
            },
            "prompt_template": [{"role": "system", "text": "Return a short result."}],
            "context": {"enabled": False, "variable_selector": []},
            "vision": {"enabled": False},
            "variables": [],
        },
    }
    return doc


def agent_workflow_doc() -> dict[str, Any]:
    doc = base_workflow_doc()
    doc["dependencies"] = [
        {
            "current_identifier": None,
            "type": "marketplace",
            "value": {"marketplace_plugin_unique_identifier": AGENT_UID},
        }
    ]
    graph = doc["workflow"]["graph"]
    graph["edges"] = [
        {
            "id": "start-source-agent-target",
            "source": "start",
            "sourceHandle": "source",
            "target": "agent",
            "targetHandle": "target",
            "type": "custom",
            "data": {"sourceType": "start", "targetType": "agent", "isInLoop": False},
        },
        {
            "id": "agent-source-end-target",
            "source": "agent",
            "sourceHandle": "source",
            "target": "end",
            "targetHandle": "target",
            "type": "custom",
            "data": {"sourceType": "agent", "targetType": "end", "isInLoop": False},
        },
    ]
    graph["nodes"][1] = {
        "id": "agent",
        "type": "custom",
        "sourcePosition": "right",
        "targetPosition": "left",
        "position": {"x": 300, "y": 0},
        "data": {
            "title": "Agent",
            "type": "agent",
            "plugin_unique_identifier": AGENT_UID,
            "agent_strategy_provider_name": "langgenius/agent/agent",
            "agent_strategy_name": "function_calling",
            "agent_parameters": {
                "instruction": {"type": "constant", "value": "Return a concise answer."},
                "maximum_iterations": {"type": "constant", "value": 2},
                "query": {"type": "constant", "value": "{{#sys.query#}}"},
                "tools": {"type": "constant", "value": []},
            },
        },
    }
    return doc


def malformed_native_shape_doc() -> dict[str, Any]:
    return {
        "version": "0.6.0",
        "kind": "app",
        "app": {
            "name": "bad-native-shape",
            "mode": "workflow",
            "description": "Uses common LLM-generated but non-importable native node shapes.",
        },
        "dependencies": [],
        "workflow": {
            "conversation_variables": [{"key": "query", "type": "text"}],
            "environment_variables": [],
            "features": {},
            "graph": {
                "edges": [
                    {
                        "id": "start-source-end-target",
                        "source": "start",
                        "sourceHandle": "source",
                        "target": "end",
                        "targetHandle": "target",
                        "type": "custom",
                        "data": {"sourceType": "start", "targetType": "end"},
                    }
                ],
                "nodes": [
                    {
                        "id": "start",
                        "type": "custom",
                        "sourcePosition": "right",
                        "targetPosition": "left",
                        "position": {"x": 0, "y": 0},
                        "data": {
                            "title": "Start",
                            "type": "start",
                            "variables": [{"key": "query", "type": "text", "required": True}],
                        },
                    },
                    {
                        "id": "end",
                        "type": "custom",
                        "sourcePosition": "right",
                        "targetPosition": "left",
                        "position": {"x": 300, "y": 0},
                        "data": {
                            "title": "End",
                            "type": "end",
                            "outputs": [{"key": "query", "value": "{{#start.query#}}"}],
                        },
                    },
                ],
                "viewport": {"x": 0, "y": 0, "zoom": 1},
            },
        },
    }


def malformed_code_node_doc() -> dict[str, Any]:
    doc = base_workflow_doc()
    doc["dependencies"] = []
    graph = doc["workflow"]["graph"]
    graph["edges"] = [
        {
            "id": "start-source-code-target",
            "source": "start",
            "sourceHandle": "source",
            "target": "code",
            "targetHandle": "target",
            "type": "custom",
            "data": {"sourceType": "start", "targetType": "code", "isInLoop": False},
        },
        {
            "id": "code-source-end-target",
            "source": "code",
            "sourceHandle": "source",
            "target": "end",
            "targetHandle": "target",
            "type": "custom",
            "data": {"sourceType": "code", "targetType": "end", "isInLoop": False},
        },
    ]
    graph["nodes"][1] = {
        "id": "code",
        "type": "custom",
        "sourcePosition": "right",
        "targetPosition": "left",
        "position": {"x": 300, "y": 0},
        "data": {
            "title": "Bad Code",
            "type": "code",
            "variables": [
                {
                    "variable": "text",
                    "value_selector": ["missing_node", "text"],
                }
            ],
            "code": "",
            "outputs": [{"variable": "result", "type": "string"}],
        },
    }
    graph["nodes"][2]["data"]["outputs"] = [
        {
            "variable": "result",
            "value_type": "string",
            "value_selector": ["code", "result"],
        }
    ]
    return doc


def issue_codes(report: dict[str, Any]) -> set[str]:
    return {str(issue["code"]) for issue in report["issues"]}


def assert_case(name: str, doc: dict[str, Any], expected_codes: set[str], expected_valid: bool) -> dict[str, Any]:
    yaml_text = yaml.safe_dump(doc, sort_keys=False, allow_unicode=True)
    report = validate_yaml_text(yaml_text).to_dict()
    actual_codes = issue_codes(report)
    missing = expected_codes - actual_codes
    if missing:
        raise AssertionError(f"{name}: missing expected issue codes {sorted(missing)}; got {sorted(actual_codes)}")
    if bool(report["valid"]) != expected_valid:
        raise AssertionError(f"{name}: expected valid={expected_valid}, got {report['valid']} with {report['issues']}")
    return {"name": name, "valid": report["valid"], "issues": report["issues"]}


def main() -> int:
    valid_doc = base_workflow_doc()
    valid_llm_doc = llm_workflow_doc()
    valid_agent_doc = agent_workflow_doc()

    missing_dependency_doc = deepcopy(valid_doc)
    missing_dependency_doc["dependencies"] = []

    missing_model_dependency_doc = deepcopy(valid_llm_doc)
    missing_model_dependency_doc["dependencies"] = []

    missing_agent_dependency_doc = deepcopy(valid_agent_doc)
    missing_agent_dependency_doc["dependencies"] = []

    mismatch_doc = deepcopy(valid_doc)
    mismatch_doc["dependencies"][0]["value"]["marketplace_plugin_unique_identifier"] = GMAIL_ALT_UID

    mismatch_agent_doc = deepcopy(valid_agent_doc)
    mismatch_agent_doc["dependencies"][0]["value"]["marketplace_plugin_unique_identifier"] = AGENT_ALT_UID

    malformed_dependency_doc = deepcopy(valid_doc)
    malformed_dependency_doc["dependencies"][0] = {
        "type": "marketplace",
        "value": {"plugin_unique_identifier": GMAIL_UID},
    }

    malformed_native_doc = malformed_native_shape_doc()
    malformed_code_doc = malformed_code_node_doc()

    cases = [
        assert_case("valid_plugin_dependency", valid_doc, set(), True),
        assert_case("valid_model_dependency", valid_llm_doc, set(), True),
        assert_case("valid_agent_dependency", valid_agent_doc, set(), True),
        assert_case("missing_plugin_dependency", missing_dependency_doc, {"plugin_dependency_missing"}, False),
        assert_case("missing_model_dependency", missing_model_dependency_doc, {"model_dependency_missing"}, False),
        assert_case("missing_agent_dependency", missing_agent_dependency_doc, {"plugin_dependency_missing"}, False),
        assert_case(
            "plugin_dependency_identifier_mismatch",
            mismatch_doc,
            {"plugin_dependency_identifier_mismatch"},
            True,
        ),
        assert_case(
            "agent_dependency_identifier_mismatch",
            mismatch_agent_doc,
            {"plugin_dependency_identifier_mismatch"},
            True,
        ),
        assert_case(
            "dependency_identifier_key_mismatch",
            malformed_dependency_doc,
            {"dependency_identifier_key_mismatch"},
            False,
        ),
        assert_case(
            "malformed_native_node_shapes",
            malformed_native_doc,
            {
                "conversation_variables_missing_name_or_type",
                "conversation_variables_value_missing",
                "start_variable_required_field_missing",
                "start_variable_uses_key_instead_of_variable",
                "start_variable_type_invalid",
                "end_output_required_field_missing",
                "end_output_uses_key_instead_of_variable",
                "end_output_uses_value_instead_of_selector",
            },
            False,
        ),
        assert_case(
            "malformed_code_node",
            malformed_code_doc,
            {
                "selector_target_missing",
                "code_language_missing",
                "code_missing",
                "code_outputs_missing",
            },
            False,
        ),
    ]

    print(json.dumps({"valid": True, "cases": cases}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
