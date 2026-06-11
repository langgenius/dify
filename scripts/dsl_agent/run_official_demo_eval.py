#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

from console_lifecycle import DEFAULT_CONSOLE_BASE, DEFAULT_COOKIE_JAR


SCRIPT_DIR = Path(__file__).resolve().parent
DEFAULT_CASES = SCRIPT_DIR / "official_demo_cases.yml"
DEFAULT_OUTPUT_ROOT = SCRIPT_DIR / "outputs" / "official_demo_latest"


def write_json(path: Path, data: Any) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")


def read_json(path: Path) -> Any:
    return json.loads(path.read_text())


def build_generation_command(args: argparse.Namespace, output_root: Path, report_path: Path) -> list[str]:
    cmd = [
        sys.executable,
        str(SCRIPT_DIR / "run_generation_eval.py"),
        "--cases",
        str(args.cases),
        "--output-root",
        str(output_root / "generation"),
        "--output",
        str(report_path),
        "--generation-backend",
        args.generation_backend,
        "--provider",
        args.provider,
        "--model",
        args.model,
        "--json",
    ]
    if args.generation_model:
        cmd.extend(["--generation-model", args.generation_model])
    if args.live:
        cmd.extend(
            [
                "--debug-loop",
                "--console-base",
                args.console_base,
                "--cookie-jar",
                str(args.cookie_jar),
                "--debug-timeout-seconds",
                str(args.debug_timeout_seconds),
                "--install-missing-dependencies",
                "--bootstrap-rag-dataset",
                "--cleanup-app",
                "--cleanup-rag-dataset",
            ]
        )
    if args.full_lifecycle:
        cmd.extend(
            [
                "--publish",
                "--enable-api",
                "--create-api-key",
                "--service-regression",
                "--collect-app-logs",
                "--app-log-detail",
            ]
        )
    if args.skip_preflight:
        cmd.append("--skip-preflight")
    return cmd


def build_repair_command(args: argparse.Namespace, output_root: Path, report_path: Path) -> list[str]:
    cmd = [
        sys.executable,
        str(SCRIPT_DIR / "batch_eval.py"),
        "--output-root",
        str(output_root / "repair"),
        "--output",
        str(report_path),
        "--console-base",
        args.console_base,
        "--cookie-jar",
        str(args.cookie_jar),
        "--timeout-seconds",
        str(args.debug_timeout_seconds),
        "--repair-backend",
        args.repair_backend,
        "--cleanup-app",
    ]
    if args.include_optional_repair_cases:
        cmd.append("--include-optional")
    return cmd


def run_command(cmd: list[str], timeout_seconds: int | None = None) -> dict[str, Any]:
    started = time.perf_counter()
    completed = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout_seconds)
    return {
        "cmd": cmd,
        "returncode": completed.returncode,
        "elapsed_seconds": round(time.perf_counter() - started, 3),
        "stdout": completed.stdout.strip(),
        "stderr": completed.stderr.strip(),
    }


def summarize_generation_case(case: dict[str, Any]) -> dict[str, Any]:
    debug = case.get("debug") if isinstance(case.get("debug"), dict) else None
    post_success = debug.get("post_success") if isinstance(debug, dict) else None
    app_logs = debug.get("app_logs") if isinstance(debug, dict) else None
    dataset_bootstrap = debug.get("dataset_bootstrap") if isinstance(debug, dict) else None
    dataset_cleanup = debug.get("dataset_cleanup") if isinstance(debug, dict) else None
    cleanup = debug.get("cleanup") if isinstance(debug, dict) else None
    app_cleanup = cleanup.get("app") if isinstance(cleanup, dict) and isinstance(cleanup.get("app"), dict) else None
    return {
        "id": case.get("id"),
        "title": case.get("title"),
        "ok": case.get("ok"),
        "validation_valid": case.get("validation_valid"),
        "node_type_counts": case.get("node_type_counts", {}),
        "edge_count": case.get("edge_count"),
        "expectation_errors": case.get("expectation_errors", []),
        "debug_status": debug.get("status") if isinstance(debug, dict) else None,
        "debug_ok": debug.get("ok") if isinstance(debug, dict) else None,
        "published": post_success.get("published") if isinstance(post_success, dict) else None,
        "service_regression_ok": post_success.get("service_regression_ok") if isinstance(post_success, dict) else None,
        "service_regression_status": post_success.get("service_regression_status")
        if isinstance(post_success, dict)
        else None,
        "app_logs_count": app_logs.get("count") if isinstance(app_logs, dict) else None,
        "rag_dataset_bootstrap_ok": dataset_bootstrap.get("ok") if isinstance(dataset_bootstrap, dict) else None,
        "rag_dataset_cleanup_ok": dataset_cleanup.get("ok") if isinstance(dataset_cleanup, dict) else None,
        "app_cleanup_ok": app_cleanup.get("ok") if isinstance(app_cleanup, dict) else None,
        "output_dir": case.get("output_dir"),
    }


def summarize_generation_report(report: dict[str, Any]) -> dict[str, Any]:
    cases = report.get("cases")
    case_summaries = (
        [summarize_generation_case(case) for case in cases if isinstance(case, dict)]
        if isinstance(cases, list)
        else []
    )
    return {
        "valid": report.get("valid"),
        "total": report.get("total"),
        "passed": report.get("passed"),
        "failed": report.get("failed"),
        "generation_backend": report.get("generation_backend"),
        "generation_model": report.get("generation_model"),
        "provider": report.get("provider"),
        "model": report.get("model"),
        "cases": case_summaries,
    }


def summarize_repair_report(report: dict[str, Any]) -> dict[str, Any]:
    results = report.get("results")
    result_summaries: list[dict[str, Any]] = []
    if isinstance(results, list):
        for result in results:
            if not isinstance(result, dict):
                continue
            result_summaries.append(
                {
                    "id": result.get("id"),
                    "title": result.get("title"),
                    "ok": result.get("ok"),
                    "skipped": result.get("skipped"),
                    "skip_reason": result.get("skip_reason"),
                    "status": result.get("status"),
                    "initial_status": result.get("initial_status"),
                    "repair_applied": result.get("repair_applied"),
                    "expectation_errors": result.get("expectation_errors", []),
                    "report": result.get("report"),
                }
            )
    return {
        "total": report.get("total"),
        "passed": report.get("passed"),
        "failed": report.get("failed"),
        "cases": result_summaries,
    }


def build_summary(
    *,
    args: argparse.Namespace,
    output_root: Path,
    generation_report: dict[str, Any],
    generation_command: dict[str, Any],
    repair_report: dict[str, Any] | None,
    repair_command: dict[str, Any] | None,
) -> dict[str, Any]:
    generation_summary = summarize_generation_report(generation_report)
    repair_summary = summarize_repair_report(repair_report) if isinstance(repair_report, dict) else None
    generation_ok = generation_command.get("returncode") == 0 and generation_summary.get("failed") == 0
    repair_ok = True
    if repair_summary is not None:
        repair_ok = (
            repair_command is not None
            and repair_command.get("returncode") == 0
            and repair_summary.get("failed") == 0
        )
    return {
        "ok": bool(generation_ok and repair_ok),
        "mode": "live" if args.live else "structural",
        "full_lifecycle": bool(args.full_lifecycle),
        "output_root": str(output_root),
        "generation": generation_summary,
        "repair_fixtures": repair_summary,
        "commands": {
            "generation": generation_command,
            "repair_fixtures": repair_command,
        },
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run the official Dify DSL Agent demo evaluation suite.")
    parser.add_argument("--cases", type=Path, default=DEFAULT_CASES)
    parser.add_argument("--output-root", type=Path, default=DEFAULT_OUTPUT_ROOT)
    parser.add_argument("--console-base", default=DEFAULT_CONSOLE_BASE)
    parser.add_argument("--cookie-jar", type=Path, default=DEFAULT_COOKIE_JAR)
    parser.add_argument("--generation-backend", default="deterministic_starter")
    parser.add_argument("--generation-model")
    parser.add_argument("--provider", default="langgenius/openai/openai")
    parser.add_argument("--model", default="gpt-4.1")
    parser.add_argument("--repair-backend", choices=["auto", "deterministic", "llm"], default="auto")
    parser.add_argument("--debug-timeout-seconds", type=int, default=180)
    parser.add_argument("--live", action="store_true", help="Import generated apps into local CE and run draft debug.")
    parser.add_argument(
        "--full-lifecycle",
        action="store_true",
        help="After live debug, publish, enable Service API, run Service API regression, and collect app logs.",
    )
    parser.add_argument("--skip-preflight", action="store_true")
    parser.add_argument("--repair-fixtures", action="store_true", help="Also run fixture-based repair evals.")
    parser.add_argument("--include-optional-repair-cases", action="store_true")
    parser.add_argument("--dry-run", action="store_true", help="Print commands and write no eval results.")
    return parser.parse_args()


def run(args: argparse.Namespace) -> int:
    output_root = args.output_root
    output_root.mkdir(parents=True, exist_ok=True)
    generation_report_path = output_root / "generation_eval_report.json"
    repair_report_path = output_root / "repair_eval_report.json"
    summary_path = output_root / "official_demo_summary.json"

    generation_cmd = build_generation_command(args, output_root, generation_report_path)
    repair_cmd = build_repair_command(args, output_root, repair_report_path) if args.repair_fixtures else None
    if args.dry_run:
        dry_run = {"generation": generation_cmd, "repair_fixtures": repair_cmd}
        write_json(summary_path, {"dry_run": True, "commands": dry_run})
        print(json.dumps(dry_run, ensure_ascii=False, indent=2))
        return 0

    generation_command = run_command(generation_cmd, timeout_seconds=args.debug_timeout_seconds * 8)
    generation_report = (
        read_json(generation_report_path) if generation_report_path.exists() else {"valid": False, "cases": []}
    )

    repair_command = None
    repair_report = None
    if repair_cmd:
        repair_command = run_command(repair_cmd, timeout_seconds=args.debug_timeout_seconds * 5)
        repair_report = read_json(repair_report_path) if repair_report_path.exists() else {"failed": 1, "results": []}

    summary = build_summary(
        args=args,
        output_root=output_root,
        generation_report=generation_report,
        generation_command=generation_command,
        repair_report=repair_report,
        repair_command=repair_command,
    )
    write_json(summary_path, summary)
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0 if summary.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(run(parse_args()))
