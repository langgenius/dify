#!/usr/bin/env python3
from __future__ import annotations

import json
from copy import deepcopy
from typing import Any

import yaml

from run_validator_smoke_tests import malformed_native_shape_doc
from shape_normalizer import normalize_shape_yaml_text
from validator import validate_yaml_text


def issue_codes(report: dict[str, Any]) -> set[str]:
    return {str(issue["code"]) for issue in report.get("issues", [])}


def assert_malformed_native_shape_normalized() -> dict[str, Any]:
    before_doc = malformed_native_shape_doc()
    before_yaml = yaml.safe_dump(before_doc, sort_keys=False, allow_unicode=True)
    before_report = validate_yaml_text(before_yaml).to_dict()
    if before_report.get("valid"):
        raise AssertionError("malformed native shape fixture should be invalid before normalization")

    normalized_yaml, normalization_report = normalize_shape_yaml_text(before_yaml)
    after_report = validate_yaml_text(normalized_yaml).to_dict()
    if not after_report.get("valid"):
        raise AssertionError(f"expected normalized DSL to be valid: {after_report}")

    normalized_doc = yaml.safe_load(normalized_yaml)
    conversation_var = normalized_doc["workflow"]["conversation_variables"][0]
    start_var = normalized_doc["workflow"]["graph"]["nodes"][0]["data"]["variables"][0]
    end_output = normalized_doc["workflow"]["graph"]["nodes"][1]["data"]["outputs"][0]
    if conversation_var.get("name") != "query" or conversation_var.get("value_type") != "string":
        raise AssertionError(f"conversation variable was not normalized: {conversation_var}")
    if conversation_var.get("value") != "":
        raise AssertionError(f"conversation variable default value was not added: {conversation_var}")
    if "key" in conversation_var or "type" in conversation_var:
        raise AssertionError(f"conversation variable aliases should be removed: {conversation_var}")
    if start_var.get("variable") != "query" or start_var.get("type") != "text-input":
        raise AssertionError(f"start variable was not normalized: {start_var}")
    if end_output.get("value_selector") != ["start", "query"] or end_output.get("value_type") != "string":
        raise AssertionError(f"end output was not normalized: {end_output}")
    if "key" in start_var or "key" in end_output or "value" in end_output:
        raise AssertionError(f"alias fields should be removed: {start_var=}, {end_output=}")

    return {
        "name": "malformed_native_shape_normalized",
        "valid": True,
        "fix_count": len(normalization_report.get("fixes", [])),
        "before_codes": sorted(issue_codes(before_report)),
    }


def assert_workflow_viewport_moved() -> dict[str, Any]:
    doc = malformed_native_shape_doc()
    graph = doc["workflow"]["graph"]
    doc["workflow"]["viewport"] = graph.pop("viewport")
    fixed_yaml, normalization_report = normalize_shape_yaml_text(yaml.safe_dump(doc, sort_keys=False, allow_unicode=True))
    fixed = yaml.safe_load(fixed_yaml)
    if "viewport" in fixed["workflow"]:
        raise AssertionError(f"workflow.viewport should have been moved: {fixed['workflow']}")
    if "viewport" not in fixed["workflow"]["graph"]:
        raise AssertionError(f"workflow.graph.viewport should exist: {fixed['workflow']['graph']}")
    if "viewport_moved_to_graph" not in {item.get("code") for item in normalization_report.get("fixes", [])}:
        raise AssertionError(f"normalization report did not record viewport move: {normalization_report}")
    return {"name": "workflow_viewport_moved", "valid": True}


def assert_idempotent_on_valid_export_shape() -> dict[str, Any]:
    doc = malformed_native_shape_doc()
    normalized_yaml, first_report = normalize_shape_yaml_text(yaml.safe_dump(doc, sort_keys=False, allow_unicode=True))
    second_yaml, second_report = normalize_shape_yaml_text(normalized_yaml)
    if normalized_yaml != second_yaml:
        raise AssertionError("normalizer should be idempotent on its own output")
    if second_report.get("changed"):
        raise AssertionError(f"second normalization should not change anything: {second_report}")
    return {
        "name": "idempotent_on_valid_export_shape",
        "valid": True,
        "first_fix_count": len(first_report.get("fixes", [])),
    }


def assert_workflow_nodes_promoted_to_graph() -> dict[str, Any]:
    doc = malformed_native_shape_doc()
    doc = deepcopy(doc)
    graph = doc["workflow"].pop("graph")
    doc["workflow"]["nodes"] = graph["nodes"]
    doc["workflow"]["edges"] = graph["edges"]
    doc["workflow"]["viewport"] = graph["viewport"]

    normalized_yaml, normalization_report = normalize_shape_yaml_text(yaml.safe_dump(doc, sort_keys=False, allow_unicode=True))
    fixed = yaml.safe_load(normalized_yaml)
    if "nodes" in fixed["workflow"] or "edges" in fixed["workflow"]:
        raise AssertionError(f"workflow-level nodes/edges should have been moved: {fixed['workflow'].keys()}")
    if "graph" not in fixed["workflow"] or "nodes" not in fixed["workflow"]["graph"]:
        raise AssertionError(f"workflow.graph should have been created: {fixed['workflow']}")
    if "graph_created_from_workflow_nodes" not in {item.get("code") for item in normalization_report.get("fixes", [])}:
        raise AssertionError(f"normalization report did not record graph promotion: {normalization_report}")
    return {"name": "workflow_nodes_promoted_to_graph", "valid": True}


def assert_plugin_trigger_shape_normalized() -> dict[str, Any]:
    doc = malformed_native_shape_doc()
    doc["dependencies"] = [
        {
            "current_identifier": None,
            "type": "marketplace",
            "value": {"marketplace_plugin_unique_identifier": "langgenius/typeform_trigger:0.1.1@hash"},
        }
    ]
    graph = doc["workflow"]["graph"]
    graph["nodes"][0] = {
        "id": "typeform_trigger",
        "type": "custom",
        "sourcePosition": "right",
        "targetPosition": "left",
        "position": {"x": 0, "y": 0},
        "data": {
            "title": "Typeform Trigger",
            "type": "trigger",
            "provider_id": "langgenius/typeform_trigger/typeform_trigger",
            "plugin_unique_identifier": "langgenius/typeform_trigger:0.1.1@hash",
            "event_name": "form_response_received",
            "event_parameters": {"hidden_field_filter": "", "variable_filter": ""},
        },
    }
    graph["edges"][0]["source"] = "typeform_trigger"
    graph["edges"][0]["id"] = "typeform_trigger-source-end-target"
    graph["edges"][0]["data"]["sourceType"] = "trigger"
    graph["nodes"][1]["data"]["outputs"] = [
        {
            "variable": "query",
            "value_type": "string",
            "value_selector": ["typeform_trigger", "form_response"],
        }
    ]

    normalized_yaml, normalization_report = normalize_shape_yaml_text(yaml.safe_dump(doc, sort_keys=False, allow_unicode=True))
    fixed = yaml.safe_load(normalized_yaml)
    trigger = fixed["workflow"]["graph"]["nodes"][0]["data"]
    edge = fixed["workflow"]["graph"]["edges"][0]["data"]
    if trigger.get("type") != "trigger-plugin":
        raise AssertionError(f"trigger type should be normalized: {trigger}")
    if trigger.get("plugin_id") != "langgenius/typeform_trigger":
        raise AssertionError(f"trigger plugin_id should be inferred: {trigger}")
    if trigger.get("subscription_id") != "":
        raise AssertionError(f"trigger subscription_id should be added: {trigger}")
    if trigger["event_parameters"]["hidden_field_filter"] != {"type": "constant", "value": ""}:
        raise AssertionError(f"trigger event parameter should be wrapped: {trigger}")
    if edge.get("sourceType") != "trigger-plugin":
        raise AssertionError(f"edge sourceType should be aligned: {edge}")
    after_report = validate_yaml_text(normalized_yaml).to_dict()
    if not after_report.get("valid"):
        raise AssertionError(f"expected normalized plugin trigger DSL to be valid: {after_report}")

    return {
        "name": "plugin_trigger_shape_normalized",
        "valid": True,
        "fix_codes": sorted({item.get("code") for item in normalization_report.get("fixes", [])}),
    }


def main() -> int:
    cases = [
        assert_malformed_native_shape_normalized(),
        assert_workflow_viewport_moved(),
        assert_idempotent_on_valid_export_shape(),
        assert_workflow_nodes_promoted_to_graph(),
        assert_plugin_trigger_shape_normalized(),
    ]
    print(json.dumps({"valid": True, "cases": cases}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
