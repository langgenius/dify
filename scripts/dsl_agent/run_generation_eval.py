#!/usr/bin/env python3
from __future__ import annotations

import argparse
import importlib
import json
import subprocess
import sys
import time
from collections import Counter
from pathlib import Path
from typing import Any

import yaml
from console_lifecycle import ConsoleApiError, DifyConsoleClient, console_error_to_dict

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parents[1]
API_DIR = REPO_ROOT / "api"
DEFAULT_CASES = SCRIPT_DIR / "generation_eval_cases.yml"
DEFAULT_OUTPUT_ROOT = SCRIPT_DIR / "outputs"
DEFAULT_COOKIE_JAR = Path.home() / ".dify_console_cookies.txt"
DEFAULT_CONSOLE_BASE = "http://localhost"
DEFAULT_DEBUG_INPUTS = {"input": "hello"}
RAG_DATASET_PLACEHOLDER = "REPLACE_WITH_DATASET_ID"


def load_app_dsl_agent_service():
    if str(API_DIR) not in sys.path:
        sys.path.insert(0, str(API_DIR))
    return importlib.import_module("services.app_dsl_agent_service")


def load_cases(path: Path) -> list[dict[str, Any]]:
    raw = yaml.safe_load(path.read_text())
    if not isinstance(raw, dict) or not isinstance(raw.get("cases"), list):
        raise ValueError(f"{path} must contain a top-level cases list")
    cases = [case for case in raw["cases"] if isinstance(case, dict)]
    if not cases:
        raise ValueError(f"{path} does not define any cases")
    return cases


def write_json(path: Path, data: Any) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")


def read_json(path: Path) -> Any:
    return json.loads(path.read_text())


def graph_nodes(yaml_content: str) -> list[dict[str, Any]]:
    data = yaml.safe_load(yaml_content)
    graph = (((data or {}).get("workflow") or {}).get("graph") or {})
    nodes = graph.get("nodes") if isinstance(graph, dict) else []
    return [node for node in nodes or [] if isinstance(node, dict)]


def graph_edges(yaml_content: str) -> list[dict[str, Any]]:
    data = yaml.safe_load(yaml_content)
    graph = (((data or {}).get("workflow") or {}).get("graph") or {})
    edges = graph.get("edges") if isinstance(graph, dict) else []
    return [edge for edge in edges or [] if isinstance(edge, dict)]


def validation_errors(validation: dict[str, Any]) -> list[dict[str, Any]]:
    return [
        issue
        for issue in validation.get("issues") or []
        if isinstance(issue, dict) and issue.get("severity") == "error"
    ]


def edge_handles_by_source(edges: list[dict[str, Any]]) -> dict[str, set[str]]:
    handles: dict[str, set[str]] = {}
    for edge in edges:
        source = edge.get("source")
        handle = edge.get("sourceHandle") or edge.get("source_handle")
        if isinstance(source, str) and isinstance(handle, str):
            handles.setdefault(source, set()).add(handle)
    return handles


def assert_case_expectations(
    *,
    yaml_content: str,
    metadata: dict[str, Any],
    expect: dict[str, Any],
) -> list[str]:
    errors: list[str] = []
    nodes = graph_nodes(yaml_content)
    edges = graph_edges(yaml_content)
    type_counts = Counter(str(node.get("type")) for node in nodes if node.get("type"))
    validation = metadata.get("validation") if isinstance(metadata.get("validation"), dict) else {}

    if expect.get("valid", True) and validation.get("valid") is not True:
        errors.append(f"validation expected valid, got errors: {validation_errors(validation)}")

    for node_type in expect.get("required_node_types") or []:
        if type_counts[str(node_type)] < 1:
            errors.append(f"missing required node type `{node_type}`")

    min_counts = expect.get("min_node_type_counts") or {}
    if isinstance(min_counts, dict):
        for node_type, minimum in min_counts.items():
            if type_counts[str(node_type)] < int(minimum):
                errors.append(
                    f"node type `{node_type}` expected at least {minimum}, got {type_counts[str(node_type)]}"
                )

    required_edge_handles = expect.get("required_edge_handles") or {}
    if isinstance(required_edge_handles, dict):
        by_source = edge_handles_by_source(edges)
        for source, handles in required_edge_handles.items():
            actual = by_source.get(str(source), set())
            for handle in handles or []:
                if str(handle) not in actual:
                    errors.append(f"edge source `{source}` missing sourceHandle `{handle}`")

    for text in expect.get("required_text") or []:
        if str(text) not in yaml_content:
            errors.append(f"generated YAML missing required text `{text}`")

    generation = metadata.get("generation") if isinstance(metadata.get("generation"), dict) else {}
    if expect.get("no_generation_fallback") and generation.get("fallback_from"):
        errors.append(f"generation unexpectedly fell back from {generation.get('fallback_from')}")

    return errors


def parse_json_arg(value: str | None, default: Any) -> Any:
    if not value:
        return default
    parsed = json.loads(value)
    return parsed


def case_inputs(case: dict[str, Any], args: argparse.Namespace) -> dict[str, Any]:
    if args.inputs:
        parsed = parse_json_arg(args.inputs, DEFAULT_DEBUG_INPUTS)
        if not isinstance(parsed, dict):
            raise ValueError("--inputs must be a JSON object")
        return parsed
    inputs = case.get("inputs")
    if isinstance(inputs, dict):
        return inputs
    return dict(DEFAULT_DEBUG_INPUTS)


def debug_loop_skip_reason(case: dict[str, Any], args: argparse.Namespace) -> str | None:
    debug_config = case.get("debug")
    if not isinstance(debug_config, dict):
        return None
    if debug_config.get("skip"):
        if args.bootstrap_rag_dataset and debug_config.get("bootstrap_rag_dataset"):
            return None
        return str(debug_config.get("reason") or "debug loop disabled for this case")
    return None


def bootstrap_rag_dataset(case_dir: Path, args: argparse.Namespace) -> dict[str, Any] | None:
    yaml_file = case_dir / "generated.yml"
    yaml_text = yaml_file.read_text()
    if RAG_DATASET_PLACEHOLDER not in yaml_text:
        return None

    client = DifyConsoleClient(console_base=args.console_base, cookie_jar_path=args.cookie_jar)
    dataset_name = f"dsl-agent-rag-{int(time.time()) % 1_000_000:06d}"
    report: dict[str, Any] = {
        "ok": False,
        "placeholder": RAG_DATASET_PLACEHOLDER,
        "dataset_name": dataset_name,
        "dataset_id": None,
        "artifact": str(case_dir / "rag_dataset_bootstrap.json"),
        "errors": [],
    }
    try:
        result = client.request(
            "POST",
            "/console/api/datasets",
            body={
                "name": dataset_name,
                "description": "Temporary dataset for DSL agent RAG live evaluation.",
                "indexing_technique": "economy",
                "permission": "only_me",
                "provider": "vendor",
            },
        )
    except ConsoleApiError as exc:
        report["errors"].append(console_error_to_dict("bootstrap_rag_dataset", exc))
        write_json(case_dir / "rag_dataset_bootstrap.json", report)
        return report

    dataset_id = result.get("id") if isinstance(result, dict) else None
    if not isinstance(dataset_id, str) or not dataset_id:
        report["errors"].append({"stage": "bootstrap_rag_dataset", "message": "Dataset create response missing id."})
        write_json(case_dir / "rag_dataset_bootstrap.json", report)
        return report

    yaml_file.write_text(yaml_text.replace(RAG_DATASET_PLACEHOLDER, dataset_id))
    report.update(
        {
            "ok": True,
            "dataset_id": dataset_id,
            "replacement_count": yaml_text.count(RAG_DATASET_PLACEHOLDER),
        }
    )
    write_json(case_dir / "rag_dataset_bootstrap.json", report)
    return report


def append_post_success_args(cmd: list[str], args: argparse.Namespace) -> None:
    if args.publish:
        cmd.append("--publish")
    if args.publish_name:
        cmd.extend(["--publish-name", args.publish_name])
    if args.publish_comment:
        cmd.extend(["--publish-comment", args.publish_comment])
    if args.enable_api:
        cmd.append("--enable-api")
    if args.create_api_key:
        cmd.append("--create-api-key")
    if args.list_api_keys:
        cmd.append("--list-api-keys")
    if args.export_backup:
        cmd.append("--export-backup")
    if args.export_include_secret:
        cmd.append("--export-include-secret")
    if args.service_regression:
        cmd.append("--service-regression")
    if args.service_api_base:
        cmd.extend(["--service-api-base", args.service_api_base])
    if args.service_api_key:
        cmd.extend(["--service-api-key", args.service_api_key])
    if args.service_response_mode:
        cmd.extend(["--service-response-mode", args.service_response_mode])


def summarize_post_success(report: dict[str, Any]) -> dict[str, Any] | None:
    post_success = report.get("post_success")
    if not isinstance(post_success, dict):
        return None
    service_regression = post_success.get("service_regression")
    service_status = service_regression.get("status") if isinstance(service_regression, dict) else None
    export = post_success.get("export")
    export_artifact = export.get("artifact") if isinstance(export, dict) else None
    return {
        "ok": post_success.get("ok"),
        "errors": post_success.get("errors", []),
        "published": post_success.get("publish") is not None,
        "api_enabled": post_success.get("api_enable") is not None,
        "api_key_token_available": post_success.get("api_key_token_available"),
        "export_artifact": export_artifact,
        "service_regression_status": service_status,
        "service_regression_ok": service_regression.get("ok") if isinstance(service_regression, dict) else None,
        "service_regression_artifact": post_success.get("service_regression_artifact"),
    }


def run_debug_loop_for_case(
    *,
    case: dict[str, Any],
    case_dir: Path,
    args: argparse.Namespace,
) -> dict[str, Any]:
    skip_reason = debug_loop_skip_reason(case, args)
    if skip_reason:
        return {
            "enabled": True,
            "skipped": True,
            "skip_reason": skip_reason,
            "ok": True,
        }

    yaml_file = case_dir / "generated.yml"
    report_path = case_dir / "debug_loop_report.json"
    dataset_bootstrap = bootstrap_rag_dataset(case_dir, args) if args.bootstrap_rag_dataset else None
    if dataset_bootstrap and not dataset_bootstrap.get("ok"):
        return {
            "enabled": True,
            "ok": False,
            "status": "rag_dataset_bootstrap_failed",
            "dataset_bootstrap": dataset_bootstrap,
            "report": str(report_path),
            "errors": ["RAG dataset bootstrap failed"],
        }

    inputs = case_inputs(case, args)
    cmd = [
        sys.executable,
        str(SCRIPT_DIR / "debug_loop.py"),
        str(case_dir),
        "--yaml-file",
        str(yaml_file),
        "--console-base",
        args.console_base,
        "--cookie-jar",
        str(args.cookie_jar),
        "--mode",
        str(case.get("mode") or "workflow"),
        "--inputs",
        json.dumps(inputs, ensure_ascii=False),
        "--max-loops",
        str(args.debug_max_loops),
        "--repair-backend",
        args.repair_backend,
        "--repair-attempts",
        str(args.repair_attempts),
        "--output",
        str(report_path),
    ]
    if args.install_missing_dependencies:
        cmd.append("--install-missing-dependencies")
    if args.no_wait_plugin_install:
        cmd.append("--no-wait-plugin-install")
    if args.skip_run_records:
        cmd.append("--skip-run-records")
    if args.no_repair:
        cmd.append("--no-repair")
    append_post_success_args(cmd, args)

    started = time.perf_counter()
    try:
        completed = subprocess.run(cmd, capture_output=True, text=True, timeout=args.debug_timeout_seconds)
        elapsed = time.perf_counter() - started
    except subprocess.TimeoutExpired as exc:
        return {
            "enabled": True,
            "ok": False,
            "status": "timeout",
            "elapsed_seconds": args.debug_timeout_seconds,
            "report": str(report_path),
            "stdout": (exc.stdout or "").strip() if isinstance(exc.stdout, str) else "",
            "stderr": (exc.stderr or "").strip() if isinstance(exc.stderr, str) else "",
            "error": f"Timed out after {args.debug_timeout_seconds}s",
        }

    report = read_json(report_path) if report_path.exists() else {"status": "missing_report"}
    expect_debug = case.get("expect_debug") if isinstance(case.get("expect_debug"), dict) else {}
    expected_status = str(expect_debug.get("status") or "succeeded")
    status = str(report.get("status") or "unknown") if isinstance(report, dict) else "unknown"
    errors: list[str] = []
    if status != expected_status:
        errors.append(f"debug status expected {expected_status}, got {status}")
    if completed.returncode != 0 and status == expected_status:
        errors.append(f"debug_loop.py returned {completed.returncode}")

    return {
        "enabled": True,
        "ok": not errors,
        "status": status,
        "expected_status": expected_status,
        "elapsed_seconds": round(elapsed, 3),
        "report": str(report_path),
        "app_id": report.get("app_id") if isinstance(report, dict) else None,
        "final_yaml": report.get("final_yaml") if isinstance(report, dict) else None,
        "dataset_bootstrap": dataset_bootstrap,
        "post_success": summarize_post_success(report) if isinstance(report, dict) else None,
        "errors": errors,
        "stdout": completed.stdout.strip(),
        "stderr": completed.stderr.strip(),
    }


def run_case(case: dict[str, Any], args: argparse.Namespace, service_module: Any) -> dict[str, Any]:
    case_id = str(case.get("id") or "")
    if not case_id:
        raise ValueError("generation eval case missing id")
    request = str(case.get("request") or "")
    if not request:
        raise ValueError(f"{case_id}: missing request")

    generate_args = service_module.AppDslAgentGenerateArgs(
        prompt=request,
        app_name=case_id,
        provider=args.provider,
        model=args.model,
        generation_backend=args.generation_backend,
        generation_model=args.generation_model,
        input_variable=args.input_variable,
        resolve_dependencies=not args.no_resolve_dependencies,
    )
    started = time.perf_counter()
    result = service_module.AppDslAgentService().generate(generate_args)
    elapsed = time.perf_counter() - started
    metadata = result.metadata if isinstance(result.metadata, dict) else {}
    nodes = graph_nodes(result.yaml_content)
    edges = graph_edges(result.yaml_content)
    type_counts = Counter(str(node.get("type")) for node in nodes if node.get("type"))
    expectation_errors = assert_case_expectations(
        yaml_content=result.yaml_content,
        metadata=metadata,
        expect=case.get("expect") if isinstance(case.get("expect"), dict) else {},
    )

    case_dir = args.output_root / case_id if args.output_root else None
    if case_dir:
        case_dir.mkdir(parents=True, exist_ok=True)
        (case_dir / "generated.yml").write_text(result.yaml_content)
        write_json(case_dir / "metadata.json", metadata)

    validation = metadata.get("validation") if isinstance(metadata.get("validation"), dict) else {}
    generation = metadata.get("generation") if isinstance(metadata.get("generation"), dict) else {}
    debug_result = None
    if args.debug_loop:
        if expectation_errors:
            debug_result = {
                "enabled": True,
                "skipped": True,
                "ok": False,
                "skip_reason": "generation expectations failed",
            }
        elif not case_dir:
            debug_result = {
                "enabled": True,
                "skipped": True,
                "ok": False,
                "skip_reason": "debug loop requires --output-root",
            }
        else:
            debug_result = run_debug_loop_for_case(case=case, case_dir=case_dir, args=args)

    case_ok = not expectation_errors and (not debug_result or bool(debug_result.get("ok")))
    return {
        "id": case_id,
        "title": case.get("title"),
        "ok": case_ok,
        "elapsed_seconds": round(elapsed, 3),
        "backend": metadata.get("backend"),
        "generation_backend": generation.get("backend"),
        "fallback_from": generation.get("fallback_from"),
        "validation_valid": validation.get("valid"),
        "node_type_counts": dict(sorted(type_counts.items())),
        "edge_count": len(edges),
        "expectation_errors": expectation_errors,
        "debug": debug_result,
        "output_dir": str(case_dir) if case_dir else None,
    }


def run(args: argparse.Namespace) -> int:
    service_module = load_app_dsl_agent_service()
    cases = load_cases(args.cases)
    if args.case_id:
        selected_ids = set(args.case_id)
        cases = [case for case in cases if str(case.get("id") or "") in selected_ids]
        missing_ids = selected_ids - {str(case.get("id") or "") for case in cases}
        if missing_ids:
            raise ValueError(f"Unknown case id(s): {', '.join(sorted(missing_ids))}")
    if args.output_root:
        args.output_root.mkdir(parents=True, exist_ok=True)
    results = [run_case(case, args, service_module) for case in cases]
    failures = [result for result in results if not result.get("ok")]
    report = {
        "valid": not failures,
        "cases_file": str(args.cases),
        "generation_backend": args.generation_backend,
        "generation_model": args.generation_model,
        "provider": args.provider,
        "model": args.model,
        "total": len(results),
        "passed": len(results) - len(failures),
        "failed": len(failures),
        "cases": results,
    }
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(report, ensure_ascii=False, indent=2) if args.json else report_line(report))  # noqa: T201
    return 0 if not failures else 1


def report_line(report: dict[str, Any]) -> str:
    return (
        f"generation eval: total={report['total']} passed={report['passed']} "
        f"failed={report['failed']} backend={report['generation_backend']}"
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Evaluate natural-language DSL generation quality.")
    parser.add_argument("--cases", type=Path, default=DEFAULT_CASES)
    parser.add_argument("--case-id", action="append", help="Run only the selected case id. May be repeated.")
    parser.add_argument("--generation-backend", default="deterministic_starter")
    parser.add_argument("--generation-model")
    parser.add_argument("--provider", default="langgenius/openai/openai")
    parser.add_argument("--model", default="gpt-4.1")
    parser.add_argument("--input-variable", default="input")
    parser.add_argument("--no-resolve-dependencies", action="store_true")
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--output", type=Path)
    parser.add_argument("--output-root", type=Path, default=DEFAULT_OUTPUT_ROOT / "generation_eval_latest")
    parser.add_argument("--debug-loop", action="store_true", help="Import generated YAML and run draft debug loop.")
    parser.add_argument("--console-base", default=DEFAULT_CONSOLE_BASE)
    parser.add_argument("--cookie-jar", type=Path, default=DEFAULT_COOKIE_JAR)
    parser.add_argument("--inputs", help="Override all case inputs with a JSON object.")
    parser.add_argument("--debug-max-loops", type=int, default=2)
    parser.add_argument("--debug-timeout-seconds", type=int, default=120)
    parser.add_argument("--repair-backend", choices=["auto", "deterministic", "llm"], default="auto")
    parser.add_argument("--repair-attempts", type=int, default=1)
    parser.add_argument("--install-missing-dependencies", action="store_true")
    parser.add_argument("--no-wait-plugin-install", action="store_true")
    parser.add_argument("--skip-run-records", action="store_true")
    parser.add_argument("--no-repair", action="store_true")
    parser.add_argument("--publish", action="store_true", help="Publish after draft debug succeeds.")
    parser.add_argument("--publish-name")
    parser.add_argument("--publish-comment")
    parser.add_argument("--enable-api", action="store_true", help="Enable App Service API after draft debug succeeds.")
    parser.add_argument(
        "--create-api-key",
        action="store_true",
        help="Create an App API key for Service API regression.",
    )
    parser.add_argument(
        "--list-api-keys",
        action="store_true",
        help="List existing App API keys for Service API regression.",
    )
    parser.add_argument("--export-backup", action="store_true", help="Export a backup DSL after draft debug succeeds.")
    parser.add_argument("--export-include-secret", action="store_true")
    parser.add_argument("--service-regression", action="store_true", help="Run the published app through Service API.")
    parser.add_argument("--service-api-base")
    parser.add_argument("--service-api-key")
    parser.add_argument("--service-response-mode", choices=["blocking", "streaming"], default="blocking")
    parser.add_argument(
        "--bootstrap-rag-dataset",
        action="store_true",
        help="Create an empty local CE dataset and replace REPLACE_WITH_DATASET_ID before debug loop.",
    )
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
