#!/usr/bin/env python3
from __future__ import annotations

import json
from pathlib import Path

import yaml

from deterministic_repair import repair_yaml_text
from run_validator_smoke_tests import human_input_workflow_doc
from validator import validate_yaml_text


ROOT = Path(__file__).resolve().parent


def assert_selector_repair() -> dict[str, object]:
    yaml_text = (ROOT / "batch_cases" / "broken_selector_repair.yml").read_text()
    validation = validate_yaml_text(yaml_text).to_dict()
    if validation.get("valid"):
        raise AssertionError("selector fixture should start invalid")

    repaired, report = repair_yaml_text(yaml_text, validation=validation)
    final_validation = validate_yaml_text(repaired).to_dict()
    fixes = report.get("fixes")
    if not report.get("changed") or not final_validation.get("valid"):
        raise AssertionError(f"selector repair failed: {report}")
    if not isinstance(fixes, list) or not any(fix.get("type") == "selector_target_missing" for fix in fixes):
        raise AssertionError(f"selector repair did not report expected fix: {report}")

    return {"name": "selector_repair", "valid": True, "fixes": fixes}


def assert_code_runtime_repair() -> dict[str, object]:
    yaml_text = (ROOT / "batch_cases" / "broken_code_repair.yml").read_text()
    validation = validate_yaml_text(yaml_text).to_dict()
    if not validation.get("valid"):
        raise AssertionError(f"code fixture should import-clean before runtime repair: {validation}")

    runtime_evidence = {
        "draft_run": {
            "summary": {
                "succeeded": False,
                "failed_nodes": [
                    {
                        "node_id": "code",
                        "node_type": "code",
                        "error": "Exception: intentional batch eval failure",
                    }
                ],
            }
        }
    }
    repaired, report = repair_yaml_text(yaml_text, validation=validation, runtime_evidence=runtime_evidence)
    final_validation = validate_yaml_text(repaired).to_dict()
    fixes = report.get("fixes")
    if not report.get("changed") or not final_validation.get("valid"):
        raise AssertionError(f"code repair failed: {report}")
    if "intentional batch eval failure" in repaired:
        raise AssertionError("code repair left the failing implementation in place")
    if not isinstance(fixes, list) or not any(fix.get("type") == "runtime_code_node_failed" for fix in fixes):
        raise AssertionError(f"code repair did not report expected fix: {report}")

    return {"name": "code_runtime_repair", "valid": True, "fixes": fixes}


def assert_suspicious_model_repair() -> dict[str, object]:
    yaml_text = (ROOT / "batch_cases" / "broken_openai_model_repair.yml").read_text()
    validation = validate_yaml_text(yaml_text).to_dict()
    if validation.get("valid"):
        raise AssertionError("broken OpenAI model fixture should start invalid")

    repaired, report = repair_yaml_text(yaml_text, validation=validation)
    final_validation = validate_yaml_text(repaired).to_dict()
    fixes = report.get("fixes")
    if not report.get("changed") or not final_validation.get("valid"):
        raise AssertionError(f"suspicious model repair failed: {report}")
    if "definitely-not-a-real-openai-model" in repaired:
        raise AssertionError("suspicious model repair left the fake model in place")
    if "gpt-4o-mini" not in repaired:
        raise AssertionError("suspicious model repair did not apply the expected fallback")
    if not isinstance(fixes, list) or not any(fix.get("type") == "model_name_suspicious_fallback" for fix in fixes):
        raise AssertionError(f"suspicious model repair did not report expected fix: {report}")

    return {"name": "suspicious_model_repair", "valid": True, "fixes": fixes}


def assert_human_input_handle_repair() -> dict[str, object]:
    doc = human_input_workflow_doc()
    doc["workflow"]["graph"]["edges"][1]["sourceHandle"] = "Approve"
    doc["workflow"]["graph"]["edges"][1]["id"] = "review-Approve-end_approved-target"
    yaml_text = yaml.safe_dump(doc, sort_keys=False, allow_unicode=True)
    validation = validate_yaml_text(yaml_text).to_dict()
    if validation.get("valid"):
        raise AssertionError("broken human-input handle fixture should start invalid")

    repaired, report = repair_yaml_text(yaml_text, validation=validation)
    final_validation = validate_yaml_text(repaired).to_dict()
    fixes = report.get("fixes")
    if not report.get("changed") or not final_validation.get("valid"):
        raise AssertionError(f"human-input handle repair failed: {report}")
    if "sourceHandle: Approve" in repaired:
        raise AssertionError("human-input handle repair left the button title as sourceHandle")
    if "sourceHandle: approve" not in repaired:
        raise AssertionError("human-input handle repair did not apply the expected action id")
    if not isinstance(fixes, list) or not any(fix.get("type") == "human_input_handle_unknown" for fix in fixes):
        raise AssertionError(f"human-input handle repair did not report expected fix: {report}")

    return {"name": "human_input_handle_repair", "valid": True, "fixes": fixes}


def main() -> int:
    cases = [
        assert_selector_repair(),
        assert_code_runtime_repair(),
        assert_suspicious_model_repair(),
        assert_human_input_handle_repair(),
    ]
    print(json.dumps({"valid": True, "cases": cases}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
