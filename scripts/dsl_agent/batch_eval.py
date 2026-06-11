#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

import yaml

from console_lifecycle import DEFAULT_COOKIE_JAR, DEFAULT_CONSOLE_BASE, DifyConsoleClient


DEFAULT_CASES_FILE = Path(__file__).with_name("batch_eval_cases.yml")
DEFAULT_OUTPUT_ROOT = Path(__file__).with_name("outputs")


def write_json(path: Path, data: Any) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")


def read_json(path: Path) -> Any:
    return json.loads(path.read_text())


def case_initial_status(report: dict[str, Any]) -> str:
    iterations = report.get("iterations")
    if not isinstance(iterations, list) or not iterations:
        return str(report.get("status") or "not_run")
    first = iterations[0]
    if not isinstance(first, dict):
        return "unknown"
    pre_validation = first.get("pre_validation")
    if isinstance(pre_validation, dict) and pre_validation.get("valid") is False:
        return "validation_failed"
    import_block = first.get("import")
    if isinstance(import_block, dict) and not import_block.get("ok"):
        return "import_failed"
    draft_block = first.get("draft")
    if isinstance(draft_block, dict):
        return "succeeded" if draft_block.get("ok") else "draft_failed"
    return str(report.get("status") or "unknown")


def final_outputs(report: dict[str, Any]) -> dict[str, Any]:
    iterations = report.get("iterations")
    if not isinstance(iterations, list):
        return {}
    for iteration in reversed(iterations):
        if not isinstance(iteration, dict):
            continue
        draft = iteration.get("draft")
        summary = draft.get("summary") if isinstance(draft, dict) else None
        outputs = summary.get("outputs") if isinstance(summary, dict) else None
        if isinstance(outputs, dict):
            return outputs
    return {}


def repair_applied(report: dict[str, Any]) -> bool:
    iterations = report.get("iterations")
    if not isinstance(iterations, list):
        return False
    for iteration in iterations:
        pre_validation_repair = iteration.get("pre_validation_repair") if isinstance(iteration, dict) else None
        if isinstance(pre_validation_repair, dict) and pre_validation_repair.get("changed"):
            return True
        repair = iteration.get("repair") if isinstance(iteration, dict) else None
        if isinstance(repair, dict) and repair.get("skipped") is False:
            return True
    return False


def active_model_providers(client: DifyConsoleClient) -> set[str]:
    try:
        result = client.model_providers()
    except Exception:
        return set()
    data = result.get("data") if isinstance(result, dict) else None
    active: set[str] = set()
    if not isinstance(data, list):
        return active
    for item in data:
        if not isinstance(item, dict):
            continue
        provider = item.get("provider")
        custom = item.get("custom_configuration")
        status = custom.get("status") if isinstance(custom, dict) else None
        if isinstance(provider, str) and status == "active":
            active.add(provider)
    return active


def should_skip_case(case: dict[str, Any], *, include_optional: bool, active_providers: set[str]) -> str | None:
    if case.get("optional") and not include_optional:
        return "optional case; pass --include-optional to run it"
    requires = case.get("requires")
    if isinstance(requires, dict):
        provider = requires.get("model_provider")
        if isinstance(provider, str) and provider not in active_providers:
            return f"model provider `{provider}` is not active"
    return None


def assert_expectations(case: dict[str, Any], report: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    expect = case.get("expect")
    if not isinstance(expect, dict):
        return errors

    if expect.get("initial_status") and case_initial_status(report) != expect["initial_status"]:
        errors.append(f"initial_status expected {expect['initial_status']}, got {case_initial_status(report)}")

    final_status = expect.get("final_status") or expect.get("status")
    if final_status and report.get("status") != final_status:
        errors.append(f"final status expected {final_status}, got {report.get('status')}")

    if "repair_applied" in expect and repair_applied(report) is not bool(expect["repair_applied"]):
        errors.append(f"repair_applied expected {expect['repair_applied']}, got {repair_applied(report)}")

    outputs = final_outputs(report)
    output_keys = expect.get("output_keys")
    if isinstance(output_keys, list):
        for key in output_keys:
            if key not in outputs:
                errors.append(f"missing output key `{key}`")

    output_contains = expect.get("output_contains")
    if isinstance(output_contains, dict):
        for key, value in output_contains.items():
            actual = outputs.get(key)
            if value not in str(actual):
                errors.append(f"output `{key}` expected to contain `{value}`, got `{actual}`")

    return errors


def run_case(
    *,
    case: dict[str, Any],
    base_dir: Path,
    output_root: Path,
    args: argparse.Namespace,
) -> dict[str, Any]:
    case_id = str(case["id"])
    run_dir = output_root / case_id
    run_dir.mkdir(parents=True, exist_ok=True)
    source_yaml = base_dir / str(case["yaml_file"])
    generated_yaml = run_dir / "generated.yml"
    shutil.copyfile(source_yaml, generated_yaml)

    max_loops = 2 if isinstance(case.get("expect"), dict) and case["expect"].get("repair_applied") else 1
    cmd = [
        sys.executable,
        str(Path(__file__).with_name("debug_loop.py")),
        str(run_dir),
        "--yaml-file",
        str(generated_yaml),
        "--console-base",
        args.console_base,
        "--cookie-jar",
        str(args.cookie_jar),
        "--mode",
        str(case.get("mode") or "workflow"),
        "--inputs",
        json.dumps(case.get("inputs") or {}, ensure_ascii=False),
        "--max-loops",
        str(max_loops),
        "--repair-backend",
        args.repair_backend,
        "--repair-attempts",
        str(args.repair_attempts),
        "--install-missing-dependencies",
    ]
    if args.no_wait_plugin_install:
        cmd.append("--no-wait-plugin-install")
    if args.skip_run_records:
        cmd.append("--skip-run-records")
    if args.cleanup_app:
        cmd.append("--cleanup-app")

    started = time.monotonic()
    timeout = int(case.get("timeout_seconds") or args.timeout_seconds)
    completed = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    elapsed = time.monotonic() - started
    report_path = run_dir / "debug_loop_report.json"
    report = read_json(report_path) if report_path.exists() else {"status": "missing_report", "iterations": []}
    expectation_errors = assert_expectations(case, report)
    ok = completed.returncode == 0 and not expectation_errors
    return {
        "id": case_id,
        "title": case.get("title"),
        "ok": ok,
        "status": report.get("status"),
        "initial_status": case_initial_status(report),
        "repair_applied": repair_applied(report),
        "outputs": final_outputs(report),
        "run_dir": str(run_dir),
        "report": str(report_path),
        "elapsed_seconds": round(elapsed, 3),
        "returncode": completed.returncode,
        "expectation_errors": expectation_errors,
        "stdout": completed.stdout.strip(),
        "stderr": completed.stderr.strip(),
    }


def run(args: argparse.Namespace) -> int:
    cases_file = args.cases_file
    base_dir = cases_file.parent
    data = yaml.safe_load(cases_file.read_text())
    cases = data.get("cases") if isinstance(data, dict) else None
    if not isinstance(cases, list):
        raise ValueError("cases file must contain a top-level cases list")

    stamp = time.strftime("%Y%m%d_%H%M%S")
    output_root = args.output_root or DEFAULT_OUTPUT_ROOT / f"batch_eval_{stamp}"
    output_root.mkdir(parents=True, exist_ok=True)

    client = DifyConsoleClient(console_base=args.console_base, cookie_jar_path=args.cookie_jar)
    active_providers = active_model_providers(client)

    results: list[dict[str, Any]] = []
    for case in cases:
        if not isinstance(case, dict) or not case.get("id"):
            continue
        skip_reason = should_skip_case(case, include_optional=args.include_optional, active_providers=active_providers)
        if skip_reason:
            results.append(
                {
                    "id": case.get("id"),
                    "title": case.get("title"),
                    "ok": True,
                    "skipped": True,
                    "skip_reason": skip_reason,
                }
            )
            continue
        try:
            results.append(run_case(case=case, base_dir=base_dir, output_root=output_root, args=args))
        except subprocess.TimeoutExpired as exc:
            results.append(
                {
                    "id": case.get("id"),
                    "title": case.get("title"),
                    "ok": False,
                    "status": "timeout",
                    "elapsed_seconds": args.timeout_seconds,
                    "stdout": (exc.stdout or "").strip() if isinstance(exc.stdout, str) else "",
                    "stderr": (exc.stderr or "").strip() if isinstance(exc.stderr, str) else "",
                    "error": f"Timed out after {args.timeout_seconds}s",
                }
            )

    failures = [result for result in results if not result.get("ok")]
    summary = {
        "cases_file": str(cases_file),
        "output_root": str(output_root),
        "active_model_providers": sorted(active_providers),
        "total": len(results),
        "passed": len(results) - len(failures),
        "failed": len(failures),
        "results": results,
    }
    report_path = args.output or output_root / "batch_eval_report.json"
    write_json(report_path, summary)
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0 if not failures else 1


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run batch Dify DSL import/debug/repair evaluations.")
    parser.add_argument("--cases-file", type=Path, default=DEFAULT_CASES_FILE)
    parser.add_argument("--output-root", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--console-base", default=DEFAULT_CONSOLE_BASE)
    parser.add_argument("--cookie-jar", type=Path, default=DEFAULT_COOKIE_JAR)
    parser.add_argument("--repair-backend", choices=["auto", "deterministic", "llm"], default="auto")
    parser.add_argument("--repair-attempts", type=int, default=1)
    parser.add_argument("--timeout-seconds", type=int, default=60)
    parser.add_argument("--include-optional", action="store_true")
    parser.add_argument("--no-wait-plugin-install", action="store_true")
    parser.add_argument("--skip-run-records", action="store_true")
    parser.add_argument("--cleanup-app", action="store_true", help="Delete apps created for each batch eval case.")
    return parser.parse_args()


if __name__ == "__main__":
    raise SystemExit(run(parse_args()))
