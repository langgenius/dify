#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path
from typing import Any

import yaml

from plugin_resolver import PluginResolver


DEFAULT_CASES = Path(__file__).resolve().parent / "demo_cases.yml"


def load_cases(path: Path) -> list[dict[str, Any]]:
    raw = yaml.safe_load(path.read_text())
    if not isinstance(raw, dict) or not isinstance(raw.get("cases"), list):
        raise ValueError(f"{path} must contain a top-level cases list")
    cases = [case for case in raw["cases"] if isinstance(case, dict)]
    if not cases:
        raise ValueError(f"{path} does not define any cases")
    return cases


def fail(case_id: str, message: str) -> None:
    raise AssertionError(f"{case_id}: {message}")


def official_by_id(result: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {str(item.get("plugin_id")): item for item in result.get("official_candidates") or [] if item.get("plugin_id")}


def extracted_by_ref(result: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {str(item.get("template_ref")): item for item in result.get("extracted_template_candidates") or [] if item.get("template_ref")}


def link_plugin_ids(result: dict[str, Any]) -> set[str]:
    return {str(item.get("official_plugin_id")) for item in result.get("official_template_links") or [] if item.get("official_plugin_id")}


def model_provider_plugin_ids(result: dict[str, Any]) -> set[str]:
    return {str(item.get("plugin_id")) for item in result.get("model_provider_candidates") or [] if item.get("plugin_id")}


def field_names(candidate: dict[str, Any]) -> set[str]:
    names: set[str] = set()
    for group in candidate.get("credential_requirements") or []:
        if not isinstance(group, dict):
            continue
        for field in group.get("fields") or []:
            if isinstance(field, dict) and field.get("name"):
                names.add(str(field["name"]))
    return names


def assert_official_plugin(case_id: str, plugin_id: str, candidate: dict[str, Any] | None) -> None:
    if not candidate:
        fail(case_id, f"missing official plugin {plugin_id}")
    if not str(candidate.get("package_identity") or "").startswith(f"{plugin_id}:"):
        fail(case_id, f"{plugin_id} missing package_identity")
    if not candidate.get("version"):
        fail(case_id, f"{plugin_id} missing version")


def assert_exact_dependency(case_id: str, plugin_id: str, candidate: dict[str, Any] | None) -> None:
    if not candidate:
        fail(case_id, f"missing official plugin {plugin_id}")
    evidence = candidate.get("exact_dependency_evidence")
    if not isinstance(evidence, list) or not evidence:
        fail(case_id, f"{plugin_id} missing exact_dependency_evidence")
    identifiers = [str(item.get("unique_identifier") or "") for item in evidence if isinstance(item, dict)]
    if not any(identifier.startswith(f"{plugin_id}:") and "@" in identifier for identifier in identifiers):
        fail(case_id, f"{plugin_id} exact dependency does not include a hashed unique identifier")


def command_preview(case: dict[str, Any]) -> dict[str, str]:
    case_id = str(case["id"])
    mode = str(case.get("mode") or "workflow")
    run_dir = f"dify/scripts/dsl_agent/outputs/{case_id}"
    request = " ".join(str(case.get("request") or "").split())
    inputs = json.dumps(case.get("inputs") or {}, ensure_ascii=False)
    return {
        "generate": f"python3 dify/scripts/dsl_agent/agent.py {json.dumps(request)} --run-id {case_id}",
        "evidence_only": f"python3 dify/scripts/dsl_agent/agent.py {json.dumps(request)} --plugin-evidence-only --run-id {case_id}_evidence",
        "debug_loop": (
            f"python3 dify/scripts/dsl_agent/debug_loop.py {run_dir} "
            f"--mode {mode} --inputs {json.dumps(inputs)} --install-missing-dependencies"
        ),
    }


def run_case(resolver: PluginResolver, case: dict[str, Any], limit: int) -> dict[str, Any]:
    case_id = str(case.get("id") or "")
    if not case_id:
        raise ValueError("demo case missing id")
    request = str(case.get("request") or "")
    expected = case.get("expected")
    if not request or not isinstance(expected, dict):
        fail(case_id, "missing request or expected contract")

    started = time.perf_counter()
    result = resolver.resolve(request, limit=limit)
    elapsed = time.perf_counter() - started

    official = official_by_id(result)
    extracted = extracted_by_ref(result)
    linked_plugins = link_plugin_ids(result)
    model_plugins = model_provider_plugin_ids(result)

    for plugin_id in expected.get("official_plugin_ids") or []:
        assert_official_plugin(case_id, str(plugin_id), official.get(str(plugin_id)))

    for plugin_id in expected.get("exact_dependency_plugin_ids") or []:
        assert_exact_dependency(case_id, str(plugin_id), official.get(str(plugin_id)))

    for template_ref in expected.get("extracted_template_refs") or []:
        if str(template_ref) not in extracted:
            fail(case_id, f"missing extracted template {template_ref}")

    for plugin_id in expected.get("official_template_plugins") or []:
        if str(plugin_id) not in linked_plugins:
            fail(case_id, f"missing official-template link for {plugin_id}")

    for template_plugin_id in expected.get("third_party_template_plugin_ids") or []:
        if not any(item.get("plugin_id") == template_plugin_id for item in extracted.values()):
            fail(case_id, f"missing third-party template plugin {template_plugin_id}")

    credential_fields = expected.get("credential_fields") or {}
    if isinstance(credential_fields, dict):
        for plugin_id, names in credential_fields.items():
            candidate = official.get(str(plugin_id))
            if not candidate:
                fail(case_id, f"missing official plugin {plugin_id} for credential checks")
            available = field_names(candidate)
            for name in names or []:
                if str(name) not in available:
                    fail(case_id, f"{plugin_id} missing credential/setup field {name}")

    return {
        "id": case_id,
        "title": case.get("title"),
        "mode": case.get("mode"),
        "elapsed_seconds": round(elapsed, 3),
        "official_plugins": sorted(official.keys()),
        "model_provider_plugins": sorted(model_plugins),
        "extracted_templates": sorted(extracted.keys()),
        "official_template_plugins": sorted(linked_plugins),
        "commands": command_preview(case),
    }


def run(args: argparse.Namespace) -> int:
    cases = load_cases(args.cases)
    resolver = PluginResolver()
    results = [run_case(resolver, case, args.limit) for case in cases]
    report = {"valid": True, "cases_file": str(args.cases), "cases": results}
    if args.output:
        args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(report, ensure_ascii=False, indent=2) if args.json else "PASS demo contract tests")
    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Validate official DSL Agent demo prompt contracts.")
    parser.add_argument("--cases", type=Path, default=DEFAULT_CASES)
    parser.add_argument("--limit", type=int, default=8)
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--output", type=Path)
    return parser.parse_args()


def main() -> int:
    try:
        return run(parse_args())
    except AssertionError as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        return 1
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
