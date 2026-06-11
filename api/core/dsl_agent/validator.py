#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
import sys
import uuid
from collections import Counter, deque
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml


TRIGGER_NODE_TYPES = {"trigger-plugin", "trigger-schedule", "trigger-webhook"}
SYSTEM_SELECTOR_ROOTS = {"sys", "env", "conversation", "rag"}
VAR_REF_RE = re.compile(r"\{\{#([^.#]+)\.[^#]*#\}\}")
VAR_REF_PATH_RE = re.compile(r"\{\{#([^#]+)#\}\}")
GENERIC_PROVIDER_RE = re.compile(r"^[a-z0-9_-]+(?:/[a-z0-9_-]+/[a-z0-9_-]+)?$")
SUSPICIOUS_MODEL_NAME_RE = re.compile(r"(definitely|fake|invalid|not[-_ ]?a[-_ ]?real|placeholder|unknown)", re.IGNORECASE)
PLACEHOLDER_DATASET_IDS = {"REPLACE_WITH_DATASET_ID", "YOUR_DATASET_ID", "DATASET_ID"}
SELECTOR_KEYS = {"value_selector", "variable_selector"}
DEPENDENCY_TYPES = {"github", "marketplace", "package"}
DEPENDENCY_IDENTIFIER_KEYS = (
    "github_plugin_unique_identifier",
    "marketplace_plugin_unique_identifier",
    "plugin_unique_identifier",
)
DEPENDENCY_IDENTIFIER_KEY_BY_TYPE = {
    "github": "github_plugin_unique_identifier",
    "marketplace": "marketplace_plugin_unique_identifier",
    "package": "plugin_unique_identifier",
}
START_VARIABLE_TYPES = {
    "checkbox",
    "external_data_tool",
    "file",
    "file-list",
    "json_object",
    "number",
    "paragraph",
    "select",
    "text-input",
}


@dataclass
class ValidationIssue:
    severity: str
    code: str
    path: str
    message: str


@dataclass
class ValidationReport:
    valid: bool = True
    issues: list[ValidationIssue] = field(default_factory=list)

    def add(self, severity: str, code: str, path: str, message: str) -> None:
        if any(
            issue.severity == severity
            and issue.code == code
            and issue.path == path
            and issue.message == message
            for issue in self.issues
        ):
            return
        self.issues.append(ValidationIssue(severity, code, path, message))
        if severity == "error":
            self.valid = False

    def to_dict(self) -> dict[str, Any]:
        return {
            "valid": self.valid,
            "issues": [issue.__dict__ for issue in self.issues],
        }


def node_type(node: dict[str, Any]) -> str:
    data = node.get("data") or {}
    return str(data.get("type") or node.get("type") or "")


def plugin_id_from_unique_identifier(unique_identifier: Any) -> str:
    if not isinstance(unique_identifier, str) or not unique_identifier.strip():
        return ""
    return unique_identifier.split(":", 1)[0].strip()


def plugin_id_from_provider_id(provider_id: Any) -> str:
    if not isinstance(provider_id, str):
        return ""
    parts = provider_id.split("/")
    if len(parts) < 2:
        return ""
    return f"{parts[0]}/{parts[1]}"


def plugin_id_from_model_provider(provider: Any) -> str:
    if not isinstance(provider, str) or not provider.strip():
        return ""
    provider = provider.strip()
    if not GENERIC_PROVIDER_RE.match(provider):
        return ""
    parts = provider.split("/")
    if len(parts) == 1:
        organization = "langgenius"
        plugin_name = parts[0]
        provider_name = parts[0]
    elif len(parts) == 3:
        organization, plugin_name, provider_name = parts
    else:
        return ""
    if organization == "langgenius" and provider_name == "google":
        plugin_name = "gemini"
    return f"{organization}/{plugin_name}"


def dependency_unique_identifier(dependency: Any) -> str:
    if not isinstance(dependency, dict):
        return ""
    value = dependency.get("value")
    if not isinstance(value, dict):
        return ""
    for key in DEPENDENCY_IDENTIFIER_KEYS:
        identifier = value.get(key)
        if isinstance(identifier, str) and identifier.strip():
            return identifier.strip()
    return ""


def dependency_identifier_key(dependency: Any) -> str:
    if not isinstance(dependency, dict):
        return ""
    value = dependency.get("value")
    if not isinstance(value, dict):
        return ""
    for key in DEPENDENCY_IDENTIFIER_KEYS:
        identifier = value.get(key)
        if isinstance(identifier, str) and identifier.strip():
            return key
    return ""


def validate_dependencies(
    report: ValidationReport,
    dependencies: Any,
) -> tuple[dict[str, set[str]], set[str]]:
    identifiers_by_plugin: dict[str, set[str]] = {}
    identifiers: set[str] = set()
    seen_counter: Counter[str] = Counter()

    if not isinstance(dependencies, list):
        return identifiers_by_plugin, identifiers

    for index, dependency in enumerate(dependencies):
        path = f"$.dependencies[{index}]"
        if not isinstance(dependency, dict):
            report.add("error", "dependency_item_not_mapping", path, "dependency item must be a mapping")
            continue

        dep_type = dependency.get("type")
        if dep_type not in DEPENDENCY_TYPES:
            report.add(
                "error",
                "dependency_type_invalid",
                f"{path}.type",
                "dependency.type must be one of github, marketplace, package",
            )

        value = dependency.get("value")
        if not isinstance(value, dict):
            report.add("error", "dependency_value_not_mapping", f"{path}.value", "dependency.value must be a mapping")
            continue

        identifier = dependency_unique_identifier(dependency)
        identifier_key = dependency_identifier_key(dependency)
        expected_key = DEPENDENCY_IDENTIFIER_KEY_BY_TYPE.get(str(dep_type))
        if not identifier:
            report.add(
                "error",
                "dependency_identifier_missing",
                f"{path}.value",
                "dependency.value must include a plugin unique identifier",
            )
            continue
        if expected_key and identifier_key != expected_key:
            report.add(
                "error",
                "dependency_identifier_key_mismatch",
                f"{path}.value",
                f"dependency.type `{dep_type}` must use `{expected_key}`",
            )

        plugin_id = plugin_id_from_unique_identifier(identifier)
        if not plugin_id or "/" not in plugin_id:
            report.add(
                "error",
                "dependency_identifier_invalid",
                f"{path}.value.{identifier_key}",
                "plugin unique identifier should start with author/name",
            )
        else:
            identifiers_by_plugin.setdefault(plugin_id, set()).add(identifier)
            identifiers.add(identifier)
            seen_counter[identifier] += 1

        if ":" not in identifier:
            report.add(
                "warning",
                "dependency_identifier_version_missing",
                f"{path}.value.{identifier_key}",
                "plugin unique identifier usually includes :version",
            )
        elif "@" not in identifier:
            report.add(
                "warning",
                "dependency_identifier_hash_missing",
                f"{path}.value.{identifier_key}",
                "plugin unique identifier should include @hash when exact export evidence is available",
            )

    for identifier, count in sorted(seen_counter.items()):
        if count > 1:
            report.add("warning", "dependency_duplicate", "$.dependencies", f"duplicate dependency `{identifier}`")

    return identifiers_by_plugin, identifiers


def plugin_identity_from_node(data_block: dict[str, Any]) -> tuple[str, str]:
    unique_identifier = data_block.get("plugin_unique_identifier")
    plugin_id = plugin_id_from_unique_identifier(unique_identifier)
    if not plugin_id:
        plugin_id = str(data_block.get("plugin_id") or "").strip()
    if not plugin_id:
        plugin_id = plugin_id_from_provider_id(data_block.get("provider_id"))
    return plugin_id, str(unique_identifier or "").strip()


def validate_plugin_dependency_presence(
    report: ValidationReport,
    dependency_identifiers_by_plugin: dict[str, set[str]],
    *,
    plugin_id: str,
    node_id: Any,
    node_kind: str,
    dependency_kind: str,
) -> None:
    if plugin_id not in dependency_identifiers_by_plugin:
        report.add(
            "error",
            f"{dependency_kind}_dependency_missing",
            "$.dependencies",
            f"{node_kind} node `{node_id}` uses plugin `{plugin_id}` but top-level dependencies does not include it",
        )


def validate_model_provider_dependency(
    report: ValidationReport,
    dependency_identifiers_by_plugin: dict[str, set[str]],
    *,
    provider: Any,
    path: str,
    node_id: Any,
    node_kind: str,
) -> None:
    if not isinstance(provider, str) or not provider.strip():
        report.add("error", "model_provider_missing", path, f"{node_kind} node requires model.provider")
        return
    plugin_id = plugin_id_from_model_provider(provider)
    if not plugin_id:
        report.add("error", "model_provider_invalid", path, f"model.provider `{provider}` is not a valid provider id")
        return
    validate_plugin_dependency_presence(
        report,
        dependency_identifiers_by_plugin,
        plugin_id=plugin_id,
        node_id=node_id,
        node_kind=node_kind,
        dependency_kind="model",
    )


def validate_model_block(report: ValidationReport, model: Any, path: str, node_id: Any, node_kind: str) -> None:
    if not isinstance(model, dict):
        report.add("error", "model_block_missing", path, f"{node_kind} node requires a model mapping")
        return
    provider = model.get("provider")
    name = model.get("name")
    if not isinstance(name, str) or not name.strip():
        report.add("error", "model_name_missing", f"{path}.name", f"{node_kind} node requires model.name")
    elif plugin_id_from_model_provider(provider) == "langgenius/openai" and SUSPICIOUS_MODEL_NAME_RE.search(name):
        report.add(
            "error",
            "model_name_suspicious",
            f"{path}.name",
            f"{node_kind} node `{node_id}` uses suspicious OpenAI model name `{name}`",
        )


def model_provider_entries(data_block: dict[str, Any], typ: str, path: str) -> list[tuple[str, Any]]:
    entries: list[tuple[str, Any]] = []
    if typ in {"llm", "question-classifier", "parameter-extractor"}:
        model = data_block.get("model")
        if isinstance(model, dict):
            entries.append((f"{path}.data.model.provider", model.get("provider")))
        else:
            entries.append((f"{path}.data.model", None))
    if typ == "knowledge-retrieval":
        retrieval_mode = data_block.get("retrieval_mode")
        if retrieval_mode == "multiple":
            multiple = data_block.get("multiple_retrieval_config")
            if isinstance(multiple, dict):
                if multiple.get("reranking_mode") == "reranking_model":
                    reranking_model = multiple.get("reranking_model")
                    if isinstance(reranking_model, dict):
                        entries.append((f"{path}.data.multiple_retrieval_config.reranking_model.provider", reranking_model.get("provider")))
                elif multiple.get("reranking_mode") == "weighted_score":
                    weights = multiple.get("weights")
                    vector_setting = weights.get("vector_setting") if isinstance(weights, dict) else None
                    if isinstance(vector_setting, dict):
                        entries.append(
                            (
                                f"{path}.data.multiple_retrieval_config.weights.vector_setting.embedding_provider_name",
                                vector_setting.get("embedding_provider_name"),
                            )
                        )
        elif retrieval_mode == "single":
            single = data_block.get("single_retrieval_config")
            model = single.get("model") if isinstance(single, dict) else None
            if isinstance(model, dict):
                entries.append((f"{path}.data.single_retrieval_config.model.provider", model.get("provider")))
    return entries


def selector_references(value: Any) -> list[tuple[list[str], str]]:
    found: list[tuple[list[str], str]] = []
    if isinstance(value, str):
        for match in VAR_REF_PATH_RE.finditer(value):
            selector = [part.strip() for part in match.group(1).split(".") if part.strip()]
            if selector:
                found.append((selector, match.group(0)))
    elif isinstance(value, dict):
        for nested in value.values():
            found.extend(selector_references(nested))
    elif isinstance(value, list):
        for nested in value:
            found.extend(selector_references(nested))
    return found


def selector_roots(value: Any) -> list[tuple[str, str]]:
    found: list[tuple[str, str]] = []
    if isinstance(value, str):
        for match in VAR_REF_RE.finditer(value):
            found.append((match.group(1), match.group(0)))
    elif isinstance(value, dict):
        for nested in value.values():
            found.extend(selector_roots(nested))
    elif isinstance(value, list):
        for nested in value:
            found.extend(selector_roots(nested))
    return found


def known_node_output_variables(node: dict[str, Any]) -> set[str] | None:
    data_block = node.get("data") or {}
    if not isinstance(data_block, dict):
        return None

    typ = node_type(node)
    if typ == "start":
        variables = data_block.get("variables")
        if not isinstance(variables, list):
            return set()
        return {
            variable["variable"]
            for variable in variables
            if isinstance(variable, dict) and isinstance(variable.get("variable"), str) and variable["variable"]
        }
    if typ == "code":
        outputs = data_block.get("outputs")
        if not isinstance(outputs, dict):
            return set()
        return {name for name in outputs if isinstance(name, str) and name}
    if typ == "llm":
        return {"text"}
    if typ == "knowledge-retrieval":
        return {"result"}
    if typ == "iteration":
        return {"item", "index", "output"}
    if typ == "template-transform":
        return {"output"}
    return None


def validate_selector_output(
    report: ValidationReport,
    selector: list[Any],
    path: str,
    node_by_id: dict[str, dict[str, Any]],
) -> None:
    if len(selector) < 2:
        return
    root = selector[0]
    output_name = selector[1]
    if not isinstance(root, str) or not isinstance(output_name, str):
        return
    node = node_by_id.get(root)
    if not node:
        return
    known_outputs = known_node_output_variables(node)
    if known_outputs is None or output_name in known_outputs:
        return
    report.add(
        "error",
        "selector_output_missing",
        path,
        f"selector references `{root}.{output_name}`, but `{root}` only exposes {sorted(known_outputs)}",
    )


def validate_selector(
    report: ValidationReport,
    selector: Any,
    path: str,
    node_ids: set[str],
    node_by_id: dict[str, dict[str, Any]] | None = None,
) -> None:
    if not isinstance(selector, list) or len(selector) < 2:
        report.add("error", "selector_shape_invalid", path, "selector must be a list with at least two items")
        return
    root = selector[0]
    if not isinstance(root, str):
        report.add("error", "selector_root_invalid", path, "selector first item must be a string")
        return
    if root not in node_ids and root not in SYSTEM_SELECTOR_ROOTS:
        report.add("error", "selector_target_missing", path, f"selector references unknown root `{root}`")
        return
    if node_by_id is not None and root in node_ids:
        validate_selector_output(report, selector, path, node_by_id)


def validate_nested_selectors(
    report: ValidationReport,
    value: Any,
    path: str,
    node_ids: set[str],
    node_by_id: dict[str, dict[str, Any]] | None = None,
) -> None:
    if isinstance(value, dict):
        for key, item in value.items():
            item_path = f"{path}.{key}"
            if key in SELECTOR_KEYS:
                if item == []:
                    continue
                validate_selector(report, item, item_path, node_ids, node_by_id)
            else:
                validate_nested_selectors(report, item, item_path, node_ids, node_by_id)
    elif isinstance(value, list):
        for index, item in enumerate(value):
            validate_nested_selectors(report, item, f"{path}[{index}]", node_ids, node_by_id)


def validate_code_node(report: ValidationReport, data_block: dict[str, Any], path: str, node_ids: set[str]) -> None:
    code_language = data_block.get("code_language")
    if not isinstance(code_language, str) or not code_language.strip():
        report.add("error", "code_language_missing", f"{path}.data.code_language", "code node requires code_language")
    elif code_language not in {"python3", "javascript"}:
        report.add(
            "warning",
            "code_language_unknown",
            f"{path}.data.code_language",
            f"code_language `{code_language}` is not one of the common Dify code languages",
        )

    code = data_block.get("code")
    if not isinstance(code, str) or not code.strip():
        report.add("error", "code_missing", f"{path}.data.code", "code node requires non-empty code")

    variables = data_block.get("variables")
    if variables is not None and not isinstance(variables, list):
        report.add("error", "code_variables_not_list", f"{path}.data.variables", "code.variables must be a list")
        variables = []
    for variable_index, variable in enumerate(variables or []):
        variable_path = f"{path}.data.variables[{variable_index}]"
        if not isinstance(variable, dict):
            report.add("error", "code_variable_not_mapping", variable_path, "code variable must be a mapping")
            continue
        if not variable.get("variable"):
            report.add("error", "code_variable_name_missing", f"{variable_path}.variable", "code variable requires variable")
        if not variable.get("value_selector"):
            report.add("error", "code_variable_selector_missing", f"{variable_path}.value_selector", "code variable requires value_selector")

    outputs = data_block.get("outputs")
    if not isinstance(outputs, dict) or not outputs:
        report.add("error", "code_outputs_missing", f"{path}.data.outputs", "code.outputs must be a non-empty mapping")
        return
    for output_name, output in outputs.items():
        output_path = f"{path}.data.outputs.{output_name}"
        if not isinstance(output_name, str) or not output_name:
            report.add("error", "code_output_name_invalid", f"{path}.data.outputs", "code output names must be non-empty strings")
        if not isinstance(output, dict):
            report.add("error", "code_output_not_mapping", output_path, "code output definition must be a mapping")
            continue
        if not output.get("type"):
            report.add("error", "code_output_type_missing", f"{output_path}.type", "code output definition requires type")


def validate_knowledge_retrieval_node(report: ValidationReport, data_block: dict[str, Any], path: str) -> None:
    dataset_ids = data_block.get("dataset_ids")
    if not isinstance(dataset_ids, list):
        return
    for index, dataset_id in enumerate(dataset_ids):
        if isinstance(dataset_id, str) and dataset_id.strip() in PLACEHOLDER_DATASET_IDS:
            report.add(
                "warning",
                "knowledge_retrieval_dataset_placeholder",
                f"{path}.data.dataset_ids[{index}]",
                "knowledge-retrieval dataset id is a placeholder; replace it or run with "
                "--bootstrap-rag-dataset before live import/debug",
            )


def validate_yaml_text(yaml_text: str) -> ValidationReport:
    report = ValidationReport()
    try:
        data = yaml.safe_load(yaml_text)
    except yaml.YAMLError as exc:
        report.add("error", "yaml_parse_error", "$", str(exc))
        return report

    if not isinstance(data, dict):
        report.add("error", "top_level_not_mapping", "$", "top-level YAML must be a mapping")
        return report

    required = {"version", "kind", "app", "dependencies", "workflow"}
    missing = sorted(required - set(data.keys()))
    if missing:
        report.add("error", "top_level_missing_keys", "$", f"missing top-level keys: {missing}")

    version = data.get("version")
    if not isinstance(version, str):
        report.add("error", "version_not_string", "$.version", "Dify app DSL version must parse as a string")
    elif version != "0.6.0":
        report.add("warning", "version_not_current", "$.version", f"expected current app DSL version `0.6.0`, got `{version}`")

    if data.get("kind") != "app":
        report.add("error", "kind_not_app", "$.kind", "kind must be `app`")

    dependencies = data.get("dependencies")
    if not isinstance(dependencies, list):
        report.add("error", "dependencies_not_list", "$.dependencies", "dependencies must be a list, use [] if empty")
    dependency_identifiers_by_plugin, dependency_identifiers = validate_dependencies(report, dependencies)

    app = data.get("app")
    if not isinstance(app, dict):
        report.add("error", "app_not_mapping", "$.app", "app must be a mapping")
        return report

    mode = app.get("mode")
    if mode not in {"workflow", "advanced-chat"}:
        report.add("error", "unsupported_app_mode", "$.app.mode", "app.mode must be `workflow` or `advanced-chat`")

    workflow = data.get("workflow")
    if not isinstance(workflow, dict):
        report.add("error", "workflow_not_mapping", "$.workflow", "workflow must be a mapping")
        return report

    for key in ("environment_variables", "conversation_variables", "features"):
        if key not in workflow:
            report.add("warning", f"workflow_{key}_missing", f"$.workflow.{key}", f"workflow.{key} should be present")

    graph = workflow.get("graph")
    if not isinstance(graph, dict):
        report.add("error", "graph_not_mapping", "$.workflow.graph", "workflow.graph must be a mapping")
        return report

    nodes = graph.get("nodes")
    edges = graph.get("edges")
    if not isinstance(nodes, list) or not nodes:
        report.add("error", "nodes_missing", "$.workflow.graph.nodes", "graph.nodes must be a non-empty list")
        nodes = []
    if not isinstance(edges, list):
        report.add("error", "edges_missing", "$.workflow.graph.edges", "graph.edges must be a list")
        edges = []
    if "viewport" not in graph:
        report.add("warning", "viewport_missing", "$.workflow.graph.viewport", "graph.viewport should be present")

    node_ids: set[str] = set()
    node_types: dict[str, str] = {}
    node_by_id: dict[str, dict[str, Any]] = {}
    root_entries: list[str] = []
    duplicates: set[str] = set()

    for index, node in enumerate(nodes):
        if not isinstance(node, dict):
            report.add("error", "node_not_mapping", f"$.workflow.graph.nodes[{index}]", "node must be a mapping")
            continue
        node_id = node.get("id")
        if not isinstance(node_id, str) or not node_id:
            report.add("error", "node_id_invalid", f"$.workflow.graph.nodes[{index}].id", "node id must be a non-empty string")
            continue
        if node_id in node_ids:
            duplicates.add(node_id)
        node_ids.add(node_id)
        node_by_id[node_id] = node
        typ = node_type(node)
        node_types[node_id] = typ
        if not typ:
            report.add("error", "node_type_missing", f"$.workflow.graph.nodes[{index}].data.type", "node is missing data.type")
        if typ in {"start", *TRIGGER_NODE_TYPES} and "parentId" not in node:
            root_entries.append(typ)

    for duplicate in sorted(duplicates):
        report.add("error", "node_id_duplicate", "$.workflow.graph.nodes", f"duplicate node id `{duplicate}`")

    if not root_entries:
        report.add("error", "root_entry_missing", "$.workflow.graph.nodes", "workflow needs one root start/trigger node")
    if "start" in root_entries and any(entry in TRIGGER_NODE_TYPES for entry in root_entries):
        report.add("error", "start_trigger_mixed", "$.workflow.graph.nodes", "root start node and trigger nodes must not coexist")

    terminal_types = set(node_types.values())
    if mode == "workflow" and "end" not in terminal_types:
        report.add("error", "workflow_missing_end", "$.workflow.graph.nodes", "workflow mode must include an end node")
    if mode == "advanced-chat" and "answer" not in terminal_types:
        report.add("error", "chatflow_missing_answer", "$.workflow.graph.nodes", "advanced-chat mode must include an answer node")
    if mode == "workflow" and "answer" in terminal_types:
        report.add("warning", "workflow_has_answer", "$.workflow.graph.nodes", "workflow mode usually should not use answer nodes")
    if mode == "advanced-chat" and "end" in terminal_types:
        report.add("warning", "chatflow_has_end", "$.workflow.graph.nodes", "advanced-chat mode usually should not use end nodes")

    outgoing_handles: dict[str, set[str]] = {node_id: set() for node_id in node_ids}
    incoming: dict[str, set[str]] = {node_id: set() for node_id in node_ids}
    outgoing: dict[str, set[str]] = {node_id: set() for node_id in node_ids}
    for index, edge in enumerate(edges):
        if not isinstance(edge, dict):
            report.add("error", "edge_not_mapping", f"$.workflow.graph.edges[{index}]", "edge must be a mapping")
            continue
        edge_id = edge.get("id")
        source = edge.get("source")
        target = edge.get("target")
        if source not in node_ids:
            report.add("error", "edge_source_missing", f"$.workflow.graph.edges[{index}].source", f"missing source node `{source}`")
        if target not in node_ids:
            report.add("error", "edge_target_missing", f"$.workflow.graph.edges[{index}].target", f"missing target node `{target}`")
        if source in node_ids and target in node_ids:
            outgoing.setdefault(str(source), set()).add(str(target))
            incoming.setdefault(str(target), set()).add(str(source))
        if isinstance(source, str):
            outgoing_handles.setdefault(source, set()).add(str(edge.get("sourceHandle", "source")))
        edge_data = edge.get("data") or {}
        if not isinstance(edge_data, dict):
            report.add("error", "edge_data_invalid", f"$.workflow.graph.edges[{index}].data", "edge.data must be a mapping")
        else:
            for key in ("sourceType", "targetType"):
                if key not in edge_data:
                    report.add("warning", f"edge_{key}_missing", f"$.workflow.graph.edges[{index}].data.{key}", f"edge.data.{key} should be present")
            if source in node_types and edge_data.get("sourceType") and edge_data.get("sourceType") != node_types[source]:
                report.add(
                    "error",
                    "edge_source_type_mismatch",
                    f"$.workflow.graph.edges[{index}].data.sourceType",
                    f"edge sourceType `{edge_data.get('sourceType')}` does not match source node type `{node_types[source]}`",
                )
            if target in node_types and edge_data.get("targetType") and edge_data.get("targetType") != node_types[target]:
                report.add(
                    "error",
                    "edge_target_type_mismatch",
                    f"$.workflow.graph.edges[{index}].data.targetType",
                    f"edge targetType `{edge_data.get('targetType')}` does not match target node type `{node_types[target]}`",
                )
            for flag in ("isInIteration", "isInLoop"):
                if flag in edge_data and not isinstance(edge_data[flag], bool):
                    report.add("error", f"edge_{flag}_not_bool", f"$.workflow.graph.edges[{index}].data.{flag}", f"edge.data.{flag} must be boolean")
            if edge_data.get("isInIteration"):
                iteration_id = edge_data.get("iteration_id")
                if not iteration_id:
                    report.add("error", "edge_iteration_id_missing", f"$.workflow.graph.edges[{index}].data.iteration_id", "iteration edge requires iteration_id")
                elif node_types.get(str(iteration_id)) != "iteration":
                    report.add("error", "edge_iteration_id_invalid", f"$.workflow.graph.edges[{index}].data.iteration_id", "iteration_id must reference an iteration node")
            if edge_data.get("isInLoop"):
                loop_id = edge_data.get("loop_id")
                if not loop_id:
                    report.add("error", "edge_loop_id_missing", f"$.workflow.graph.edges[{index}].data.loop_id", "loop edge requires loop_id")
                elif node_types.get(str(loop_id)) != "loop":
                    report.add("error", "edge_loop_id_invalid", f"$.workflow.graph.edges[{index}].data.loop_id", "loop_id must reference a loop node")
        if isinstance(edge_id, str):
            expected = f"{source}-{edge.get('sourceHandle', 'source')}-{target}-{edge.get('targetHandle', 'target')}"
            if edge_id != expected:
                report.add("warning", "edge_id_noncanonical", f"$.workflow.graph.edges[{index}].id", f"edge id is usually `{expected}`")

    for node_id, typ in node_types.items():
        if typ in {"start", *TRIGGER_NODE_TYPES} and incoming.get(node_id):
            report.add("error", "entry_node_has_incoming", f"$.workflow.graph.nodes[id={node_id}]", f"entry node `{node_id}` must not have incoming edges")
        if typ == "end" and outgoing.get(node_id):
            report.add("error", "end_node_has_outgoing", f"$.workflow.graph.nodes[id={node_id}]", f"end node `{node_id}` must not have outgoing edges")

    for node in nodes:
        if not isinstance(node, dict):
            continue
        parent_id = node.get("id")
        data_block = node.get("data") or {}
        if not isinstance(parent_id, str) or not isinstance(data_block, dict):
            continue
        if node_type(node) in {"iteration", "loop"}:
            start_node_id = data_block.get("start_node_id")
            if isinstance(start_node_id, str) and start_node_id in node_ids:
                outgoing.setdefault(parent_id, set()).add(start_node_id)

    root_node_ids = [
        node_id
        for node_id, typ in node_types.items()
        if typ in {"start", *TRIGGER_NODE_TYPES}
        and not any(isinstance(node, dict) and node.get("id") == node_id and node.get("parentId") for node in nodes)
    ]
    reachable: set[str] = set()
    queue: deque[str] = deque(root_node_ids)
    while queue:
        current = queue.popleft()
        if current in reachable:
            continue
        reachable.add(current)
        queue.extend(sorted(outgoing.get(current, set()) - reachable))
    for node_id in sorted(node_ids - reachable):
        # Container start nodes are reachable only through their parent container, not always from root edges.
        if node_types.get(node_id) in {"iteration-start", "loop-start"}:
            continue
        report.add("warning", "node_unreachable", f"$.workflow.graph.nodes[id={node_id}]", f"node `{node_id}` is not reachable from a root entry node")
    if mode == "workflow" and not any(node_types.get(node_id) == "end" for node_id in reachable):
        report.add("error", "workflow_reachable_end_missing", "$.workflow.graph", "workflow mode needs a reachable end node")
    if mode == "advanced-chat" and not any(node_types.get(node_id) == "answer" for node_id in reachable):
        report.add("error", "chatflow_reachable_answer_missing", "$.workflow.graph", "advanced-chat mode needs a reachable answer node")

    for field in ("environment_variables", "conversation_variables"):
        variables = workflow.get(field)
        if not isinstance(variables, list):
            continue
        names = [item.get("name") for item in variables if isinstance(item, dict)]
        duplicates_by_name = [name for name, count in Counter(names).items() if name and count > 1]
        for name in duplicates_by_name:
            report.add("error", f"{field}_duplicate_name", f"$.workflow.{field}", f"duplicate variable name `{name}`")
        for index, variable in enumerate(variables):
            if not isinstance(variable, dict):
                report.add("error", f"{field}_item_not_mapping", f"$.workflow.{field}[{index}]", "variable item must be a mapping")
                continue
            if field == "conversation_variables" and variable.get("id"):
                try:
                    uuid.UUID(str(variable["id"]))
                except ValueError:
                    report.add("error", "conversation_variable_id_not_uuid", f"$.workflow.{field}[{index}].id", "conversation variable id must be a valid UUID")
            if not variable.get("name") or not variable.get("value_type"):
                report.add("error", f"{field}_missing_name_or_type", f"$.workflow.{field}[{index}]", "variable must include name and value_type")
            if "value" not in variable or variable.get("value") is None:
                report.add("error", f"{field}_value_missing", f"$.workflow.{field}[{index}].value", "variable must include a non-null value")

    for index, node in enumerate(nodes):
        if not isinstance(node, dict):
            continue
        node_id = node.get("id")
        data_block = node.get("data") or {}
        typ = node_type(node)
        path = f"$.workflow.graph.nodes[{index}]"

        for root, ref in selector_roots(node):
            if root not in node_ids and root not in SYSTEM_SELECTOR_ROOTS:
                report.add("error", "variable_ref_root_missing", path, f"variable reference `{ref}` points to unknown root `{root}`")
        for selector, ref in selector_references(node):
            if selector[0] in node_ids:
                validate_selector_output(report, selector, path, node_by_id)
        validate_nested_selectors(report, data_block, f"{path}.data", node_ids, node_by_id)

        if typ == "if-else":
            cases = data_block.get("cases")
            if not isinstance(cases, list) or not cases:
                report.add("error", "if_else_cases_missing", f"{path}.data.cases", "if-else requires non-empty cases")
            else:
                allowed = {"false"}
                for case_index, case in enumerate(cases):
                    if not isinstance(case, dict) or not case.get("case_id"):
                        report.add("error", "if_else_case_id_missing", f"{path}.data.cases[{case_index}]", "each case needs case_id")
                        continue
                    allowed.add(str(case["case_id"]))
                    for cond_index, condition in enumerate(case.get("conditions") or []):
                        selector = condition.get("variable_selector")
                        if selector is not None:
                            validate_selector(
                                report,
                                selector,
                                f"{path}.data.cases[{case_index}].conditions[{cond_index}].variable_selector",
                                node_ids,
                                node_by_id,
                            )
                for handle in sorted(outgoing_handles.get(str(node_id), set())):
                    if handle not in allowed:
                        report.add("error", "if_else_handle_unknown", f"$.workflow.graph.edges[source={node_id}]", f"edge sourceHandle `{handle}` does not match if-else cases")

        if typ == "start":
            variables = data_block.get("variables")
            if variables is not None and not isinstance(variables, list):
                report.add("error", "start_variables_not_list", f"{path}.data.variables", "start.variables must be a list")
                variables = []
            for variable_index, variable in enumerate(variables or []):
                variable_path = f"{path}.data.variables[{variable_index}]"
                if not isinstance(variable, dict):
                    report.add("error", "start_variable_not_mapping", variable_path, "start variable must be a mapping")
                    continue
                for required_key in ("variable", "label", "type"):
                    if not variable.get(required_key):
                        report.add(
                            "error",
                            "start_variable_required_field_missing",
                            f"{variable_path}.{required_key}",
                            f"start variable must include `{required_key}`",
                        )
                if variable.get("key") and not variable.get("variable"):
                    report.add(
                        "error",
                        "start_variable_uses_key_instead_of_variable",
                        f"{variable_path}.key",
                        "start variable uses `key`; Dify DSL expects `variable`",
                    )
                variable_type = variable.get("type")
                if isinstance(variable_type, str) and variable_type not in START_VARIABLE_TYPES:
                    report.add(
                        "error",
                        "start_variable_type_invalid",
                        f"{variable_path}.type",
                        f"start variable type `{variable_type}` is not a supported Dify input type",
                    )

        if typ == "end":
            outputs = data_block.get("outputs")
            if outputs is not None and not isinstance(outputs, list):
                report.add("error", "end_outputs_not_list", f"{path}.data.outputs", "end.outputs must be a list")
                outputs = []
            for output_index, output in enumerate(outputs or []):
                output_path = f"{path}.data.outputs[{output_index}]"
                if not isinstance(output, dict):
                    report.add("error", "end_output_not_mapping", output_path, "end output must be a mapping")
                    continue
                for required_key in ("variable", "value_selector"):
                    if not output.get(required_key):
                        report.add(
                            "error",
                            "end_output_required_field_missing",
                            f"{output_path}.{required_key}",
                            f"end output must include `{required_key}`",
                        )
                if output.get("key") and not output.get("variable"):
                    report.add(
                        "error",
                        "end_output_uses_key_instead_of_variable",
                        f"{output_path}.key",
                        "end output uses `key`; Dify DSL expects `variable`",
                    )
                if output.get("value") and not output.get("value_selector"):
                    report.add(
                        "error",
                        "end_output_uses_value_instead_of_selector",
                        f"{output_path}.value",
                        "end output uses `value`; Dify DSL expects `value_selector`",
                    )
                if "value_type" not in output:
                    report.add(
                        "warning",
                        "end_output_value_type_missing",
                        f"{output_path}.value_type",
                        "end output should include value_type in current DSL exports",
                    )
                if output.get("value_selector") is not None:
                    validate_selector(report, output.get("value_selector"), f"{output_path}.value_selector", node_ids, node_by_id)

        if typ == "question-classifier":
            classes = data_block.get("classes")
            if not isinstance(classes, list) or not classes:
                report.add("error", "classifier_classes_missing", f"{path}.data.classes", "question-classifier requires classes")
            else:
                allowed = {str(item.get("id")) for item in classes if isinstance(item, dict) and item.get("id")}
                for handle in sorted(outgoing_handles.get(str(node_id), set())):
                    if handle not in allowed:
                        report.add("error", "classifier_handle_unknown", f"$.workflow.graph.edges[source={node_id}]", f"edge sourceHandle `{handle}` does not match classifier class ids")

        if typ == "human-input":
            user_actions = data_block.get("user_actions")
            if not isinstance(user_actions, list) or not user_actions:
                report.add("error", "human_input_actions_missing", f"{path}.data.user_actions", "human-input requires non-empty user_actions")
            else:
                allowed = set()
                for action_index, action in enumerate(user_actions):
                    if not isinstance(action, dict) or not action.get("id"):
                        report.add("error", "human_input_action_id_missing", f"{path}.data.user_actions[{action_index}]", "each human-input action needs id")
                        continue
                    allowed.add(str(action["id"]))
                for handle in sorted(outgoing_handles.get(str(node_id), set())):
                    if handle not in allowed:
                        report.add("error", "human_input_handle_unknown", f"$.workflow.graph.edges[source={node_id}]", f"edge sourceHandle `{handle}` does not match human-input user_actions")

        if typ == "code":
            validate_code_node(report, data_block, path, node_ids)

        if typ == "knowledge-retrieval":
            validate_knowledge_retrieval_node(report, data_block, path)

        if typ in {"iteration", "loop"}:
            start_node_id = data_block.get("start_node_id")
            expected_start_type = "iteration-start" if typ == "iteration" else "loop-start"
            if not isinstance(start_node_id, str) or not start_node_id:
                report.add("error", f"{typ}_start_node_missing", f"{path}.data.start_node_id", f"{typ} requires start_node_id")
            elif node_types.get(start_node_id) != expected_start_type:
                report.add("error", f"{typ}_start_node_invalid", f"{path}.data.start_node_id", f"start_node_id must point to a {expected_start_type} node")
            elif node_by_id.get(start_node_id, {}).get("parentId") != node_id:
                report.add("error", f"{typ}_start_node_parent_mismatch", f"{path}.data.start_node_id", f"{expected_start_type} node `{start_node_id}` must have parentId `{node_id}`")

        if typ == "iteration":
            iterator_selector = data_block.get("iterator_selector")
            output_selector = data_block.get("output_selector")
            if iterator_selector is None:
                report.add("error", "iteration_iterator_selector_missing", f"{path}.data.iterator_selector", "iteration requires iterator_selector")
            else:
                validate_selector(report, iterator_selector, f"{path}.data.iterator_selector", node_ids, node_by_id)
            if output_selector is None:
                report.add("error", "iteration_output_selector_missing", f"{path}.data.output_selector", "iteration requires output_selector")
            else:
                validate_selector(report, output_selector, f"{path}.data.output_selector", node_ids, node_by_id)
            for key in ("iterator_input_type", "output_type"):
                if not isinstance(data_block.get(key), str) or not data_block.get(key):
                    report.add("error", f"iteration_{key}_missing", f"{path}.data.{key}", f"iteration requires {key}")

        if typ == "loop":
            loop_variables = data_block.get("loop_variables")
            break_conditions = data_block.get("break_conditions")
            if not isinstance(loop_variables, list):
                report.add("error", "loop_variables_not_list", f"{path}.data.loop_variables", "loop.loop_variables must be a list")
                loop_variables = []
            for variable_index, variable in enumerate(loop_variables):
                if not isinstance(variable, dict) or not variable.get("id"):
                    report.add("error", "loop_variable_id_missing", f"{path}.data.loop_variables[{variable_index}]", "each loop variable needs id")
            if not isinstance(break_conditions, list):
                report.add("error", "loop_break_conditions_not_list", f"{path}.data.break_conditions", "loop.break_conditions must be a list")
                break_conditions = []
            for condition_index, condition in enumerate(break_conditions):
                if not isinstance(condition, dict):
                    report.add("error", "loop_break_condition_not_mapping", f"{path}.data.break_conditions[{condition_index}]", "loop break condition must be a mapping")
                    continue
                selector = condition.get("variable_selector")
                if selector is not None:
                    validate_selector(report, selector, f"{path}.data.break_conditions[{condition_index}].variable_selector", node_ids, node_by_id)

        for provider_path, provider in model_provider_entries(data_block, typ, path):
            validate_model_provider_dependency(
                report,
                dependency_identifiers_by_plugin,
                provider=provider,
                path=provider_path,
                node_id=node_id,
                node_kind=typ,
            )
        if typ in {"llm", "question-classifier", "parameter-extractor"}:
            validate_model_block(report, data_block.get("model"), f"{path}.data.model", node_id, typ)

        if typ == "tool":
            for key in ("provider_id", "tool_name", "tool_parameters"):
                if key not in data_block:
                    report.add("error", f"tool_{key}_missing", f"{path}.data.{key}", f"tool node requires {key}")

            plugin_id, plugin_unique_identifier = plugin_identity_from_node(data_block)
            if not plugin_id:
                report.add(
                    "warning",
                    "tool_plugin_identity_missing",
                    f"{path}.data.plugin_unique_identifier",
                    "tool node should include plugin_unique_identifier or a provider_id that resolves to author/name",
                )
            elif plugin_id not in dependency_identifiers_by_plugin:
                validate_plugin_dependency_presence(
                    report,
                    dependency_identifiers_by_plugin,
                    plugin_id=plugin_id,
                    node_id=node_id,
                    node_kind="tool",
                    dependency_kind="plugin",
                )
            elif plugin_unique_identifier and plugin_unique_identifier not in dependency_identifiers:
                report.add(
                    "warning",
                    "plugin_dependency_identifier_mismatch",
                    "$.dependencies",
                    f"tool node `{node_id}` uses `{plugin_unique_identifier}` but dependencies include a different `{plugin_id}` identifier",
                )

        if typ == "trigger-plugin":
            for key in ("plugin_id", "provider_id", "event_name", "subscription_id", "plugin_unique_identifier", "event_parameters"):
                if key not in data_block:
                    report.add("error", f"trigger_plugin_{key}_missing", f"{path}.data.{key}", f"trigger-plugin node requires {key}")

            event_parameters = data_block.get("event_parameters")
            if event_parameters is not None and not isinstance(event_parameters, dict):
                report.add(
                    "error",
                    "trigger_plugin_event_parameters_not_mapping",
                    f"{path}.data.event_parameters",
                    "trigger-plugin event_parameters must be a mapping",
                )

            plugin_id, plugin_unique_identifier = plugin_identity_from_node(data_block)
            if not plugin_id:
                report.add(
                    "error",
                    "trigger_plugin_identity_missing",
                    f"{path}.data.plugin_unique_identifier",
                    "trigger-plugin node must include a resolvable plugin identity",
                )
            elif plugin_id not in dependency_identifiers_by_plugin:
                validate_plugin_dependency_presence(
                    report,
                    dependency_identifiers_by_plugin,
                    plugin_id=plugin_id,
                    node_id=node_id,
                    node_kind="trigger-plugin",
                    dependency_kind="plugin",
                )
            elif plugin_unique_identifier and plugin_unique_identifier not in dependency_identifiers:
                report.add(
                    "warning",
                    "plugin_dependency_identifier_mismatch",
                    "$.dependencies",
                    f"trigger-plugin node `{node_id}` uses `{plugin_unique_identifier}` but dependencies include a different `{plugin_id}` identifier",
                )

        if typ == "agent":
            for key in ("agent_strategy_provider_name", "agent_strategy_name", "agent_parameters"):
                if key not in data_block:
                    report.add("error", f"agent_{key}_missing", f"{path}.data.{key}", f"agent node requires {key}")
            plugin_id, plugin_unique_identifier = plugin_identity_from_node(data_block)
            if not plugin_id:
                plugin_id = plugin_id_from_provider_id(data_block.get("agent_strategy_provider_name"))
            if not plugin_id:
                report.add(
                    "error",
                    "agent_plugin_identity_missing",
                    f"{path}.data.plugin_unique_identifier",
                    "agent node should include plugin_unique_identifier or a strategy provider that resolves to author/name",
                )
            elif plugin_id not in dependency_identifiers_by_plugin:
                validate_plugin_dependency_presence(
                    report,
                    dependency_identifiers_by_plugin,
                    plugin_id=plugin_id,
                    node_id=node_id,
                    node_kind="agent",
                    dependency_kind="plugin",
                )
            elif plugin_unique_identifier and plugin_unique_identifier not in dependency_identifiers:
                report.add(
                    "warning",
                    "plugin_dependency_identifier_mismatch",
                    "$.dependencies",
                    f"agent node `{node_id}` uses `{plugin_unique_identifier}` but dependencies include a different `{plugin_id}` identifier",
                )

    return report


def validate_file(path: Path) -> ValidationReport:
    return validate_yaml_text(path.read_text())


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate generated Dify app DSL YAML.")
    parser.add_argument("yaml_file", type=Path)
    parser.add_argument("--json", action="store_true", help="Print JSON report.")
    args = parser.parse_args()

    report = validate_file(args.yaml_file)
    if args.json:
        print(json.dumps(report.to_dict(), ensure_ascii=False, indent=2))
    else:
        print("PASS" if report.valid else "FAIL")
        for issue in report.issues:
            print(f"[{issue.severity}] {issue.code} {issue.path}: {issue.message}")
    return 0 if report.valid else 1


if __name__ == "__main__":
    raise SystemExit(main())
