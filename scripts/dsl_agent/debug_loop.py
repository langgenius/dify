#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any

from openai import OpenAI

from console_lifecycle import (
    DEFAULT_COOKIE_JAR,
    DEFAULT_CONSOLE_BASE,
    ConsoleApiError,
    DifyConsoleClient,
    console_error_to_dict,
    extract_leaked_dependencies,
    parse_json_arg,
    run_debug_draft_sequence,
    run_import_debug_sequence,
    run_install_dependencies_sequence,
)
from dependency_normalizer import normalize_yaml_text
from deterministic_repair import repair_yaml_text as deterministic_repair_yaml_text
from run_dify_app import post_json
from runtime_repair import (
    load_runtime_evidence,
    read_json_or_text,
    read_text_if_exists,
    repair_yaml,
)
from shape_normalizer import normalize_shape_yaml_text
from validator import validate_yaml_text


PUBLISH_MARKED_NAME_MAX_LENGTH = 20
PUBLISH_MARKED_COMMENT_MAX_LENGTH = 100


def write_json(path: Path, data: Any) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")


def copy_json_artifact(run_dir: Path, canonical_name: str, loop_name: str, data: Any) -> Path:
    loop_path = run_dir / loop_name
    canonical_path = run_dir / canonical_name
    write_json(loop_path, data)
    write_json(canonical_path, data)
    return loop_path


def read_mode_from_plan(run_dir: Path) -> str | None:
    plan = read_json_or_text(run_dir / "plan.json", {})
    if not isinstance(plan, dict):
        return None
    app = plan.get("app")
    if not isinstance(app, dict):
        return None
    mode = app.get("mode")
    if mode in {"workflow", "advanced-chat"}:
        return str(mode)
    return None


def resolve_mode(run_dir: Path, mode: str) -> str:
    if mode != "auto":
        return mode
    return read_mode_from_plan(run_dir) or "workflow"


def load_generation_context(run_dir: Path) -> dict[str, Any]:
    return {
        "request": (read_text_if_exists(run_dir / "request.txt") or "").strip(),
        "plan": read_json_or_text(run_dir / "plan.json", {}),
        "plugin_evidence": read_json_or_text(run_dir / "plugin_evidence.json", {}),
        "source_context": read_json_or_text(run_dir / "source_context.json", {}),
    }


def draft_debug_succeeded(debug_result: dict[str, Any]) -> bool:
    if debug_result.get("errors"):
        return False
    draft_run = debug_result.get("draft_run")
    if not isinstance(draft_run, dict):
        return False
    summary = draft_run.get("summary")
    return isinstance(summary, dict) and summary.get("succeeded") is True


def extract_api_key_token(result: Any) -> str | None:
    if isinstance(result, dict):
        token = result.get("token")
        if isinstance(token, str) and token:
            return token
        data = result.get("data")
        if isinstance(data, dict):
            token = data.get("token")
            if isinstance(token, str) and token:
                return token
        if isinstance(data, list):
            for item in data:
                if isinstance(item, dict) and isinstance(item.get("token"), str) and item["token"]:
                    return item["token"]
    return None


def redact_sensitive_values(value: Any) -> Any:
    sensitive_keys = {
        "api_key",
        "authorization",
        "password",
        "refresh_token",
        "secret",
        "token",
    }
    if isinstance(value, dict):
        redacted: dict[str, Any] = {}
        for key, item in value.items():
            normalized_key = key.lower()
            if any(part in normalized_key for part in sensitive_keys) and item:
                redacted[key] = "[redacted]"
            else:
                redacted[key] = redact_sensitive_values(item)
        return redacted
    if isinstance(value, list):
        return [redact_sensitive_values(item) for item in value]
    return value


def write_export_artifact(run_dir: Path, result: Any) -> str:
    export_path = run_dir / "exported.yml"
    if isinstance(result, str):
        export_path.write_text(result)
    elif isinstance(result, dict) and isinstance(result.get("data"), str):
        export_path.write_text(result["data"])
    elif isinstance(result, dict) and isinstance(result.get("raw"), str):
        export_path.write_text(result["raw"])
    else:
        export_path.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    return str(export_path)


def normalize_shape_artifact(
    *,
    run_dir: Path,
    yaml_file: Path,
    iteration: int,
    enabled: bool,
) -> tuple[Path, dict[str, Any]]:
    if not enabled:
        return yaml_file, {
            "skipped": True,
            "reason": "--no-normalize-shape was set",
            "input_yaml": str(yaml_file),
            "output_yaml": str(yaml_file),
        }

    normalized_yaml, report = normalize_shape_yaml_text(yaml_file.read_text())
    report_path = run_dir / f"shape_normalization.loop{iteration}.json"
    write_json(report_path, report)
    record = {
        "skipped": False,
        "input_yaml": str(yaml_file),
        "output_yaml": str(yaml_file),
        "artifact": str(report_path),
        "changed": report.get("changed"),
        "fix_count": len(report.get("fixes", [])) if isinstance(report.get("fixes"), list) else 0,
        "errors": report.get("errors", []),
    }
    if not report.get("changed"):
        return yaml_file, record

    normalized_path = run_dir / f"generated.loop{iteration}.shape_normalized.yml"
    normalized_path.write_text(normalized_yaml)
    record["output_yaml"] = str(normalized_path)
    return normalized_path, record


def run_service_regression(
    *,
    mode: str,
    service_api_base: str,
    api_key: str,
    inputs: dict[str, Any],
    query: str,
    response_mode: str,
) -> dict[str, Any]:
    api_base = service_api_base.rstrip("/")
    if mode == "advanced-chat":
        url = f"{api_base}/chat-messages"
        payload: dict[str, Any] = {
            "inputs": inputs,
            "query": query,
            "response_mode": response_mode,
            "user": "dsl-agent-debugger",
        }
    else:
        url = f"{api_base}/workflows/run"
        payload = {
            "inputs": inputs,
            "response_mode": response_mode,
            "user": "dsl-agent-debugger",
        }
    status, result = post_json(url, api_key, payload)
    return {"status": status, "url": url, "payload": payload, "result": result, "ok": 200 <= status < 300}


def validate_post_success_args(args: argparse.Namespace) -> list[dict[str, Any]]:
    errors: list[dict[str, Any]] = []
    if args.publish and args.publish_name and len(args.publish_name) > PUBLISH_MARKED_NAME_MAX_LENGTH:
        errors.append(
            {
                "stage": "validate_post_success_args",
                "field": "publish_name",
                "message": f"--publish-name must be at most {PUBLISH_MARKED_NAME_MAX_LENGTH} characters.",
                "value_length": len(args.publish_name),
                "max_length": PUBLISH_MARKED_NAME_MAX_LENGTH,
            }
        )
    if args.publish and args.publish_comment and len(args.publish_comment) > PUBLISH_MARKED_COMMENT_MAX_LENGTH:
        errors.append(
            {
                "stage": "validate_post_success_args",
                "field": "publish_comment",
                "message": f"--publish-comment must be at most {PUBLISH_MARKED_COMMENT_MAX_LENGTH} characters.",
                "value_length": len(args.publish_comment),
                "max_length": PUBLISH_MARKED_COMMENT_MAX_LENGTH,
            }
        )
    return errors


def run_post_success_lifecycle(
    *,
    client: DifyConsoleClient,
    run_dir: Path,
    app_id: str,
    mode: str,
    inputs: dict[str, Any],
    query: str,
    args: argparse.Namespace,
) -> dict[str, Any]:
    result: dict[str, Any] = {
        "publish": None,
        "api_enable": None,
        "api_key": None,
        "api_key_token_available": False,
        "export": None,
        "service_regression": None,
        "errors": [],
        "ok": True,
    }
    api_key = args.service_api_key
    validation_errors = validate_post_success_args(args)
    if validation_errors:
        result["errors"].extend(validation_errors)
        result["ok"] = False
        return result

    if args.publish:
        try:
            result["publish"] = client.publish(
                app_id,
                marked_name=args.publish_name,
                marked_comment=args.publish_comment,
            )
        except ConsoleApiError as exc:
            result["errors"].append(console_error_to_dict("publish", exc))

    if args.enable_api:
        try:
            result["api_enable"] = client.enable_api(app_id, enabled=True)
        except ConsoleApiError as exc:
            result["errors"].append(console_error_to_dict("api_enable", exc))

    if args.create_api_key:
        try:
            api_key_result = client.create_api_key(app_id)
            api_key = extract_api_key_token(api_key_result) or api_key
            result["api_key"] = redact_sensitive_values(api_key_result)
        except ConsoleApiError as exc:
            result["errors"].append(console_error_to_dict("create_api_key", exc))
    elif args.list_api_keys:
        try:
            api_key_result = client.list_api_keys(app_id)
            api_key = extract_api_key_token(api_key_result) or api_key
            result["api_key"] = redact_sensitive_values(api_key_result)
        except ConsoleApiError as exc:
            result["errors"].append(console_error_to_dict("list_api_keys", exc))

    result["api_key_token_available"] = bool(api_key)

    if args.export_backup:
        try:
            export_result = client.export_dsl(app_id, include_secret=args.export_include_secret)
            result["export"] = {
                "artifact": write_export_artifact(run_dir, export_result),
                "include_secret": args.export_include_secret,
            }
        except ConsoleApiError as exc:
            result["errors"].append(console_error_to_dict("export", exc))

    if args.service_regression:
        if not api_key:
            result["errors"].append(
                {
                    "stage": "service_regression",
                    "message": "Service API regression requires --service-api-key, --create-api-key, or --list-api-keys.",
                }
            )
        else:
            service_api_base = args.service_api_base or f"{args.console_base.rstrip('/')}/v1"
            result["service_regression"] = run_service_regression(
                mode=mode,
                service_api_base=service_api_base,
                api_key=api_key,
                inputs=inputs,
                query=query,
                response_mode=args.service_response_mode,
            )
            service_artifact = run_dir / "service_regression.json"
            write_json(service_artifact, result["service_regression"])
            result["service_regression_artifact"] = str(service_artifact)
            if not result["service_regression"].get("ok"):
                result["errors"].append(
                    {
                        "stage": "service_regression",
                        "message": f"Service API returned HTTP {result['service_regression'].get('status')}",
                    }
                )

    result["ok"] = not result["errors"]
    return result


def run_dependency_install_stage(
    *,
    client: DifyConsoleClient,
    app_id: str,
    import_result: dict[str, Any],
    args: argparse.Namespace,
) -> dict[str, Any]:
    dependencies_before = import_result.get("dependencies")
    if dependencies_before is None:
        try:
            dependencies_before = client.check_dependencies(app_id)
        except ConsoleApiError as exc:
            return {
                "dependencies_before": None,
                "install": None,
                "dependencies_after": None,
                "remaining_leaked_count": None,
                "errors": [console_error_to_dict("check_dependencies", exc)],
                "ok": False,
            }

    install_result = run_install_dependencies_sequence(
        client,
        dependencies_before,
        wait=not args.no_wait_plugin_install,
        timeout_seconds=args.plugin_install_timeout_seconds,
        poll_interval_seconds=args.plugin_install_poll_interval_seconds,
    )

    dependencies_after = None
    errors: list[dict[str, Any]] = []
    try:
        dependencies_after = client.check_dependencies(app_id)
    except ConsoleApiError as exc:
        errors.append(console_error_to_dict("check_dependencies_after_install", exc))

    remaining = len(extract_leaked_dependencies(dependencies_after))
    return {
        "dependencies_before": dependencies_before,
        "install": install_result,
        "dependencies_after": dependencies_after,
        "remaining_leaked_count": remaining,
        "errors": errors,
        "ok": install_result.get("ok") and not errors and remaining == 0,
    }


def run_repair(
    *,
    run_dir: Path,
    yaml_file: Path,
    output_yaml: Path,
    report_output: Path,
    model: str,
    max_repairs: int,
    normalize_shape: bool,
    normalize_dependencies: bool,
    repair_backend: str,
) -> dict[str, Any]:
    context = load_generation_context(run_dir)
    plugin_evidence = context["plugin_evidence"] if isinstance(context["plugin_evidence"], dict) else {}
    evidence_args = argparse.Namespace(
        run_dir=run_dir,
        import_report=None,
        runtime_report=None,
        run_detail=None,
        node_executions=None,
    )
    runtime_evidence = load_runtime_evidence(evidence_args)

    final_yaml = yaml_file.read_text()
    final_report = validate_yaml_text(final_yaml).to_dict()
    attempts: list[dict[str, Any]] = []

    if repair_backend in {"auto", "deterministic"}:
        repaired_yaml, deterministic_report = deterministic_repair_yaml_text(
            final_yaml,
            validation=final_report,
            runtime_evidence=runtime_evidence,
        )
        if deterministic_report.get("changed"):
            final_yaml = repaired_yaml
            shape_normalization_report = {"changed": False, "fixes": [], "errors": []}
            if normalize_shape:
                final_yaml, shape_normalization_report = normalize_shape_yaml_text(final_yaml)
            normalization_report = {"changed": False, "added": [], "skipped": [], "errors": []}
            if normalize_dependencies:
                final_yaml, normalization_report = normalize_yaml_text(final_yaml, plugin_evidence)
            output_yaml.write_text(final_yaml)
            shape_normalization_report_path = output_yaml.with_name(f"{output_yaml.stem}.shape_normalization.deterministic.json")
            normalization_report_path = output_yaml.with_name(f"{output_yaml.stem}.dependency_normalization.deterministic.json")
            write_json(shape_normalization_report_path, shape_normalization_report)
            write_json(normalization_report_path, normalization_report)
            final_report = validate_yaml_text(final_yaml).to_dict()
            report = {
                "skipped": False,
                "backend": "deterministic",
                "input_yaml": str(yaml_file),
                "output_yaml": str(output_yaml),
                "deterministic_report": deterministic_report,
                "shape_normalization_report": str(shape_normalization_report_path),
                "shape_normalization_fix_count": len(shape_normalization_report.get("fixes", []))
                if isinstance(shape_normalization_report.get("fixes"), list)
                else 0,
                "dependency_normalization_report": str(normalization_report_path),
                "dependency_normalization_added": normalization_report.get("added", []),
                "final_validation": final_report,
                "runtime_evidence_keys": sorted(runtime_evidence.keys()),
            }
            write_json(report_output, report)
            return report
        if repair_backend == "deterministic":
            return {
                "skipped": True,
                "backend": "deterministic",
                "reason": "No deterministic repair matched the evidence.",
                "input_yaml": str(yaml_file),
                "deterministic_report": deterministic_report,
            }

    if not os.environ.get("OPENAI_API_KEY"):
        return {
            "skipped": True,
            "backend": "llm",
            "reason": "OPENAI_API_KEY is required for LLM runtime repair.",
            "input_yaml": str(yaml_file),
        }

    client = OpenAI()

    for attempt in range(1, max_repairs + 1):
        final_yaml = repair_yaml(
            client=client,
            model=model,
            request=str(context["request"]),
            plan=context["plan"] if isinstance(context["plan"], dict) else {},
            plugin_evidence=plugin_evidence,
            source_context=context["source_context"] if isinstance(context["source_context"], dict) else {},
            yaml_text=final_yaml,
            validation=final_report,
            runtime_evidence=runtime_evidence,
        )
        shape_normalization_report = {"changed": False, "fixes": [], "errors": []}
        if normalize_shape:
            final_yaml, shape_normalization_report = normalize_shape_yaml_text(final_yaml)
        normalization_report = {"changed": False, "added": [], "skipped": [], "errors": []}
        if normalize_dependencies:
            final_yaml, normalization_report = normalize_yaml_text(final_yaml, plugin_evidence)
        attempt_yaml = output_yaml.with_name(f"{output_yaml.stem}.attempt{attempt}{output_yaml.suffix}")
        attempt_yaml.write_text(final_yaml)
        shape_normalization_report_path = output_yaml.with_name(f"{output_yaml.stem}.shape_normalization.attempt{attempt}.json")
        normalization_report_path = output_yaml.with_name(f"{output_yaml.stem}.dependency_normalization.attempt{attempt}.json")
        write_json(shape_normalization_report_path, shape_normalization_report)
        write_json(normalization_report_path, normalization_report)
        final_report = validate_yaml_text(final_yaml).to_dict()
        attempts.append(
            {
                "attempt": attempt,
                "yaml_file": str(attempt_yaml),
                "shape_normalization_report": str(shape_normalization_report_path),
                "shape_normalization_fix_count": len(shape_normalization_report.get("fixes", []))
                if isinstance(shape_normalization_report.get("fixes"), list)
                else 0,
                "dependency_normalization_report": str(normalization_report_path),
                "dependency_normalization_added": normalization_report.get("added", []),
                "valid": final_report.get("valid"),
            }
        )
        if final_report.get("valid"):
            break

    output_yaml.write_text(final_yaml)
    report = {
        "skipped": False,
        "backend": "llm",
        "input_yaml": str(yaml_file),
        "output_yaml": str(output_yaml),
        "attempts": attempts,
        "final_validation": final_report,
        "runtime_evidence_keys": sorted(runtime_evidence.keys()),
    }
    write_json(report_output, report)
    return report


def build_client(args: argparse.Namespace) -> DifyConsoleClient:
    return DifyConsoleClient(
        console_base=args.console_base,
        bearer_token=args.bearer_token,
        csrf_token=args.csrf_token,
        cookie_jar_path=args.cookie_jar,
    )


def run(args: argparse.Namespace) -> int:
    run_dir = args.run_dir
    run_dir.mkdir(parents=True, exist_ok=True)
    mode = resolve_mode(run_dir, args.mode)
    client = build_client(args)

    yaml_file = args.yaml_file or run_dir / "generated.yml"
    app_id = args.app_id
    summary: dict[str, Any] = {
        "run_dir": str(run_dir),
        "mode": mode,
        "started_yaml": str(yaml_file),
        "final_yaml": str(yaml_file),
        "app_id": app_id,
        "status": "running",
        "iterations": [],
    }

    inputs = parse_json_arg(args.inputs, {})
    files = parse_json_arg(args.files, None)

    for iteration in range(1, args.max_loops + 1):
        record: dict[str, Any] = {
            "iteration": iteration,
            "yaml_file": str(yaml_file),
            "app_id_before": app_id,
        }
        yaml_file, shape_record = normalize_shape_artifact(
            run_dir=run_dir,
            yaml_file=yaml_file,
            iteration=iteration,
            enabled=not args.no_normalize_shape,
        )
        record["shape_normalization"] = shape_record

        pre_validation = validate_yaml_text(yaml_file.read_text()).to_dict()
        pre_validation_path = run_dir / f"validation.loop{iteration}.json"
        write_json(pre_validation_path, pre_validation)
        record["pre_validation"] = {
            "artifact": str(pre_validation_path),
            "valid": pre_validation.get("valid"),
            "errors": [issue for issue in pre_validation.get("issues", []) if issue.get("severity") == "error"]
            if isinstance(pre_validation.get("issues"), list)
            else [],
        }
        if not pre_validation.get("valid"):
            if args.no_repair:
                record["repair"] = {"skipped": True, "reason": "--no-repair was set"}
                summary["iterations"].append(record)
                summary["status"] = "validation_failed"
                break
            if args.repair_backend in {"auto", "deterministic"}:
                repaired_yaml, deterministic_report = deterministic_repair_yaml_text(
                    yaml_file.read_text(),
                    validation=pre_validation,
                    runtime_evidence={},
                )
                pre_repair_path = run_dir / f"generated.loop{iteration}.validation_repair.yml"
                pre_repair_report_path = run_dir / f"validation_repair.loop{iteration}.json"
                pre_repair_path.write_text(repaired_yaml)
                write_json(pre_repair_report_path, deterministic_report)
                record["pre_validation_repair"] = {
                    "backend": "deterministic",
                    "artifact": str(pre_repair_report_path),
                    "output_yaml": str(pre_repair_path),
                    "changed": deterministic_report.get("changed"),
                    "final_valid": (deterministic_report.get("final_validation") or {}).get("valid")
                    if isinstance(deterministic_report.get("final_validation"), dict)
                    else None,
                    "fixes": deterministic_report.get("fixes", []),
                }
                if deterministic_report.get("changed") and (deterministic_report.get("final_validation") or {}).get("valid"):
                    yaml_file = pre_repair_path
                    summary["final_yaml"] = str(yaml_file)
                else:
                    summary["iterations"].append(record)
                    summary["status"] = "validation_failed"
                    break
            else:
                record["pre_validation_repair"] = {
                    "skipped": True,
                    "reason": "pre-import validation repair currently requires --repair-backend auto or deterministic",
                }
                summary["iterations"].append(record)
                summary["status"] = "validation_failed"
                break

        record["import_yaml_file"] = str(yaml_file)

        import_result = run_import_debug_sequence(
            client,
            yaml_file=yaml_file,
            app_id=app_id,
            name=args.name,
            confirm=not args.no_confirm,
            skip_dependencies=args.skip_dependencies,
        )
        import_path = copy_json_artifact(run_dir, "console_import.json", f"console_import.loop{iteration}.json", import_result)
        app_id = import_result.get("app_id") or app_id
        record["import"] = {
            "artifact": str(import_path),
            "ok": import_result.get("ok"),
            "app_id": app_id,
            "errors": import_result.get("errors", []),
        }

        if not import_result.get("ok"):
            if args.no_repair:
                record["repair"] = {"skipped": True, "reason": "--no-repair was set"}
                summary["iterations"].append(record)
                summary["status"] = "import_failed"
                break
            repair_output = run_dir / f"generated.loop{iteration}.runtime_repair.yml"
            repair_report = run_dir / f"runtime_repair.loop{iteration}.json"
            record["repair"] = run_repair(
                run_dir=run_dir,
                yaml_file=yaml_file,
                output_yaml=repair_output,
                report_output=repair_report,
                model=args.repair_model,
                max_repairs=args.repair_attempts,
                normalize_shape=not args.no_normalize_shape,
                normalize_dependencies=not args.no_normalize_dependencies,
                repair_backend=args.repair_backend,
            )
            summary["iterations"].append(record)
            if record["repair"].get("skipped"):
                summary["status"] = "import_failed_repair_skipped"
                break
            yaml_file = repair_output
            summary["final_yaml"] = str(yaml_file)
            continue

        if not app_id:
            record["draft"] = {"skipped": True, "reason": "No app_id returned from import."}
            summary["iterations"].append(record)
            summary["status"] = "imported_without_app_id"
            break

        if args.install_missing_dependencies and not args.skip_dependencies:
            dependency_install = run_dependency_install_stage(
                client=client,
                app_id=str(app_id),
                import_result=import_result,
                args=args,
            )
            dependency_install_path = run_dir / f"dependency_install.loop{iteration}.json"
            write_json(dependency_install_path, dependency_install)
            record["dependency_install"] = {
                "artifact": str(dependency_install_path),
                "ok": dependency_install.get("ok"),
                "remaining_leaked_count": dependency_install.get("remaining_leaked_count"),
                "errors": dependency_install.get("errors", []),
            }
            if not dependency_install.get("ok"):
                summary["iterations"].append(record)
                summary["status"] = "dependency_install_failed"
                summary["app_id"] = app_id
                summary["final_yaml"] = str(yaml_file)
                break

        debug_result = run_debug_draft_sequence(
            client,
            app_id=str(app_id),
            mode=mode,
            inputs=inputs,
            query=args.query,
            files=files,
            skip_dependencies=args.skip_dependencies,
            skip_run_records=args.skip_run_records,
            include_raw=args.include_raw,
        )
        debug_path = copy_json_artifact(run_dir, "console_draft_run.json", f"console_draft_run.loop{iteration}.json", debug_result)
        record["draft"] = {
            "artifact": str(debug_path),
            "ok": draft_debug_succeeded(debug_result),
            "errors": debug_result.get("errors", []),
            "summary": (debug_result.get("draft_run") or {}).get("summary")
            if isinstance(debug_result.get("draft_run"), dict)
            else None,
        }

        if record["draft"]["ok"]:
            summary["iterations"].append(record)
            summary["status"] = "succeeded"
            summary["app_id"] = app_id
            summary["final_yaml"] = str(yaml_file)
            if (
                args.publish
                or args.enable_api
                or args.create_api_key
                or args.list_api_keys
                or args.export_backup
                or args.service_regression
            ):
                post_success = run_post_success_lifecycle(
                    client=client,
                    run_dir=run_dir,
                    app_id=str(app_id),
                    mode=mode,
                    inputs=inputs,
                    query=args.query,
                    args=args,
                )
                summary["post_success"] = post_success
                post_success_path = run_dir / "post_success_lifecycle.json"
                write_json(post_success_path, post_success)
                summary["post_success_artifact"] = str(post_success_path)
                if not post_success.get("ok"):
                    summary["status"] = "post_success_failed"
            break

        if args.no_repair:
            record["repair"] = {"skipped": True, "reason": "--no-repair was set"}
            summary["iterations"].append(record)
            summary["status"] = "draft_failed"
            break

        repair_output = run_dir / f"generated.loop{iteration}.runtime_repair.yml"
        repair_report = run_dir / f"runtime_repair.loop{iteration}.json"
        record["repair"] = run_repair(
            run_dir=run_dir,
            yaml_file=yaml_file,
            output_yaml=repair_output,
            report_output=repair_report,
            model=args.repair_model,
            max_repairs=args.repair_attempts,
            normalize_shape=not args.no_normalize_shape,
            normalize_dependencies=not args.no_normalize_dependencies,
            repair_backend=args.repair_backend,
        )
        summary["iterations"].append(record)
        if record["repair"].get("skipped"):
            summary["status"] = "draft_failed_repair_skipped"
            break
        yaml_file = repair_output
        summary["final_yaml"] = str(yaml_file)

    else:
        summary["status"] = "max_loops_reached"
        summary["app_id"] = app_id
        summary["final_yaml"] = str(yaml_file)

    report_path = args.output or run_dir / "debug_loop_report.json"
    write_json(report_path, summary)
    print(f"Debug loop report: {report_path}")
    print(f"Status: {summary['status']}")
    print(f"Final YAML: {summary['final_yaml']}")
    if app_id:
        print(f"App ID: {app_id}")
    return 0 if summary["status"] == "succeeded" else 1


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run an import/debug/repair loop for a generated Dify DSL run directory.")
    parser.add_argument("run_dir", type=Path)
    parser.add_argument("--yaml-file", type=Path, help="Defaults to <run_dir>/generated.yml.")
    parser.add_argument("--console-base", default=DEFAULT_CONSOLE_BASE, help="Dify console origin, without /console/api.")
    parser.add_argument("--bearer-token", help="Existing console access token. Cookie login is preferred for CSRF.")
    parser.add_argument("--csrf-token", help="Explicit CSRF token for write requests.")
    parser.add_argument("--cookie-jar", type=Path, default=DEFAULT_COOKIE_JAR)
    parser.add_argument("--app-id", help="Existing app id for overwrite/update imports.")
    parser.add_argument("--name", help="Optional app name for first import.")
    parser.add_argument("--mode", choices=["auto", "workflow", "advanced-chat"], default="auto")
    parser.add_argument("--inputs", default="{}")
    parser.add_argument("--query", default="hello")
    parser.add_argument("--files")
    parser.add_argument("--max-loops", type=int, default=2)
    parser.add_argument("--repair-attempts", type=int, default=1)
    parser.add_argument("--repair-model", default=os.environ.get("OPENAI_MODEL", "gpt-5.5"))
    parser.add_argument("--repair-backend", choices=["auto", "deterministic", "llm"], default="auto")
    parser.add_argument("--no-confirm", action="store_true")
    parser.add_argument("--no-repair", action="store_true")
    parser.add_argument("--no-normalize-shape", action="store_true")
    parser.add_argument("--no-normalize-dependencies", action="store_true")
    parser.add_argument("--skip-dependencies", action="store_true")
    parser.add_argument("--install-missing-dependencies", action="store_true", help="Install leaked plugin dependencies after import and before draft debug.")
    parser.add_argument("--no-wait-plugin-install", action="store_true", help="Start plugin install tasks without waiting for completion.")
    parser.add_argument("--plugin-install-timeout-seconds", type=int, default=180)
    parser.add_argument("--plugin-install-poll-interval-seconds", type=float, default=2.0)
    parser.add_argument("--skip-run-records", action="store_true")
    parser.add_argument("--include-raw", action="store_true")
    parser.add_argument("--publish", action="store_true", help="Publish the workflow after draft debug succeeds.")
    parser.add_argument("--publish-name", help="Optional marked name for publish.")
    parser.add_argument("--publish-comment", help="Optional marked comment for publish.")
    parser.add_argument("--enable-api", action="store_true", help="Enable App Service API after draft debug succeeds.")
    parser.add_argument("--create-api-key", action="store_true", help="Create an App API key after draft debug succeeds.")
    parser.add_argument("--list-api-keys", action="store_true", help="List existing App API keys and use the first token for service regression.")
    parser.add_argument("--export-backup", action="store_true", help="Export a backup DSL after draft debug succeeds.")
    parser.add_argument("--export-include-secret", action="store_true", help="Include secrets in exported backup DSL.")
    parser.add_argument("--service-regression", action="store_true", help="Run the published app through Service API after enabling/providing an API key.")
    parser.add_argument("--service-api-base", help="Dify Service API base. Defaults to <console-base>/v1.")
    parser.add_argument("--service-api-key", help="Existing App API key for Service API regression.")
    parser.add_argument("--service-response-mode", choices=["blocking", "streaming"], default="blocking")
    parser.add_argument("--output", type=Path, help="Defaults to <run_dir>/debug_loop_report.json.")
    return parser.parse_args()


def main() -> int:
    try:
        return run(parse_args())
    except Exception as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
