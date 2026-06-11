#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any

import yaml

from .validator import SYSTEM_SELECTOR_ROOTS, validate_yaml_text


MODEL_FALLBACKS = {
    "openai": "gpt-4o-mini",
    "langgenius/openai": "gpt-4o-mini",
    "langgenius/openai/openai": "gpt-4o-mini",
}
SUSPICIOUS_MODEL_NAME_RE = re.compile(r"(definitely|fake|invalid|not[-_ ]?a[-_ ]?real|placeholder|unknown)", re.IGNORECASE)


def write_json(path: Path, data: Any) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")


def node_type(node: dict[str, Any]) -> str:
    data = node.get("data") if isinstance(node.get("data"), dict) else {}
    return str(data.get("type") or node.get("type") or "")


def graph_nodes(data: dict[str, Any]) -> list[dict[str, Any]]:
    workflow = data.get("workflow") if isinstance(data.get("workflow"), dict) else {}
    graph = workflow.get("graph") if isinstance(workflow.get("graph"), dict) else {}
    nodes = graph.get("nodes")
    return [node for node in nodes if isinstance(node, dict)] if isinstance(nodes, list) else []


def graph_edges(data: dict[str, Any]) -> list[dict[str, Any]]:
    workflow = data.get("workflow") if isinstance(data.get("workflow"), dict) else {}
    graph = workflow.get("graph") if isinstance(workflow.get("graph"), dict) else {}
    edges = graph.get("edges")
    return [edge for edge in edges if isinstance(edge, dict)] if isinstance(edges, list) else []


def normalized_token(value: Any) -> str:
    return re.sub(r"[^a-z0-9]+", "", str(value or "").lower())


def first_start_selector(nodes: list[dict[str, Any]]) -> list[str] | None:
    for node in nodes:
        if node_type(node) != "start":
            continue
        node_id = node.get("id")
        data = node.get("data") if isinstance(node.get("data"), dict) else {}
        variables = data.get("variables")
        if not isinstance(node_id, str) or not isinstance(variables, list):
            continue
        for variable in variables:
            if isinstance(variable, dict) and isinstance(variable.get("variable"), str):
                return [node_id, variable["variable"]]
    return None


def failed_nodes(runtime_evidence: dict[str, Any]) -> list[dict[str, Any]]:
    candidates: list[Any] = []
    draft = runtime_evidence.get("draft_run")
    if isinstance(draft, dict):
        nested = draft.get("draft_run")
        if isinstance(nested, dict):
            candidates.append(nested.get("summary"))
        candidates.append(draft.get("summary"))
    candidates.append(runtime_evidence.get("summary"))

    failed: list[dict[str, Any]] = []
    for candidate in candidates:
        if not isinstance(candidate, dict):
            continue
        items = candidate.get("failed_nodes")
        if isinstance(items, list):
            failed.extend(item for item in items if isinstance(item, dict))
    return failed


def runtime_text(runtime_evidence: Any) -> str:
    try:
        return json.dumps(runtime_evidence, ensure_ascii=False)
    except TypeError:
        return str(runtime_evidence)


def repair_unknown_selectors(data: dict[str, Any], fixes: list[dict[str, Any]]) -> None:
    nodes = graph_nodes(data)
    node_ids = {node.get("id") for node in nodes if isinstance(node.get("id"), str)}
    replacement = first_start_selector(nodes)
    if not replacement:
        return

    def walk(value: Any, path: str) -> None:
        if isinstance(value, dict):
            for key, item in value.items():
                item_path = f"{path}.{key}"
                if key in {"value_selector", "variable_selector"} and isinstance(item, list) and len(item) >= 2:
                    root = item[0]
                    if isinstance(root, str) and root not in node_ids and root not in SYSTEM_SELECTOR_ROOTS:
                        old = list(item)
                        item[:2] = replacement
                        fixes.append(
                            {
                                "type": "selector_target_missing",
                                "path": item_path,
                                "old": old,
                                "new": list(item),
                            }
                        )
                else:
                    walk(item, item_path)
        elif isinstance(value, list):
            for index, item in enumerate(value):
                walk(item, f"{path}[{index}]")

    walk(data, "$")


def repair_failed_code_nodes(data: dict[str, Any], runtime_evidence: dict[str, Any], fixes: list[dict[str, Any]]) -> None:
    failed_code_ids = {
        item.get("node_id")
        for item in failed_nodes(runtime_evidence)
        if item.get("node_type") == "code" and isinstance(item.get("node_id"), str)
    }
    if not failed_code_ids:
        return

    for node in graph_nodes(data):
        if node.get("id") not in failed_code_ids or node_type(node) != "code":
            continue
        node_data = node.get("data") if isinstance(node.get("data"), dict) else {}
        variables = node_data.get("variables") if isinstance(node_data.get("variables"), list) else []
        input_name = "text"
        for variable in variables:
            if isinstance(variable, dict) and isinstance(variable.get("variable"), str):
                input_name = variable["variable"]
                break
        language = node_data.get("code_language")
        old_code = node_data.get("code")
        if language == "javascript":
            node_data["code"] = f"function main({{{input_name}}}) {{\n  return {{ result: {input_name} }}\n}}\n"
        else:
            node_data["code_language"] = "python3"
            node_data["code"] = f"def main({input_name}: str):\n    return {{\"result\": {input_name}}}\n"
        outputs = node_data.get("outputs")
        if not isinstance(outputs, dict):
            outputs = {}
            node_data["outputs"] = outputs
        outputs["result"] = {"type": "string", "children": None}
        fixes.append(
            {
                "type": "runtime_code_node_failed",
                "node_id": node.get("id"),
                "old_code": old_code,
                "new_output": "result",
            }
        )


def repair_failed_llm_models(data: dict[str, Any], runtime_evidence: dict[str, Any], fixes: list[dict[str, Any]]) -> None:
    text = runtime_text(runtime_evidence).lower()
    if "model" not in text and "not found" not in text and "does not exist" not in text:
        return
    failed_llm_ids = {
        item.get("node_id")
        for item in failed_nodes(runtime_evidence)
        if item.get("node_type") == "llm" and isinstance(item.get("node_id"), str)
    }
    if not failed_llm_ids:
        return

    for node in graph_nodes(data):
        if node.get("id") not in failed_llm_ids or node_type(node) != "llm":
            continue
        node_data = node.get("data") if isinstance(node.get("data"), dict) else {}
        model = node_data.get("model") if isinstance(node_data.get("model"), dict) else {}
        provider = model.get("provider")
        fallback = MODEL_FALLBACKS.get(str(provider))
        if not fallback or model.get("name") == fallback:
            continue
        old_model = model.get("name")
        model["name"] = fallback
        fixes.append(
            {
                "type": "runtime_llm_model_fallback",
                "node_id": node.get("id"),
                "provider": provider,
                "old_model": old_model,
                "new_model": fallback,
            }
        )


def repair_suspicious_llm_models(data: dict[str, Any], fixes: list[dict[str, Any]]) -> None:
    for node in graph_nodes(data):
        if node_type(node) not in {"llm", "question-classifier", "parameter-extractor"}:
            continue
        node_data = node.get("data") if isinstance(node.get("data"), dict) else {}
        model = node_data.get("model") if isinstance(node_data.get("model"), dict) else {}
        provider = str(model.get("provider") or "")
        fallback = MODEL_FALLBACKS.get(provider)
        name = model.get("name")
        if not fallback or not isinstance(name, str) or not SUSPICIOUS_MODEL_NAME_RE.search(name):
            continue
        model["name"] = fallback
        fixes.append(
            {
                "type": "model_name_suspicious_fallback",
                "node_id": node.get("id"),
                "provider": provider,
                "old_model": name,
                "new_model": fallback,
            }
        )


def repair_unknown_human_input_handles(data: dict[str, Any], fixes: list[dict[str, Any]]) -> None:
    actions_by_node: dict[str, dict[str, str]] = {}
    single_action_by_node: dict[str, str] = {}
    for node in graph_nodes(data):
        node_id = node.get("id")
        if not isinstance(node_id, str) or node_type(node) != "human-input":
            continue
        node_data = node.get("data") if isinstance(node.get("data"), dict) else {}
        user_actions = node_data.get("user_actions")
        if not isinstance(user_actions, list):
            continue
        allowed_ids: list[str] = []
        aliases: dict[str, str] = {}
        for action in user_actions:
            if not isinstance(action, dict) or not action.get("id"):
                continue
            action_id = str(action["id"])
            allowed_ids.append(action_id)
            aliases[normalized_token(action_id)] = action_id
            if action.get("title"):
                aliases[normalized_token(action["title"])] = action_id
        if aliases:
            actions_by_node[node_id] = aliases
        if len(allowed_ids) == 1:
            single_action_by_node[node_id] = allowed_ids[0]

    if not actions_by_node:
        return

    for edge in graph_edges(data):
        source = edge.get("source")
        if not isinstance(source, str) or source not in actions_by_node:
            continue
        old_handle = str(edge.get("sourceHandle", "source"))
        replacement = actions_by_node[source].get(normalized_token(old_handle))
        if not replacement and source in single_action_by_node:
            replacement = single_action_by_node[source]
        if not replacement or replacement == old_handle:
            continue

        edge["sourceHandle"] = replacement
        target = edge.get("target")
        target_handle = edge.get("targetHandle", "target")
        if isinstance(target, str):
            edge["id"] = f"{source}-{replacement}-{target}-{target_handle}"
        fixes.append(
            {
                "type": "human_input_handle_unknown",
                "edge_id": edge.get("id"),
                "source": source,
                "old_handle": old_handle,
                "new_handle": replacement,
            }
        )


def repair_yaml_text(
    yaml_text: str,
    *,
    validation: dict[str, Any] | None = None,
    runtime_evidence: dict[str, Any] | None = None,
) -> tuple[str, dict[str, Any]]:
    data = yaml.safe_load(yaml_text)
    if not isinstance(data, dict):
        return yaml_text, {
            "changed": False,
            "fixes": [],
            "errors": [{"message": "top-level YAML is not a mapping"}],
        }

    fixes: list[dict[str, Any]] = []
    errors: list[dict[str, Any]] = []
    repair_unknown_selectors(data, fixes)
    repair_suspicious_llm_models(data, fixes)
    repair_unknown_human_input_handles(data, fixes)
    if runtime_evidence:
        repair_failed_code_nodes(data, runtime_evidence, fixes)
        repair_failed_llm_models(data, runtime_evidence, fixes)

    repaired = yaml.safe_dump(data, allow_unicode=True, sort_keys=False)
    final_validation = validate_yaml_text(repaired).to_dict()
    report = {
        "changed": bool(fixes),
        "fixes": fixes,
        "errors": errors,
        "input_validation": validation or validate_yaml_text(yaml_text).to_dict(),
        "final_validation": final_validation,
    }
    return repaired, report


def run(args: argparse.Namespace) -> int:
    runtime_evidence = {}
    if args.runtime_evidence and args.runtime_evidence.exists():
        runtime_evidence = json.loads(args.runtime_evidence.read_text())
    yaml_text = args.yaml_file.read_text()
    validation = validate_yaml_text(yaml_text).to_dict()
    repaired, report = repair_yaml_text(yaml_text, validation=validation, runtime_evidence=runtime_evidence)
    args.output.write_text(repaired)
    if args.report_output:
        write_json(args.report_output, report)
    print("CHANGED" if report["changed"] else "UNCHANGED")
    return 0 if report["final_validation"].get("valid") else 1


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Apply deterministic Dify DSL repairs for known validation/runtime failures.")
    parser.add_argument("yaml_file", type=Path)
    parser.add_argument("--runtime-evidence", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--report-output", type=Path)
    return parser.parse_args()


if __name__ == "__main__":
    raise SystemExit(run(parse_args()))
