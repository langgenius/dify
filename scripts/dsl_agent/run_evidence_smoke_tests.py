#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from plugin_resolver import PluginResolver


@dataclass
class EvidenceCase:
    name: str
    request: str
    required_official_plugin_ids: list[str]
    required_template_refs: list[str]
    required_link_plugins: list[str]
    forbidden_template_refs: list[str] | None = None
    expected_top_official_plugin_id: str | None = None


CASES = [
    EvidenceCase(
        name="typeform_gmail_followup",
        request="Typeform trigger Gmail send draft message",
        required_official_plugin_ids=["langgenius/typeform_trigger", "langgenius/dify-gmail"],
        required_template_refs=[
            "extracted/triggers/langgenius_typeform_trigger__form_response_received.yml",
            "extracted/tools/langgenius_dify_gmail__draft_message.yml",
        ],
        required_link_plugins=["langgenius/typeform_trigger", "langgenius/dify-gmail"],
        forbidden_template_refs=["extracted/tools/yaxuanm_qdrant__qdrant_upsert_text.yml"],
        expected_top_official_plugin_id="langgenius/typeform_trigger",
    ),
    EvidenceCase(
        name="gmail_oauth_setup",
        request="oauth client secret access token gmail",
        required_official_plugin_ids=["langgenius/dify-gmail"],
        required_template_refs=["extracted/tools/langgenius_dify_gmail__draft_message.yml"],
        required_link_plugins=["langgenius/dify-gmail"],
        expected_top_official_plugin_id="langgenius/dify-gmail",
    ),
    EvidenceCase(
        name="google_drive_trigger_template_priority",
        request="Google Drive file change trigger download file and upsert to Qdrant",
        required_official_plugin_ids=["langgenius/google_drive_trigger"],
        required_template_refs=[
            "extracted/triggers/langgenius_google_drive_trigger__drive_change_detected.yml",
            "extracted/tools/yaxuanm_qdrant__qdrant_upsert_text.yml",
        ],
        required_link_plugins=["langgenius/google_drive_trigger"],
        expected_top_official_plugin_id="langgenius/google_drive_trigger",
    ),
]


def fail(message: str) -> None:
    raise AssertionError(message)


def official_by_id(result: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {
        str(item.get("plugin_id")): item
        for item in result.get("official_candidates") or []
        if item.get("plugin_id")
    }


def template_refs(result: dict[str, Any]) -> set[str]:
    return {
        str(item.get("template_ref"))
        for item in result.get("extracted_template_candidates") or []
        if item.get("template_ref")
    }


def link_plugin_ids(result: dict[str, Any]) -> set[str]:
    return {
        str(item.get("official_plugin_id"))
        for item in result.get("official_template_links") or []
        if item.get("official_plugin_id")
    }


def model_provider_by_id(result: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {
        str(item.get("plugin_id")): item
        for item in result.get("model_provider_candidates") or []
        if item.get("plugin_id")
    }


def assert_candidate_identity(plugin_id: str, candidate: dict[str, Any]) -> None:
    if candidate.get("plugin_id") != plugin_id:
        fail(f"{plugin_id}: plugin_id missing")
    if not str(candidate.get("package_identity") or "").startswith(f"{plugin_id}:"):
        fail(f"{plugin_id}: package_identity missing or malformed")
    if not candidate.get("version"):
        fail(f"{plugin_id}: version missing")


def assert_exact_dependency(plugin_id: str, candidate: dict[str, Any]) -> None:
    evidence = candidate.get("exact_dependency_evidence")
    if not isinstance(evidence, list) or not evidence:
        fail(f"{plugin_id}: exact_dependency_evidence missing")
    first = evidence[0]
    if first.get("plugin_id") != plugin_id:
        fail(f"{plugin_id}: dependency evidence plugin_id mismatch")
    unique_identifier = str(first.get("unique_identifier") or "")
    if not unique_identifier.startswith(f"{plugin_id}:") or "@" not in unique_identifier:
        fail(f"{plugin_id}: dependency unique identifier missing hash")
    dependency = first.get("dependency")
    if not isinstance(dependency, dict):
        fail(f"{plugin_id}: dependency payload missing")


def assert_credentials_present(plugin_id: str, candidate: dict[str, Any]) -> None:
    groups = candidate.get("credential_requirements") or []
    if not groups:
        fail(f"{plugin_id}: credential_requirements missing")
    field_names = {
        str(field.get("name"))
        for group in groups
        for field in group.get("fields", [])
        if isinstance(group, dict) and isinstance(field, dict) and field.get("name")
    }
    if plugin_id == "langgenius/dify-gmail" and "client_id" not in field_names:
        fail("langgenius/dify-gmail: expected OAuth client_id credential field")
    if plugin_id == "langgenius/typeform_trigger" and "form_id" not in field_names:
        fail("langgenius/typeform_trigger: expected subscription form_id field")


def assert_model_provider_evidence(resolver: PluginResolver) -> dict[str, Any]:
    result = resolver.resolve("OpenAI LLM summarize a form response", limit=8)
    providers = model_provider_by_id(result)
    official_candidates = result.get("official_candidates") or []
    if not official_candidates or official_candidates[0].get("plugin_id") != "langgenius/openai":
        fail(f"OpenAI request should rank official langgenius/openai first, got {official_candidates[:3]}")
    openai = providers.get("langgenius/openai")
    if not openai:
        fail("model_provider_candidates: missing langgenius/openai")
    assert_candidate_identity("langgenius/openai", openai)
    if not openai.get("models"):
        fail("langgenius/openai: models summary missing")
    field_names = {
        str(field.get("name"))
        for group in openai.get("credential_requirements") or []
        for field in group.get("fields", [])
        if isinstance(group, dict) and isinstance(field, dict) and field.get("name")
    }
    if "openai_api_key" not in field_names:
        fail("langgenius/openai: expected openai_api_key credential field")
    return {
        "request": "OpenAI LLM summarize a form response",
        "top_official_plugin": official_candidates[0].get("plugin_id"),
        "model_providers": sorted(providers.keys()),
        "openai_package_identity": openai.get("package_identity"),
        "openai_credential_fields": sorted(field_names),
    }


def run_case(resolver: PluginResolver, case: EvidenceCase) -> dict[str, Any]:
    started = time.perf_counter()
    result = resolver.resolve(case.request, limit=8)
    elapsed = time.perf_counter() - started

    official = official_by_id(result)
    refs = template_refs(result)
    links = link_plugin_ids(result)

    for plugin_id in case.required_official_plugin_ids:
        if plugin_id not in official:
            fail(f"{case.name}: missing official plugin {plugin_id}")
        assert_candidate_identity(plugin_id, official[plugin_id])
        assert_exact_dependency(plugin_id, official[plugin_id])
        assert_credentials_present(plugin_id, official[plugin_id])

    for ref in case.required_template_refs:
        if ref not in refs:
            fail(f"{case.name}: missing extracted template {ref}")
    for ref in case.forbidden_template_refs or []:
        if ref in refs:
            fail(f"{case.name}: unrelated extracted template should not be included: {ref}")

    for plugin_id in case.required_link_plugins:
        if plugin_id not in links:
            fail(f"{case.name}: missing official-template link for {plugin_id}")

    official_candidates = result.get("official_candidates") or []
    if case.expected_top_official_plugin_id:
        top_plugin_id = official_candidates[0].get("plugin_id") if official_candidates else None
        if top_plugin_id != case.expected_top_official_plugin_id:
            fail(
                f"{case.name}: expected top official plugin {case.expected_top_official_plugin_id}, "
                f"got {top_plugin_id}"
            )

    return {
        "name": case.name,
        "request": case.request,
        "elapsed_seconds": round(elapsed, 3),
        "official_plugins": sorted(official.keys()),
        "template_refs": sorted(refs),
        "link_plugins": sorted(links),
    }


def run(args: argparse.Namespace) -> int:
    resolver = PluginResolver()
    results = [run_case(resolver, case) for case in CASES]
    report = {"valid": True, "cases": results, "model_provider_evidence": assert_model_provider_evidence(resolver)}
    if args.output:
        args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(report, ensure_ascii=False, indent=2) if args.json else "PASS evidence smoke tests")  # noqa: T201
    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run plugin evidence regression checks for DSL Agent demo scenarios.")
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--output", type=Path)
    return parser.parse_args()


def main() -> int:
    try:
        return run(parse_args())
    except AssertionError as exc:
        print(f"FAIL: {exc}", file=sys.stderr)  # noqa: T201
        return 1
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)  # noqa: T201
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
