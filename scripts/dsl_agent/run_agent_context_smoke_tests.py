#!/usr/bin/env python3
from __future__ import annotations

import json

from agent import compact_plugin_evidence_for_prompt, plan_needs_plugin_evidence


def native_plan() -> dict[str, object]:
    return {
        "requirements": {"needs_plugins": [], "needs_triggers": []},
        "graph_plan": {
            "nodes": [
                {"id": "start", "type": "start"},
                {"id": "end", "type": "end"},
            ]
        },
    }


def tool_plan() -> dict[str, object]:
    return {
        "requirements": {"needs_plugins": ["gmail"], "needs_triggers": []},
        "graph_plan": {
            "nodes": [
                {"id": "start", "type": "start"},
                {"id": "tool", "type": "tool"},
                {"id": "end", "type": "end"},
            ]
        },
    }


def fake_evidence() -> dict[str, object]:
    long_text = "x" * 4000
    return {
        "resolution_policy": ["prefer official"],
        "official_candidates": [
            {
                "source": "official",
                "kind": "tool",
                "name": "gmail",
                "plugin_id": "langgenius/dify-gmail",
                "description": long_text,
                "tools": [{"name": "send_message", "description": long_text}],
                "docs": [{"path": "README.md", "summary": long_text, "body": long_text}],
                "extra_large_field": long_text,
            }
        ],
        "model_provider_candidates": [],
        "extracted_template_candidates": [{"template_ref": "tools/gmail.yml", "raw": long_text}],
        "official_template_links": [{"official_plugin_id": "langgenius/dify-gmail", "template_ref": "tools/gmail.yml"}],
    }


def assert_native_plan_prunes_plugins() -> dict[str, object]:
    plan = native_plan()
    evidence = compact_plugin_evidence_for_prompt(fake_evidence(), plan)
    if plan_needs_plugin_evidence(plan):
        raise AssertionError("native plan should not need plugin evidence")
    for key in ("official_candidates", "model_provider_candidates", "extracted_template_candidates", "official_template_links"):
        if evidence.get(key):
            raise AssertionError(f"{key} should be empty for native plan: {evidence}")
    if "pruned_reason" not in evidence:
        raise AssertionError(f"missing pruned_reason: {evidence}")
    return {"name": "native_plan_prunes_plugins", "valid": True}


def assert_tool_plan_compacts_plugins() -> dict[str, object]:
    plan = tool_plan()
    evidence = compact_plugin_evidence_for_prompt(fake_evidence(), plan)
    if not plan_needs_plugin_evidence(plan):
        raise AssertionError("tool plan should need plugin evidence")
    candidates = evidence.get("official_candidates")
    if not isinstance(candidates, list) or not candidates:
        raise AssertionError(f"expected compact official candidate: {evidence}")
    serialized = json.dumps(evidence, ensure_ascii=False)
    if "extra_large_field" in serialized:
        raise AssertionError("compact evidence should drop unknown large fields")
    if "x" * 2000 in serialized:
        raise AssertionError("compact evidence should truncate long strings")
    if "langgenius/dify-gmail" not in serialized:
        raise AssertionError(f"compact evidence lost plugin identity: {evidence}")
    return {"name": "tool_plan_compacts_plugins", "valid": True, "bytes": len(serialized)}


def main() -> int:
    cases = [assert_native_plan_prunes_plugins(), assert_tool_plan_compacts_plugins()]
    print(json.dumps({"valid": True, "cases": cases}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
