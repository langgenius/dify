#!/usr/bin/env python3
from __future__ import annotations

import argparse
import copy
import json
from pathlib import Path
from typing import Any

import yaml

from .validator import (
    dependency_unique_identifier,
    model_provider_entries,
    node_type,
    plugin_id_from_model_provider,
    plugin_id_from_unique_identifier,
    plugin_identity_from_node,
)


def dependency_from_identifier(identifier: str, dep_type: str = "marketplace") -> dict[str, Any]:
    key_by_type = {
        "github": "github_plugin_unique_identifier",
        "marketplace": "marketplace_plugin_unique_identifier",
        "package": "plugin_unique_identifier",
    }
    dep_type = dep_type if dep_type in key_by_type else "marketplace"
    return {
        "current_identifier": None,
        "type": dep_type,
        "value": {key_by_type[dep_type]: identifier},
    }


def dependency_plugin_id(dependency: Any) -> str:
    return plugin_id_from_unique_identifier(dependency_unique_identifier(dependency))


def dependency_type_from_candidate(candidate: dict[str, Any]) -> str:
    source = str(candidate.get("source") or "")
    if source == "official":
        return "marketplace"
    return "package"


def iter_candidate_dicts(plugin_evidence: dict[str, Any]) -> list[dict[str, Any]]:
    candidates: list[dict[str, Any]] = []
    for key in ("official_candidates", "model_provider_candidates"):
        value = plugin_evidence.get(key)
        if isinstance(value, list):
            candidates.extend(item for item in value if isinstance(item, dict))
    return candidates


def collect_dependency_evidence(plugin_evidence: dict[str, Any]) -> dict[str, Any]:
    exact_by_plugin: dict[str, list[dict[str, Any]]] = {}
    package_by_plugin: dict[str, dict[str, str]] = {}

    def add_exact(dependency: Any) -> None:
        if not isinstance(dependency, dict):
            return
        plugin_id = dependency_plugin_id(dependency)
        if not plugin_id:
            return
        exact_by_plugin.setdefault(plugin_id, [])
        identifier = dependency_unique_identifier(dependency)
        if all(dependency_unique_identifier(item) != identifier for item in exact_by_plugin[plugin_id]):
            exact_by_plugin[plugin_id].append(copy.deepcopy(dependency))

    for candidate in iter_candidate_dicts(plugin_evidence):
        plugin_id = str(candidate.get("plugin_id") or "").strip()
        package_identity = str(candidate.get("package_identity") or "").strip()
        if plugin_id and package_identity:
            package_by_plugin.setdefault(
                plugin_id,
                {
                    "identifier": package_identity,
                    "type": dependency_type_from_candidate(candidate),
                },
            )
        exact_entries = candidate.get("exact_dependency_evidence")
        if isinstance(exact_entries, list):
            for entry in exact_entries:
                if isinstance(entry, dict):
                    add_exact(entry.get("dependency"))

    for key in ("extracted_template_candidates", "official_template_links"):
        value = plugin_evidence.get(key)
        if not isinstance(value, list):
            continue
        for item in value:
            if not isinstance(item, dict):
                continue
            dependencies = item.get("dependencies")
            if isinstance(dependencies, list):
                for dependency in dependencies:
                    add_exact(dependency)

    return {
        "exact_by_plugin": exact_by_plugin,
        "package_by_plugin": package_by_plugin,
    }


def existing_dependency_plugin_ids(dependencies: list[Any]) -> set[str]:
    return {plugin_id for plugin_id in (dependency_plugin_id(item) for item in dependencies) if plugin_id}


def best_dependency_for_plugin(
    plugin_id: str,
    *,
    preferred_unique_identifier: str = "",
    evidence: dict[str, Any],
) -> tuple[dict[str, Any] | None, str]:
    exact_by_plugin: dict[str, list[dict[str, Any]]] = evidence["exact_by_plugin"]
    package_by_plugin: dict[str, dict[str, str]] = evidence["package_by_plugin"]

    if preferred_unique_identifier:
        for dependency in exact_by_plugin.get(plugin_id, []):
            if dependency_unique_identifier(dependency) == preferred_unique_identifier:
                return copy.deepcopy(dependency), "exact_dependency_evidence"

    exact = exact_by_plugin.get(plugin_id) or []
    if exact:
        return copy.deepcopy(exact[0]), "exact_dependency_evidence"

    package = package_by_plugin.get(plugin_id)
    if package and package.get("identifier"):
        return dependency_from_identifier(str(package["identifier"]), str(package.get("type") or "marketplace")), "package_identity"

    return None, ""


def add_dependency_if_missing(
    dependencies: list[Any],
    present_plugin_ids: set[str],
    *,
    plugin_id: str,
    reason: str,
    node_id: Any,
    preferred_unique_identifier: str = "",
    evidence: dict[str, Any],
    report: dict[str, Any],
) -> None:
    if not plugin_id:
        return
    if plugin_id in present_plugin_ids:
        report["already_present"].append({"plugin_id": plugin_id, "reason": reason, "node_id": node_id})
        return

    dependency, source = best_dependency_for_plugin(
        plugin_id,
        preferred_unique_identifier=preferred_unique_identifier,
        evidence=evidence,
    )
    if dependency is None:
        report["skipped"].append(
            {
                "plugin_id": plugin_id,
                "reason": "no_dependency_evidence",
                "node_id": node_id,
                "dependency_reason": reason,
            }
        )
        return

    dependencies.append(dependency)
    present_plugin_ids.add(plugin_id)
    report["added"].append(
        {
            "plugin_id": plugin_id,
            "reason": reason,
            "node_id": node_id,
            "source": source,
            "unique_identifier": dependency_unique_identifier(dependency),
        }
    )


def normalize_dependency_dict(data: dict[str, Any], plugin_evidence: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    report: dict[str, Any] = {
        "changed": False,
        "added": [],
        "already_present": [],
        "skipped": [],
        "errors": [],
    }
    dependencies = data.get("dependencies")
    if dependencies is None:
        dependencies = []
        data["dependencies"] = dependencies
    if not isinstance(dependencies, list):
        report["errors"].append({"code": "dependencies_not_list", "message": "dependencies must be a list"})
        return data, report

    evidence = collect_dependency_evidence(plugin_evidence)
    present_plugin_ids = existing_dependency_plugin_ids(dependencies)
    workflow = data.get("workflow") if isinstance(data.get("workflow"), dict) else {}
    graph = workflow.get("graph") if isinstance(workflow.get("graph"), dict) else {}
    nodes = graph.get("nodes") if isinstance(graph.get("nodes"), list) else []

    for node in nodes:
        if not isinstance(node, dict):
            continue
        node_id = node.get("id")
        data_block = node.get("data") if isinstance(node.get("data"), dict) else {}
        typ = node_type(node)
        if typ in {"tool", "trigger-plugin"}:
            plugin_id, plugin_unique_identifier = plugin_identity_from_node(data_block)
            add_dependency_if_missing(
                dependencies,
                present_plugin_ids,
                plugin_id=plugin_id,
                reason=f"{typ}_node",
                node_id=node_id,
                preferred_unique_identifier=plugin_unique_identifier,
                evidence=evidence,
                report=report,
            )

        for _provider_path, provider in model_provider_entries(data_block, typ, "$.workflow.graph.nodes[]"):
            plugin_id = plugin_id_from_model_provider(provider)
            add_dependency_if_missing(
                dependencies,
                present_plugin_ids,
                plugin_id=plugin_id,
                reason="model_provider",
                node_id=node_id,
                evidence=evidence,
                report=report,
            )

    report["changed"] = bool(report["added"])
    return data, report


def normalize_yaml_text(yaml_text: str, plugin_evidence: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    try:
        data = yaml.safe_load(yaml_text)
    except yaml.YAMLError as exc:
        return yaml_text, {
            "changed": False,
            "added": [],
            "already_present": [],
            "skipped": [],
            "errors": [{"code": "yaml_parse_failed", "message": str(exc)}],
        }

    if not isinstance(data, dict):
        return yaml_text, {
            "changed": False,
            "added": [],
            "already_present": [],
            "skipped": [],
            "errors": [{"code": "yaml_not_mapping", "message": "YAML document must be a mapping"}],
        }

    normalized, report = normalize_dependency_dict(data, plugin_evidence)
    if not report["changed"]:
        return yaml_text, report
    return yaml.safe_dump(normalized, sort_keys=False, allow_unicode=True), report


def main() -> int:
    parser = argparse.ArgumentParser(description="Normalize Dify DSL dependencies from plugin evidence.")
    parser.add_argument("yaml_file", type=Path)
    parser.add_argument("--plugin-evidence", type=Path, required=True)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--report-output", type=Path)
    args = parser.parse_args()

    plugin_evidence = json.loads(args.plugin_evidence.read_text())
    normalized, report = normalize_yaml_text(args.yaml_file.read_text(), plugin_evidence)
    output = args.output or args.yaml_file
    output.write_text(normalized)
    if args.report_output:
        args.report_output.write_text(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if not report.get("errors") else 1


if __name__ == "__main__":
    raise SystemExit(main())
