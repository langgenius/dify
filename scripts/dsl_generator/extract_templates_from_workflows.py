#!/usr/bin/env python3
from __future__ import annotations

import argparse
import copy
import re
import shutil
from pathlib import Path
from typing import Any

import yaml


DEFAULT_OUTPUT_DIR = Path(__file__).resolve().parent / "templates" / "extracted"
DEFAULT_SUMMARY_PATH = DEFAULT_OUTPUT_DIR / "inventory.yml"
INCLUDED_TYPES = {"tool", "trigger-plugin"}


def slugify(value: str) -> str:
    value = value.strip().lower()
    value = re.sub(r"[^a-z0-9]+", "_", value)
    return value.strip("_") or "node"


def safe_load_yaml(path: Path) -> dict[str, Any] | None:
    raw = yaml.safe_load(path.read_text())
    if not isinstance(raw, dict):
        return None
    return raw


def unique_identifier_to_dependency(unique_identifier: str) -> dict[str, Any]:
    if "/" not in unique_identifier or ":" not in unique_identifier:
        raise ValueError(f"Unsupported plugin unique identifier: {unique_identifier}")
    dependency_type = "package"
    value_key = "plugin_unique_identifier"
    author_prefix = unique_identifier.split(":", 1)[0]
    if author_prefix.startswith("langgenius/"):
        dependency_type = "marketplace"
        value_key = "marketplace_plugin_unique_identifier"
    return {
        "current_identifier": None,
        "type": dependency_type,
        "value": {
            value_key: unique_identifier,
            "version": None,
        },
    }


def collect_dependency_index(dependencies: list[dict[str, Any]]) -> tuple[dict[str, dict[str, Any]], dict[str, dict[str, Any]]]:
    by_plugin_id: dict[str, dict[str, Any]] = {}
    by_provider_prefix: dict[str, dict[str, Any]] = {}
    for dep in dependencies:
        value = dep.get("value") or {}
        unique_identifier = value.get("plugin_unique_identifier") or value.get("marketplace_plugin_unique_identifier")
        if not unique_identifier:
            continue
        plugin_id = unique_identifier.split(":", 1)[0]
        by_plugin_id[plugin_id] = dep
        provider_prefix = f"{plugin_id}/"
        by_provider_prefix[provider_prefix] = dep
    return by_plugin_id, by_provider_prefix


def infer_node_dependencies(node_data: dict[str, Any], dependency_index: tuple[dict[str, dict[str, Any]], dict[str, dict[str, Any]]]) -> list[dict[str, Any]]:
    by_plugin_id, by_provider_prefix = dependency_index
    found: list[dict[str, Any]] = []

    plugin_unique_identifier = node_data.get("plugin_unique_identifier")
    exact_plugin_id: str | None = None
    if plugin_unique_identifier:
        exact_dependency = unique_identifier_to_dependency(plugin_unique_identifier)
        found.append(exact_dependency)
        exact_plugin_id = plugin_unique_identifier.split(":", 1)[0]

    plugin_id = node_data.get("plugin_id")
    if plugin_id and plugin_id != exact_plugin_id and plugin_id in by_plugin_id:
        found.append(copy.deepcopy(by_plugin_id[plugin_id]))

    provider_id = node_data.get("provider_id")
    if provider_id:
        for prefix, dep in by_provider_prefix.items():
            if provider_id.startswith(prefix) and dep.get("value", {}).get("plugin_unique_identifier", "").split(":", 1)[0] != exact_plugin_id and dep.get("value", {}).get("marketplace_plugin_unique_identifier", "").split(":", 1)[0] != exact_plugin_id:
                found.append(copy.deepcopy(dep))
                break

    def walk(value: Any) -> None:
        if isinstance(value, dict):
            provider = value.get("provider")
            if isinstance(provider, str) and ("model" in value or "model_type" in value):
                for prefix, dep in by_provider_prefix.items():
                    if provider.startswith(prefix):
                        found.append(copy.deepcopy(dep))
                        break
            for nested in value.values():
                walk(nested)
        elif isinstance(value, list):
            for item in value:
                walk(item)

    walk(node_data)

    deduped: list[dict[str, Any]] = []
    seen_plugin_ids: set[str] = set()
    for dep in found:
        value = dep.get("value") or {}
        unique_identifier = value.get("plugin_unique_identifier") or value.get("marketplace_plugin_unique_identifier")
        plugin_id = unique_identifier.split(":", 1)[0] if unique_identifier else yaml.safe_dump(dep, sort_keys=True, allow_unicode=True)
        if plugin_id in seen_plugin_ids:
            continue
        seen_plugin_ids.add(plugin_id)
        deduped.append(dep)
    return deduped


def category_for_type(node_type: str) -> str:
    if node_type == "tool":
        return "tools"
    if node_type == "trigger-plugin":
        return "triggers"
    if node_type == "agent":
        return "agents"
    if node_type == "if-else":
        return "logic"
    if node_type == "human-input":
        return "human"
    if node_type == "parameter-extractor":
        return "extractors"
    if node_type == "llm":
        return "models"
    if node_type.startswith("trigger-"):
        return "triggers"
    return "misc"


def template_name_for_node(node_data: dict[str, Any], workflow_stem: str, node_type: str) -> str:
    if node_type == "tool":
        plugin_id = node_data.get("plugin_id") or node_data.get("provider_id") or workflow_stem
        tool_name = node_data.get("tool_name") or node_data.get("title") or "tool"
        return f"{slugify(plugin_id)}__{slugify(tool_name)}"
    if node_type == "trigger-plugin":
        plugin_id = node_data.get("plugin_id") or node_data.get("provider_id") or workflow_stem
        event_name = node_data.get("event_name") or node_data.get("title") or "trigger"
        return f"{slugify(plugin_id)}__{slugify(event_name)}"
    title = node_data.get("title") or node_type
    return f"{slugify(workflow_stem)}__{slugify(title)}"


def build_template_doc(
    *,
    workflow_path: Path,
    node: dict[str, Any],
    dependencies: list[dict[str, Any]],
) -> dict[str, Any]:
    node_data = copy.deepcopy(node.get("data") or {})
    node_data.pop("selected", None)
    node_data.pop("provider_icon", None)
    node_data.pop("credential_id", None)

    if node_data.get("type") == "tool":
        for parameter in (node_data.get("tool_parameters") or {}).values():
            if isinstance(parameter, dict) and parameter.get("type") in {"mixed", "variable"}:
                parameter["value"] = ""
    if node_data.get("type") == "trigger-plugin":
        node_data["subscription_id"] = ""

    template_doc: dict[str, Any] = {
        "name": template_name_for_node(node_data, workflow_path.stem, node_data.get("type", "node")),
        "source_workflow": str(workflow_path),
        "source_node_id": node.get("id"),
        "node": {
            "width": node.get("width", 244),
            "height": node.get("height", 90),
            "data": node_data,
        },
    }
    if dependencies:
        template_doc["dependencies"] = dependencies
    return template_doc


def extract_from_workflow(path: Path, output_dir: Path, used_paths: set[Path]) -> list[dict[str, Any]]:
    raw = safe_load_yaml(path)
    if not raw:
        return []

    graph = ((raw.get("workflow") or {}).get("graph") or {})
    nodes = graph.get("nodes", [])
    dependencies = raw.get("dependencies", [])
    if not isinstance(nodes, list) or not isinstance(dependencies, list):
        return []

    dependency_index = collect_dependency_index(dependencies)
    inventory_items: list[dict[str, Any]] = []
    workflow_stem = slugify(path.stem)

    for node in nodes:
        node_data = node.get("data") or {}
        node_type = node_data.get("type", "")
        if node_type not in INCLUDED_TYPES:
            continue

        category = category_for_type(node_type)
        template_name = template_name_for_node(node_data, workflow_stem, node_type)
        template_doc = build_template_doc(
            workflow_path=path,
            node=node,
            dependencies=infer_node_dependencies(node_data, dependency_index),
        )
        rendered = yaml.safe_dump(template_doc, sort_keys=False, allow_unicode=True)
        target_path = output_dir / category / f"{template_name}.yml"
        target_path.parent.mkdir(parents=True, exist_ok=True)
        if target_path in used_paths or (target_path.exists() and target_path.read_text() != rendered):
            target_path = output_dir / category / f"{template_name}__{node.get('id')}.yml"
        target_path.write_text(rendered)
        used_paths.add(target_path)

        inventory_items.append(
            {
                "template": str(target_path),
                "type": node_type,
                "title": node_data.get("title", ""),
                "source_workflow": str(path),
                "source_node_id": node.get("id"),
                "dependencies_count": len(template_doc.get("dependencies", [])),
            }
        )

    return inventory_items


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Extract reusable node templates from exported Dify workflows.")
    parser.add_argument("workflow_dirs", nargs="+", type=Path, help="Directories that contain exported Dify workflow YAML files.")
    parser.add_argument("-o", "--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR, help="Template output directory.")
    parser.add_argument("--summary", type=Path, default=DEFAULT_SUMMARY_PATH, help="Inventory summary output path.")
    parser.add_argument("--no-clean", action="store_true", help="Do not clear the output directory before extraction.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    all_items: list[dict[str, Any]] = []
    used_paths: set[Path] = set()

    if not args.no_clean and args.output_dir.exists():
        shutil.rmtree(args.output_dir)

    for workflow_dir in args.workflow_dirs:
        for path in sorted(workflow_dir.glob("*.yml")):
            all_items.extend(extract_from_workflow(path, args.output_dir, used_paths))

    summary = {
        "source_dirs": [str(path) for path in args.workflow_dirs],
        "templates_count": len(all_items),
        "templates": all_items,
    }
    args.summary.parent.mkdir(parents=True, exist_ok=True)
    args.summary.write_text(yaml.safe_dump(summary, sort_keys=False, allow_unicode=True))
    print(f"Extracted {len(all_items)} templates to {args.output_dir}")
    print(f"Inventory written to {args.summary}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
