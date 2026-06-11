#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path

from run_official_demo_eval import (
    build_generation_command,
    build_repair_command,
    build_summary,
    summarize_generation_report,
)


def make_args(**overrides: object) -> argparse.Namespace:
    values: dict[str, object] = {
        "cases": Path("official_demo_cases.yml"),
        "console_base": "http://localhost",
        "cookie_jar": Path("/tmp/cookies.txt"),
        "generation_backend": "deterministic_starter",
        "generation_model": None,
        "provider": "langgenius/openai/openai",
        "model": "gpt-4.1",
        "repair_backend": "auto",
        "debug_timeout_seconds": 180,
        "live": True,
        "full_lifecycle": True,
        "skip_preflight": False,
        "repair_fixtures": False,
        "include_optional_repair_cases": False,
    }
    values.update(overrides)
    return argparse.Namespace(**values)


def assert_generation_command() -> dict[str, object]:
    args = make_args()
    cmd = build_generation_command(args, Path("/tmp/out"), Path("/tmp/out/report.json"))
    expected_flags = [
        "--debug-loop",
        "--install-missing-dependencies",
        "--bootstrap-rag-dataset",
        "--cleanup-app",
        "--cleanup-rag-dataset",
        "--publish",
        "--enable-api",
        "--create-api-key",
        "--service-regression",
        "--collect-app-logs",
        "--app-log-detail",
    ]
    missing = [flag for flag in expected_flags if flag not in cmd]
    if missing:
        raise AssertionError(f"official demo command missed flags: {missing}\n{cmd}")
    return {"name": "generation_command", "valid": True}


def assert_repair_command() -> dict[str, object]:
    args = make_args()
    cmd = build_repair_command(args, Path("/tmp/out"), Path("/tmp/out/repair.json"))
    if "--cleanup-app" not in cmd:
        raise AssertionError(f"repair command must clean up created apps: {cmd}")
    return {"name": "repair_command", "valid": True}


def assert_generation_summary() -> dict[str, object]:
    report = {
        "valid": True,
        "total": 1,
        "passed": 1,
        "failed": 0,
        "generation_backend": "deterministic_starter",
        "provider": "langgenius/openai/openai",
        "model": "gpt-4.1",
        "cases": [
            {
                "id": "demo",
                "title": "Demo",
                "ok": True,
                "validation_valid": True,
                "node_type_counts": {"start": 1, "llm": 1, "end": 1},
                "edge_count": 2,
                "expectation_errors": [],
                "debug": {
                    "ok": True,
                    "status": "succeeded",
                    "post_success": {
                        "published": True,
                        "service_regression_ok": True,
                        "service_regression_status": 200,
                    },
                    "app_logs": {"count": 1},
                    "cleanup": {"app": {"ok": True}},
                },
                "output_dir": "/tmp/out/demo",
            }
        ],
    }
    summary = summarize_generation_report(report)
    case = summary["cases"][0]
    if case["published"] is not True or case["service_regression_ok"] is not True or case["app_logs_count"] != 1:
        raise AssertionError(f"unexpected summarized case: {case}")
    return {"name": "generation_summary", "valid": True}


def assert_build_summary_status() -> dict[str, object]:
    args = make_args(live=True, full_lifecycle=True)
    generation_report = {"valid": True, "total": 1, "passed": 1, "failed": 0, "cases": []}
    summary = build_summary(
        args=args,
        output_root=Path("/tmp/out"),
        generation_report=generation_report,
        generation_command={"returncode": 0},
        repair_report={"total": 1, "passed": 1, "failed": 0, "results": []},
        repair_command={"returncode": 0},
    )
    if summary.get("ok") is not True or summary.get("mode") != "live" or summary.get("full_lifecycle") is not True:
        raise AssertionError(f"unexpected official summary status: {summary}")
    return {"name": "build_summary_status", "valid": True}


def main() -> int:
    cases = [
        assert_generation_command(),
        assert_repair_command(),
        assert_generation_summary(),
        assert_build_summary_status(),
    ]
    print(json.dumps({"valid": True, "cases": cases}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
