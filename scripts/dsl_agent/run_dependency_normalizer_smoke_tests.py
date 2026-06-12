#!/usr/bin/env python3
from __future__ import annotations

import json
from copy import deepcopy
from typing import Any

import yaml
from dependency_normalizer import normalize_yaml_text
from run_validator_smoke_tests import GMAIL_UID, OPENAI_UID, base_workflow_doc, llm_workflow_doc
from validator import validate_yaml_text

OPENAI_PACKAGE_IDENTITY = "langgenius/openai:0.4.2"


def plugin_evidence() -> dict[str, Any]:
    return {
        "official_candidates": [
            {
                "source": "official",
                "plugin_id": "langgenius/dify-gmail",
                "package_identity": "langgenius/dify-gmail:0.2.1",
                "exact_dependency_evidence": [
                    {
                        "plugin_id": "langgenius/dify-gmail",
                        "unique_identifier": GMAIL_UID,
                        "dependency": {
                            "current_identifier": None,
                            "type": "marketplace",
                            "value": {"marketplace_plugin_unique_identifier": GMAIL_UID},
                        },
                    }
                ],
            }
        ],
        "model_provider_candidates": [
            {
                "source": "official",
                "plugin_id": "langgenius/openai",
                "package_identity": OPENAI_PACKAGE_IDENTITY,
                "exact_dependency_evidence": [],
            }
        ],
        "extracted_template_candidates": [],
        "official_template_links": [],
    }


def issue_codes(report: dict[str, Any]) -> set[str]:
    return {str(issue["code"]) for issue in report.get("issues", [])}


def assert_normalizes(name: str, doc: dict[str, Any], expected_added: set[str]) -> dict[str, Any]:
    doc = deepcopy(doc)
    doc["dependencies"] = []
    normalized, normalizer_report = normalize_yaml_text(yaml.safe_dump(doc, sort_keys=False), plugin_evidence())
    validation = validate_yaml_text(normalized).to_dict()
    added = {item["plugin_id"] for item in normalizer_report["added"]}
    missing = expected_added - added
    if missing:
        raise AssertionError(f"{name}: missing normalized dependencies {sorted(missing)}; report={normalizer_report}")
    if not validation["valid"]:
        raise AssertionError(f"{name}: normalized DSL should validate; issues={validation['issues']}")
    return {
        "name": name,
        "added": sorted(added),
        "valid": validation["valid"],
        "issues": validation["issues"],
        "normalizer_report": normalizer_report,
    }


def assert_skips_without_evidence() -> dict[str, Any]:
    doc = deepcopy(base_workflow_doc())
    doc["dependencies"] = []
    normalized, normalizer_report = normalize_yaml_text(yaml.safe_dump(doc, sort_keys=False), {})
    validation = validate_yaml_text(normalized).to_dict()
    codes = issue_codes(validation)
    if "plugin_dependency_missing" not in codes:
        raise AssertionError(f"missing plugin dependency should remain visible; issues={validation['issues']}")
    if not normalizer_report["skipped"]:
        raise AssertionError(f"expected skipped dependency without evidence; report={normalizer_report}")
    return {
        "name": "skip_without_evidence",
        "valid": validation["valid"],
        "issues": validation["issues"],
        "normalizer_report": normalizer_report,
    }


def assert_repairs_invalid_dependency_type() -> dict[str, Any]:
    doc = deepcopy(llm_workflow_doc())
    doc["dependencies"] = [
        {
            "current_identifier": None,
            "type": "model",
            "value": {
                "marketplace_plugin_unique_identifier": OPENAI_UID,
            },
        }
    ]
    normalized, normalizer_report = normalize_yaml_text(yaml.safe_dump(doc, sort_keys=False), plugin_evidence())
    validation = validate_yaml_text(normalized).to_dict()
    if not validation["valid"]:
        raise AssertionError(f"repaired dependency type should validate; issues={validation['issues']}")
    if not normalizer_report["normalized"]:
        raise AssertionError(f"expected dependency normalization report; report={normalizer_report}")
    return {
        "name": "invalid_dependency_type_repaired",
        "valid": validation["valid"],
        "issues": validation["issues"],
        "normalizer_report": normalizer_report,
    }


def assert_upgrades_bare_model_dependency() -> dict[str, Any]:
    doc = deepcopy(llm_workflow_doc())
    doc["dependencies"] = [
        {
            "current_identifier": None,
            "type": "marketplace",
            "value": {"marketplace_plugin_unique_identifier": "langgenius/openai"},
        }
    ]
    normalized, normalizer_report = normalize_yaml_text(yaml.safe_dump(doc, sort_keys=False), plugin_evidence())
    if OPENAI_PACKAGE_IDENTITY not in normalized:
        raise AssertionError(f"expected bare dependency to be upgraded: {normalized}")
    normalized_items = normalizer_report.get("normalized")
    if not isinstance(normalized_items, list) or not any(
        item.get("type") == "dependency_identifier_upgraded" for item in normalized_items
    ):
        raise AssertionError(f"expected dependency upgrade report: {normalizer_report}")
    validation = validate_yaml_text(normalized).to_dict()
    if not validation["valid"]:
        raise AssertionError(f"upgraded dependency should validate; issues={validation['issues']}")
    return {
        "name": "bare_model_dependency_upgraded",
        "valid": validation["valid"],
        "issues": validation["issues"],
        "normalizer_report": normalizer_report,
    }


def main() -> int:
    cases = [
        assert_normalizes("tool_dependency", base_workflow_doc(), {"langgenius/dify-gmail"}),
        assert_normalizes("model_provider_dependency", llm_workflow_doc(), {"langgenius/openai"}),
        assert_repairs_invalid_dependency_type(),
        assert_upgrades_bare_model_dependency(),
        assert_skips_without_evidence(),
    ]
    print(json.dumps({"valid": True, "cases": cases}, ensure_ascii=False, indent=2))  # noqa: T201
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
