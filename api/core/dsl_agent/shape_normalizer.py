#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any

import yaml


SELECTOR_RE = re.compile(r"^\s*\{\{#([^#]+)#\}\}\s*$")

START_TYPE_ALIASES = {
    "bool": "checkbox",
    "boolean": "checkbox",
    "dict": "json_object",
    "integer": "number",
    "json": "json_object",
    "json-object": "json_object",
    "object": "json_object",
    "str": "text-input",
    "string": "text-input",
    "text": "text-input",
    "textarea": "paragraph",
}

VALUE_TYPE_ALIASES = {
    "bool": "boolean",
    "dict": "object",
    "integer": "number",
    "json": "object",
    "json_object": "object",
    "json-object": "object",
    "str": "string",
    "text": "string",
    "text-input": "string",
}


def empty_report() -> dict[str, Any]:
    return {"changed": False, "fixes": [], "errors": []}


def add_fix(report: dict[str, Any], path: str, code: str, message: str) -> None:
    report["changed"] = True
    report["fixes"].append({"path": path, "code": code, "message": message})


def as_non_empty_string(value: Any) -> str:
    return value.strip() if isinstance(value, str) and value.strip() else ""


def normalize_start_type(value: Any) -> Any:
    if not isinstance(value, str):
        return value
    return START_TYPE_ALIASES.get(value.strip().lower(), value)


def normalize_value_type(value: Any) -> Any:
    if not isinstance(value, str):
        return value
    return VALUE_TYPE_ALIASES.get(value.strip().lower(), value)


def infer_value_type(value: Any) -> str:
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, (int, float)):
        return "number"
    if isinstance(value, list):
        return "array[object]"
    if isinstance(value, dict):
        return "object"
    return "string"


def default_value_for_type(value_type: Any) -> Any:
    normalized = normalize_value_type(value_type)
    if normalized == "boolean":
        return False
    if normalized == "number":
        return 0
    if normalized == "object":
        return {}
    if isinstance(normalized, str) and normalized.startswith("array["):
        return []
    return ""


def selector_from_value(value: Any) -> list[str] | None:
    if isinstance(value, list) and all(isinstance(item, str) and item for item in value):
        return list(value)
    if not isinstance(value, str):
        return None

    stripped = value.strip()
    match = SELECTOR_RE.match(stripped)
    if match:
        stripped = match.group(1).strip()
    if not stripped or any(char.isspace() for char in stripped):
        return None
    parts = [part for part in stripped.split(".") if part]
    if len(parts) >= 2:
        return parts
    return None


def plugin_id_from_unique_identifier(value: Any) -> str:
    if not isinstance(value, str) or not value.strip():
        return ""
    return value.split(":", 1)[0].strip()


def plugin_id_from_provider_id(value: Any) -> str:
    if not isinstance(value, str):
        return ""
    parts = [part for part in value.split("/") if part]
    if len(parts) >= 2:
        return f"{parts[0]}/{parts[1]}"
    return ""


def normalize_trigger_plugin_node(data_block: dict[str, Any], *, node_index: int, report: dict[str, Any]) -> None:
    path = f"$.workflow.graph.nodes[{node_index}].data"
    plugin_id = as_non_empty_string(data_block.get("plugin_id"))
    if not plugin_id:
        plugin_id = plugin_id_from_unique_identifier(data_block.get("plugin_unique_identifier")) or plugin_id_from_provider_id(data_block.get("provider_id"))
        if plugin_id:
            data_block["plugin_id"] = plugin_id
            add_fix(report, f"{path}.plugin_id", "trigger_plugin_id_inferred", "Inferred trigger plugin_id.")

    if "subscription_id" not in data_block:
        data_block["subscription_id"] = ""
        add_fix(report, f"{path}.subscription_id", "trigger_subscription_id_added", "Added empty trigger subscription_id.")

    parameters = data_block.get("event_parameters")
    if isinstance(parameters, dict):
        for key, value in list(parameters.items()):
            if not isinstance(value, dict):
                parameters[key] = {"type": "constant", "value": value if value is not None else ""}
                add_fix(report, f"{path}.event_parameters.{key}", "trigger_event_parameter_wrapped", "Wrapped event parameter as constant value.")


def normalize_nullable_variable_selectors(value: Any, *, path: str, report: dict[str, Any]) -> None:
    if isinstance(value, dict):
        for key, item in list(value.items()):
            item_path = f"{path}.{key}"
            if key == "variable_selector" and item is None:
                value[key] = []
                add_fix(report, item_path, "nullable_variable_selector_empty", "Replaced null variable_selector with empty list.")
            else:
                normalize_nullable_variable_selectors(item, path=item_path, report=report)
    elif isinstance(value, list):
        for index, item in enumerate(value):
            normalize_nullable_variable_selectors(item, path=f"{path}[{index}]", report=report)


def normalize_workflow_variable(
    variable: dict[str, Any],
    *,
    field: str,
    index: int,
    report: dict[str, Any],
) -> None:
    path = f"$.workflow.{field}[{index}]"
    name = as_non_empty_string(variable.get("name"))
    alias = as_non_empty_string(variable.get("key")) or as_non_empty_string(variable.get("variable"))
    if not name and alias:
        variable["name"] = alias
        add_fix(report, f"{path}.name", f"{field}_name_from_alias", "Mapped key/variable to name.")

    value_type = variable.get("value_type")
    alias_type = variable.get("type") or variable.get("var_type")
    if not value_type and alias_type:
        variable["value_type"] = normalize_value_type(alias_type)
        add_fix(report, f"{path}.value_type", f"{field}_value_type_from_alias", "Mapped type/var_type to value_type.")
    elif value_type:
        normalized_type = normalize_value_type(value_type)
        if normalized_type != value_type:
            variable["value_type"] = normalized_type
            add_fix(report, f"{path}.value_type", f"{field}_value_type_alias", "Normalized value_type alias.")
    elif "value" in variable:
        variable["value_type"] = infer_value_type(variable.get("value"))
        add_fix(report, f"{path}.value_type", f"{field}_value_type_inferred", "Inferred value_type from value.")

    if "value_type" in variable and ("value" not in variable or variable.get("value") is None):
        variable["value"] = default_value_for_type(variable.get("value_type"))
        add_fix(report, f"{path}.value", f"{field}_value_added", "Added default value required by Dify import.")

    if field == "environment_variables" and variable.get("name") and "selector" not in variable:
        variable["selector"] = ["env", variable["name"]]
        add_fix(report, f"{path}.selector", "environment_variable_selector_added", "Added env selector.")

    for alias_key in ("key", "variable", "type", "var_type"):
        if alias_key in variable:
            variable.pop(alias_key)
            add_fix(report, f"{path}.{alias_key}", f"{field}_alias_removed", f"Removed {alias_key} alias.")


def normalize_start_variable(variable: dict[str, Any], *, node_index: int, variable_index: int, report: dict[str, Any]) -> None:
    path = f"$.workflow.graph.nodes[{node_index}].data.variables[{variable_index}]"
    variable_name = as_non_empty_string(variable.get("variable"))
    alias = as_non_empty_string(variable.get("key")) or as_non_empty_string(variable.get("name"))
    if not variable_name and alias:
        variable["variable"] = alias
        add_fix(report, f"{path}.variable", "start_variable_from_alias", "Mapped key/name to variable.")

    if not as_non_empty_string(variable.get("label")):
        label = as_non_empty_string(variable.get("label")) or as_non_empty_string(variable.get("name"))
        label = label or as_non_empty_string(variable.get("key")) or as_non_empty_string(variable.get("variable"))
        if label:
            variable["label"] = label
            add_fix(report, f"{path}.label", "start_variable_label_added", "Added label from variable name.")

    variable_type = variable.get("type")
    if variable_type:
        normalized_type = normalize_start_type(variable_type)
        if normalized_type != variable_type:
            variable["type"] = normalized_type
            add_fix(report, f"{path}.type", "start_variable_type_alias", "Normalized start variable type alias.")
    elif variable.get("value_type"):
        variable["type"] = normalize_start_type(variable.get("value_type"))
        add_fix(report, f"{path}.type", "start_variable_type_from_value_type", "Mapped value_type to start variable type.")

    for alias_key in ("key", "name"):
        if alias_key in variable:
            variable.pop(alias_key)
            add_fix(report, f"{path}.{alias_key}", "start_variable_alias_removed", f"Removed {alias_key} alias.")


def normalize_end_output(output: dict[str, Any], *, node_index: int, output_index: int, report: dict[str, Any]) -> None:
    path = f"$.workflow.graph.nodes[{node_index}].data.outputs[{output_index}]"
    variable_name = as_non_empty_string(output.get("variable"))
    alias = as_non_empty_string(output.get("key")) or as_non_empty_string(output.get("name"))
    if not variable_name and alias:
        output["variable"] = alias
        add_fix(report, f"{path}.variable", "end_output_variable_from_alias", "Mapped key/name to variable.")

    selector = output.get("value_selector")
    if not selector:
        selector = selector_from_value(output.get("selector"))
        if selector:
            output["value_selector"] = selector
            add_fix(report, f"{path}.value_selector", "end_output_selector_from_selector", "Mapped selector to value_selector.")
    if not output.get("value_selector"):
        selector = selector_from_value(output.get("value"))
        if selector:
            output["value_selector"] = selector
            add_fix(report, f"{path}.value_selector", "end_output_selector_from_value", "Parsed value into value_selector.")

    if "value_type" not in output:
        alias_type = output.get("type")
        output["value_type"] = normalize_value_type(alias_type) if alias_type else infer_value_type(output.get("value"))
        add_fix(report, f"{path}.value_type", "end_output_value_type_added", "Added value_type.")
    else:
        normalized_type = normalize_value_type(output.get("value_type"))
        if normalized_type != output.get("value_type"):
            output["value_type"] = normalized_type
            add_fix(report, f"{path}.value_type", "end_output_value_type_alias", "Normalized value_type alias.")

    for alias_key in ("key", "name", "selector", "value"):
        if alias_key in output:
            output.pop(alias_key)
            add_fix(report, f"{path}.{alias_key}", "end_output_alias_removed", f"Removed {alias_key} alias.")


def normalize_shape_dict(data: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    report = empty_report()
    workflow = data.get("workflow")
    if not isinstance(workflow, dict):
        return data, report

    graph = workflow.get("graph")
    if not isinstance(graph, dict) and isinstance(workflow.get("nodes"), list) and isinstance(workflow.get("edges"), list):
        graph = {"nodes": workflow.pop("nodes"), "edges": workflow.pop("edges")}
        workflow["graph"] = graph
        add_fix(report, "$.workflow.graph", "graph_created_from_workflow_nodes", "Moved workflow-level nodes/edges into workflow.graph.")

    if isinstance(graph, dict) and "viewport" not in graph and isinstance(workflow.get("viewport"), dict):
        graph["viewport"] = workflow.pop("viewport")
        add_fix(report, "$.workflow.graph.viewport", "viewport_moved_to_graph", "Moved workflow.viewport to workflow.graph.viewport.")

    for field in ("environment_variables", "conversation_variables"):
        variables = workflow.get(field)
        if variables is None:
            workflow[field] = []
            add_fix(report, f"$.workflow.{field}", f"{field}_added", f"Added empty {field}.")
            continue
        if not isinstance(variables, list):
            continue
        for index, variable in enumerate(variables):
            if isinstance(variable, dict):
                normalize_workflow_variable(variable, field=field, index=index, report=report)

    if "features" not in workflow:
        workflow["features"] = {}
        add_fix(report, "$.workflow.features", "workflow_features_added", "Added empty workflow.features.")

    if not isinstance(graph, dict):
        return data, report

    nodes = graph.get("nodes")
    if not isinstance(nodes, list):
        return data, report
    node_types_by_id: dict[str, str] = {}
    for node_index, node in enumerate(nodes):
        if not isinstance(node, dict):
            continue
        data_block = node.get("data")
        if not isinstance(data_block, dict):
            continue
        node_type = data_block.get("type") or node.get("type")
        if node_type == "trigger" and (
            data_block.get("event_name") or data_block.get("plugin_unique_identifier") or data_block.get("provider_id")
        ):
            data_block["type"] = "trigger-plugin"
            node_type = "trigger-plugin"
            add_fix(report, f"$.workflow.graph.nodes[{node_index}].data.type", "trigger_type_alias", "Mapped plugin trigger type alias to trigger-plugin.")
        normalize_nullable_variable_selectors(data_block, path=f"$.workflow.graph.nodes[{node_index}].data", report=report)
        if node_type == "start":
            variables = data_block.get("variables")
            if variables is None:
                data_block["variables"] = []
                add_fix(report, f"$.workflow.graph.nodes[{node_index}].data.variables", "start_variables_added", "Added empty start variables.")
                continue
            if not isinstance(variables, list):
                continue
            for variable_index, variable in enumerate(variables):
                if isinstance(variable, dict):
                    normalize_start_variable(variable, node_index=node_index, variable_index=variable_index, report=report)
        elif node_type == "end":
            outputs = data_block.get("outputs")
            if outputs is None:
                data_block["outputs"] = []
                add_fix(report, f"$.workflow.graph.nodes[{node_index}].data.outputs", "end_outputs_added", "Added empty end outputs.")
                continue
            if not isinstance(outputs, list):
                continue
            for output_index, output in enumerate(outputs):
                if isinstance(output, dict):
                    normalize_end_output(output, node_index=node_index, output_index=output_index, report=report)
        elif node_type == "trigger-plugin":
            normalize_trigger_plugin_node(data_block, node_index=node_index, report=report)

        node_id = node.get("id")
        if isinstance(node_id, str) and isinstance(data_block.get("type"), str):
            node_types_by_id[node_id] = data_block["type"]

    edges = graph.get("edges")
    if isinstance(edges, list):
        for edge_index, edge in enumerate(edges):
            if not isinstance(edge, dict):
                continue
            edge_data = edge.get("data")
            if not isinstance(edge_data, dict):
                continue
            for node_key, type_key in (("source", "sourceType"), ("target", "targetType")):
                node_id = edge.get(node_key)
                expected = node_types_by_id.get(node_id) if isinstance(node_id, str) else None
                if expected and edge_data.get(type_key) != expected:
                    edge_data[type_key] = expected
                    add_fix(report, f"$.workflow.graph.edges[{edge_index}].data.{type_key}", "edge_node_type_aligned", f"Aligned edge {type_key} with node data.type.")

    return data, report


def normalize_shape_yaml_text(yaml_text: str) -> tuple[str, dict[str, Any]]:
    try:
        data = yaml.safe_load(yaml_text)
    except yaml.YAMLError as exc:
        report = empty_report()
        report["errors"].append({"code": "yaml_parse_failed", "message": str(exc)})
        return yaml_text, report

    if not isinstance(data, dict):
        report = empty_report()
        report["errors"].append({"code": "yaml_not_mapping", "message": "YAML document must be a mapping."})
        return yaml_text, report

    normalized, report = normalize_shape_dict(data)
    if not report["changed"]:
        return yaml_text, report
    return yaml.safe_dump(normalized, sort_keys=False, allow_unicode=True), report


def main() -> int:
    parser = argparse.ArgumentParser(description="Normalize common LLM-generated Dify DSL shape aliases.")
    parser.add_argument("yaml_file", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--report-output", type=Path)
    args = parser.parse_args()

    normalized, report = normalize_shape_yaml_text(args.yaml_file.read_text())
    output = args.output or args.yaml_file
    output.write_text(normalized)
    if args.report_output:
        args.report_output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    else:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if not report.get("errors") else 1


if __name__ == "__main__":
    raise SystemExit(main())
