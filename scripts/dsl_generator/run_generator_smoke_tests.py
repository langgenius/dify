#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
import tempfile
from pathlib import Path
from typing import Any

import yaml

from generate_dify_dsl import SpecValidationError, compile_spec


ROOT = Path(__file__).resolve().parent
EXAMPLES_DIR = ROOT / "examples"
DSL_AGENT_DIR = ROOT.parent / "dsl_agent"
if str(DSL_AGENT_DIR) not in sys.path:
    sys.path.append(str(DSL_AGENT_DIR))

from validator import validate_yaml_text  # noqa: E402


class SmokeTestFailure(ValueError):
    pass


def load_yaml(path: Path) -> dict[str, Any]:
    raw = yaml.safe_load(path.read_text())
    if not isinstance(raw, dict):
        raise SmokeTestFailure(f"Spec must be a mapping: {path}")
    return raw


def dependency_identity(dep: dict[str, Any]) -> str:
    value = dep.get("value") or {}
    return (
        value.get("marketplace_plugin_unique_identifier")
        or value.get("plugin_unique_identifier")
        or value.get("github_plugin_unique_identifier")
        or json.dumps(dep, sort_keys=True)
    )


def validate_compiled_workflow(compiled: dict[str, Any]) -> None:
    workflow = compiled.get("workflow") or {}
    graph = workflow.get("graph") or {}
    nodes = graph.get("nodes") or []
    edges = graph.get("edges") or []
    dependencies = compiled.get("dependencies") or []

    if not isinstance(nodes, list) or not nodes:
        raise SmokeTestFailure("Compiled workflow must contain non-empty graph.nodes.")
    if not isinstance(edges, list):
        raise SmokeTestFailure("Compiled workflow graph.edges must be a list.")
    if not isinstance(dependencies, list):
        raise SmokeTestFailure("Compiled dependencies must be a list.")

    seen_node_ids: set[str] = set()
    node_by_id: dict[str, dict[str, Any]] = {}
    root_trigger_count = 0

    for node in nodes:
        node_id = node.get("id")
        if not node_id or not isinstance(node_id, str):
            raise SmokeTestFailure("Every node must have a string id.")
        if node_id in seen_node_ids:
            raise SmokeTestFailure(f"Duplicate node id found: {node_id}")
        seen_node_ids.add(node_id)
        node_by_id[node_id] = node

        data = node.get("data") or {}
        node_type = data.get("type")
        if not node_type:
            raise SmokeTestFailure(f"Node `{node_id}` is missing data.type.")

        position = node.get("position") or {}
        if "x" not in position or "y" not in position:
            raise SmokeTestFailure(f"Node `{node_id}` is missing position.x/y.")

        if node_type in {"trigger-plugin", "trigger-schedule", "trigger-webhook", "start"} and "parentId" not in node:
            root_trigger_count += 1

        parent_id = node.get("parentId")
        if parent_id and parent_id not in seen_node_ids and parent_id not in node_by_id:
            # parent containers are emitted before children in current generator output.
            raise SmokeTestFailure(f"Node `{node_id}` references missing parentId `{parent_id}`.")

        if node_type in {"iteration", "loop"}:
            start_node_id = data.get("start_node_id")
            if not start_node_id:
                raise SmokeTestFailure(f"Container node `{node_id}` is missing start_node_id.")

    if root_trigger_count == 0:
        raise SmokeTestFailure("Compiled workflow should contain at least one root start/trigger node.")

    for node in nodes:
        node_id = node["id"]
        data = node.get("data") or {}
        node_type = data.get("type")

        if node_type in {"iteration", "loop"}:
            start_node_id = data["start_node_id"]
            start_node = node_by_id.get(start_node_id)
            if not start_node:
                raise SmokeTestFailure(f"Container `{node_id}` start node `{start_node_id}` not found.")
            if start_node.get("parentId") != node_id:
                raise SmokeTestFailure(f"Container start node `{start_node_id}` must have parentId `{node_id}`.")

    for edge in edges:
        source = edge.get("source")
        target = edge.get("target")
        if source not in node_by_id:
            raise SmokeTestFailure(f"Edge references missing source node `{source}`.")
        if target not in node_by_id:
            raise SmokeTestFailure(f"Edge references missing target node `{target}`.")

        data = edge.get("data") or {}
        if "sourceType" not in data or "targetType" not in data:
            raise SmokeTestFailure(f"Edge `{edge.get('id')}` is missing sourceType/targetType.")

    dep_identities = [dependency_identity(dep) for dep in dependencies]
    if len(dep_identities) != len(set(dep_identities)):
        raise SmokeTestFailure("Top-level dependencies should already be deduplicated.")


def render_and_validate(spec_path: Path) -> tuple[bool, str]:
    try:
        raw = load_yaml(spec_path)
        compiled = compile_spec(raw, template_base_dir=spec_path.parent)
        validate_compiled_workflow(compiled)

        with tempfile.NamedTemporaryFile("w+", suffix=".yml", delete=True) as tmp:
            yaml.safe_dump(compiled, tmp, sort_keys=False, allow_unicode=True)
            tmp.flush()
            tmp.seek(0)
            report = validate_yaml_text(tmp.read())
        errors = [issue for issue in report.issues if issue.severity == "error"]
        if errors:
            first = errors[0]
            raise SmokeTestFailure(f"{first.code} {first.path}: {first.message}")
        return True, "ok"
    except (SpecValidationError, SmokeTestFailure, FileNotFoundError, yaml.YAMLError) as exc:
        return False, str(exc)


def discover_specs(selected_specs: list[Path] | None) -> list[Path]:
    if selected_specs:
        return sorted(selected_specs)
    return sorted(EXAMPLES_DIR.glob("*.yml"))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run local smoke tests for generated Dify DSL examples.")
    parser.add_argument(
        "specs",
        nargs="*",
        type=Path,
        help="Optional specific example specs to test. Defaults to all files in examples/.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    specs = discover_specs(args.specs)
    if not specs:
        print("No specs found to test.")
        return 1

    failures = 0
    for spec in specs:
        ok, message = render_and_validate(spec)
        status = "PASS" if ok else "FAIL"
        print(f"[{status}] {spec.name}: {message}")
        if not ok:
            failures += 1

    print(f"\nSummary: {len(specs) - failures}/{len(specs)} passed")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
