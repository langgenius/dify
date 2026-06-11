#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import tempfile
from pathlib import Path

from deterministic_repair import repair_yaml_text
from runtime_repair import load_runtime_evidence
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


def main() -> int:
    print(json.dumps({"valid": True, "cases": [assert_embedded_run_record_summary()]}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
