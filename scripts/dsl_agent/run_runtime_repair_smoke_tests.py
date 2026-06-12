#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import tempfile
from pathlib import Path

from deterministic_repair import repair_yaml_text
from runtime_repair import load_runtime_evidence, preserve_existing_dependencies, stabilize_plain_scalar_colons
from validator import validate_yaml_text


ROOT = Path(__file__).resolve().parent


def assert_embedded_run_record_summary() -> dict[str, object]:
    yaml_text = (ROOT / "batch_cases" / "broken_code_repair.yml").read_text()
    validation = validate_yaml_text(yaml_text).to_dict()
    if not validation.get("valid"):
        raise AssertionError(f"code fixture should import-clean before runtime repair: {validation}")

    with tempfile.TemporaryDirectory() as tmp:
        run_dir = Path(tmp)
        (run_dir / "console_draft_run.json").write_text(
            json.dumps(
                {
                    "draft_run": {
                        "summary": {
                            "workflow_run_id": "run-1",
                            "status": "failed",
                            "succeeded": False,
                            "failed_nodes": [],
                            "errors": [],
                        }
                    },
                    "run_detail": {"id": "run-1", "status": "failed", "error": "node failed"},
                    "node_executions": {
                        "data": [
                            {
                                "node_id": "code",
                                "node_type": "code",
                                "title": "Code",
                                "status": "failed",
                                "error": "Exception: intentional batch eval failure",
                            }
                        ]
                    },
                }
            )
        )
        evidence = load_runtime_evidence(
            argparse.Namespace(
                run_dir=run_dir,
                import_report=None,
                runtime_report=None,
                run_detail=None,
                node_executions=None,
            )
        )

    summary = evidence.get("summary")
    if not isinstance(summary, dict):
        raise AssertionError(f"expected compact summary: {evidence}")
    failed_nodes = summary.get("failed_nodes")
    if not isinstance(failed_nodes, list) or not any(node.get("node_id") == "code" for node in failed_nodes):
        raise AssertionError(f"expected code node failure in summary: {summary}")

    repaired, report = repair_yaml_text(yaml_text, validation=validation, runtime_evidence=evidence)
    final_validation = validate_yaml_text(repaired).to_dict()
    if not report.get("changed") or not final_validation.get("valid"):
        raise AssertionError(f"embedded run record repair failed: {report}")
    if "intentional batch eval failure" in repaired:
        raise AssertionError("embedded run record repair left the failing implementation in place")

    return {
        "name": "embedded_run_record_summary",
        "valid": True,
        "runtime_evidence_keys": sorted(evidence.keys()),
        "failed_nodes": failed_nodes,
        "fixes": report.get("fixes"),
    }


def assert_runtime_repair_quotes_setup_notes() -> dict[str, object]:
    yaml_text = """app:
  description: Generated from a natural language requirement. Setup note: configure the OpenAI model provider/plugin in the workspace before running this workflow.
  name: smoke
kind: app
version: 0.6.0
"""
    validation = validate_yaml_text(yaml_text).to_dict()
    if validation.get("valid"):
        raise AssertionError("fixture should reproduce the unquoted setup note parse failure")

    repaired = stabilize_plain_scalar_colons(yaml_text)
    repaired_validation = validate_yaml_text(repaired).to_dict()
    if repaired_validation.get("valid") or repaired_validation.get("issues", [{}])[0].get("code") == "yaml_parse_error":
        raise AssertionError(f"setup note should parse after stabilization: {repaired_validation}\n{repaired}")

    if 'description: "Generated from a natural language requirement. Setup note:' not in repaired:
        raise AssertionError(f"expected description to be quoted: {repaired}")

    return {"name": "runtime_repair_quotes_setup_notes", "valid": True}


def assert_runtime_repair_preserves_dependencies() -> dict[str, object]:
    previous_yaml = """app:
  description: smoke
  mode: workflow
  name: smoke
dependencies:
- type: marketplace
  value:
    marketplace_plugin_unique_identifier: langgenius/openai
  current_identifier: null
kind: app
version: 0.6.0
workflow: {}
"""
    repaired_yaml = """app:
  description: smoke
  mode: workflow
  name: smoke
dependencies: []
kind: app
version: 0.6.0
workflow: {}
"""
    preserved, report = preserve_existing_dependencies(previous_yaml, repaired_yaml)
    if not report.get("changed"):
        raise AssertionError(f"expected dependency preservation to change YAML: {report}")
    if "marketplace_plugin_unique_identifier: langgenius/openai" not in preserved:
        raise AssertionError(f"expected openai dependency to be preserved: {preserved}")

    preserved_again, report_again = preserve_existing_dependencies(previous_yaml, preserved)
    if report_again.get("changed") or preserved_again != preserved:
        raise AssertionError(f"dependency preservation should be idempotent: {report_again}")

    return {"name": "runtime_repair_preserves_dependencies", "valid": True, "preserved": report.get("preserved")}


def main() -> int:
    print(
        json.dumps(
            {
                "valid": True,
                "cases": [
                    assert_embedded_run_record_summary(),
                    assert_runtime_repair_quotes_setup_notes(),
                    assert_runtime_repair_preserves_dependencies(),
                ],
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
