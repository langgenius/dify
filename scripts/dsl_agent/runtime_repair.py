#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path
from typing import Any

from openai import OpenAI

from dependency_normalizer import normalize_yaml_text
from prompts import RUNTIME_REPAIR_SYSTEM_PROMPT, RUNTIME_REPAIR_USER_TEMPLATE
from shape_normalizer import normalize_shape_yaml_text
from validator import validate_yaml_text


def read_text_if_exists(path: Path | None) -> str | None:
    if path and path.exists():
        return path.read_text()
    return None


def read_json_or_text(path: Path | None, default: Any) -> Any:
    text = read_text_if_exists(path)
    if text is None:
        return default
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return {"raw": text}


def write_json(path: Path, data: Any) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")


def extract_yaml(text: str) -> str:
    stripped = text.strip()
    fenced = re.search(r"```(?:yaml|yml)?\s*(.*?)```", stripped, flags=re.DOTALL | re.IGNORECASE)
    if fenced:
        stripped = fenced.group(1).strip()
    return stripped + "\n"


def chat(
    *,
    client: OpenAI,
    model: str,
    system: str,
    user: str,
    temperature: float = 0.1,
) -> str:
    kwargs: dict[str, Any] = {
        "model": model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
    }
    if not model.startswith("gpt-5"):
        kwargs["temperature"] = temperature
    response = client.chat.completions.create(**kwargs)
    content = response.choices[0].message.content
    if not content:
        raise RuntimeError("Model returned an empty response.")
    return content


def resolve_file(run_dir: Path, explicit: Path | None, default_name: str) -> Path:
    return explicit if explicit else run_dir / default_name


def list_payload_items(value: Any) -> list[dict[str, Any]]:
    if isinstance(value, dict):
        for key in ("data", "items", "node_executions", "workflow_runs"):
            items = value.get(key)
            if isinstance(items, list):
                return [item for item in items if isinstance(item, dict)]
    if isinstance(value, list):
        return [item for item in value if isinstance(item, dict)]
    return []


def extend_unique(items: list[dict[str, Any]], additions: list[dict[str, Any]], *, keys: tuple[str, ...]) -> None:
    seen = {tuple(json.dumps(item.get(key), sort_keys=True, ensure_ascii=False) for key in keys) for item in items}
    for item in additions:
        marker = tuple(json.dumps(item.get(key), sort_keys=True, ensure_ascii=False) for key in keys)
        if marker in seen:
            continue
        seen.add(marker)
        items.append(item)


def summarize_runtime_evidence(evidence: dict[str, Any]) -> dict[str, Any]:
    summary: dict[str, Any] = {
        "workflow_run_id": None,
        "status": None,
        "succeeded": None,
        "failed_nodes": [],
        "errors": [],
    }

    draft = evidence.get("draft_run")
    draft_summary = None
    if isinstance(draft, dict):
        nested_draft = draft.get("draft_run")
        if isinstance(nested_draft, dict) and isinstance(nested_draft.get("summary"), dict):
            draft_summary = nested_draft["summary"]
        elif isinstance(draft.get("summary"), dict):
            draft_summary = draft["summary"]

    if isinstance(draft_summary, dict):
        for key in ("workflow_run_id", "status", "succeeded"):
            if draft_summary.get(key) is not None:
                summary[key] = draft_summary[key]
        failed_nodes = draft_summary.get("failed_nodes")
        if isinstance(failed_nodes, list):
            extend_unique(
                summary["failed_nodes"],
                [item for item in failed_nodes if isinstance(item, dict)],
                keys=("node_id", "node_type", "status", "error"),
            )
        errors = draft_summary.get("errors")
        if isinstance(errors, list):
            extend_unique(
                summary["errors"],
                [item for item in errors if isinstance(item, dict)],
                keys=("event", "node_id", "message"),
            )

    run_detail = evidence.get("run_detail")
    if isinstance(run_detail, dict):
        run_id = run_detail.get("id") or run_detail.get("workflow_run_id")
        if run_id and not summary["workflow_run_id"]:
            summary["workflow_run_id"] = run_id
        status = run_detail.get("status")
        if status and not summary["status"]:
            summary["status"] = status
        error = run_detail.get("error")
        if error:
            extend_unique(
                summary["errors"],
                [{"event": "workflow_run_detail", "message": str(error), "workflow_run_id": run_id}],
                keys=("event", "message", "workflow_run_id"),
            )

    node_failures: list[dict[str, Any]] = []
    for node in list_payload_items(evidence.get("node_executions")):
        status = node.get("status")
        error = node.get("error")
        if not error and status in {None, "succeeded", "partial-succeeded"}:
            continue
        node_failures.append(
            {
                "node_id": node.get("node_id") or node.get("id"),
                "node_type": node.get("node_type"),
                "title": node.get("title"),
                "status": status,
                "error": error,
                "elapsed_time": node.get("elapsed_time"),
            }
        )
    extend_unique(summary["failed_nodes"], node_failures, keys=("node_id", "node_type", "status", "error"))
    extend_unique(
        summary["errors"],
        [
            {
                "event": "node_execution",
                "node_id": node.get("node_id"),
                "node_type": node.get("node_type"),
                "title": node.get("title"),
                "message": str(node.get("error") or node.get("status")),
            }
            for node in node_failures
        ],
        keys=("event", "node_id", "message"),
    )

    if summary["succeeded"] is None and summary["errors"]:
        summary["succeeded"] = False
    return summary


def load_runtime_evidence(args: argparse.Namespace) -> dict[str, Any]:
    run_dir = args.run_dir
    import_report = resolve_file(run_dir, args.import_report, "console_import.json")
    runtime_report = resolve_file(run_dir, args.runtime_report, "console_draft_run.json")
    run_detail = resolve_file(run_dir, args.run_detail, "console_run_detail.json")
    node_executions = resolve_file(run_dir, args.node_executions, "console_node_executions.json")

    evidence = {
        "import": read_json_or_text(import_report, None),
        "draft_run": read_json_or_text(runtime_report, None),
        "run_detail": read_json_or_text(run_detail, None),
        "node_executions": read_json_or_text(node_executions, None),
    }
    draft_run = evidence.get("draft_run")
    if isinstance(draft_run, dict):
        if evidence["run_detail"] is None:
            evidence["run_detail"] = draft_run.get("run_detail")
        if evidence["node_executions"] is None:
            evidence["node_executions"] = draft_run.get("node_executions")
    loaded = {key: value for key, value in evidence.items() if value is not None}
    if not loaded:
        expected_files = [import_report, runtime_report, run_detail, node_executions]
        raise FileNotFoundError(
            "No Console evidence found. Expected at least one of: "
            + ", ".join(str(path) for path in expected_files)
        )
    loaded["summary"] = summarize_runtime_evidence(loaded)
    return loaded


def repair_yaml(
    *,
    client: OpenAI,
    model: str,
    request: str,
    plan: dict[str, Any],
    plugin_evidence: dict[str, Any],
    source_context: dict[str, Any],
    yaml_text: str,
    validation: dict[str, Any],
    runtime_evidence: dict[str, Any],
) -> str:
    content = chat(
        client=client,
        model=model,
        system=RUNTIME_REPAIR_SYSTEM_PROMPT,
        user=RUNTIME_REPAIR_USER_TEMPLATE.format(
            request=request,
            plan_json=json.dumps(plan, ensure_ascii=False, indent=2),
            plugin_json=json.dumps(plugin_evidence, ensure_ascii=False, indent=2),
            source_context_json=json.dumps(source_context, ensure_ascii=False, indent=2),
            validation_json=json.dumps(validation, ensure_ascii=False, indent=2),
            runtime_json=json.dumps(runtime_evidence, ensure_ascii=False, indent=2),
            yaml_text=yaml_text,
        ),
        temperature=0.1,
    )
    return extract_yaml(content)


def default_output_path(run_dir: Path, attempt: int) -> Path:
    return run_dir / f"generated.runtime_repair{attempt}.yml"


def run(args: argparse.Namespace) -> int:
    if not os.environ.get("OPENAI_API_KEY"):
        print("OPENAI_API_KEY is required.", file=sys.stderr)
        return 2

    run_dir = args.run_dir
    yaml_file = resolve_file(run_dir, args.yaml_file, "generated.yml")
    if not yaml_file.exists():
        raise FileNotFoundError(f"YAML file not found: {yaml_file}")

    request = (read_text_if_exists(resolve_file(run_dir, args.request_file, "request.txt")) or "").strip()
    plan = read_json_or_text(resolve_file(run_dir, args.plan_json, "plan.json"), {})
    plugin_evidence = read_json_or_text(resolve_file(run_dir, args.plugin_evidence_json, "plugin_evidence.json"), {})
    plugin_evidence_dict = plugin_evidence if isinstance(plugin_evidence, dict) else {}
    source_context = read_json_or_text(resolve_file(run_dir, args.source_context_json, "source_context.json"), {})
    runtime_evidence = load_runtime_evidence(args)

    client = OpenAI()
    yaml_text = yaml_file.read_text()
    attempts: list[dict[str, Any]] = []
    final_yaml = yaml_text
    final_report = validate_yaml_text(yaml_text).to_dict()

    for attempt in range(1, args.max_repairs + 1):
        final_yaml = repair_yaml(
            client=client,
            model=args.model,
            request=request,
            plan=plan if isinstance(plan, dict) else {},
            plugin_evidence=plugin_evidence_dict,
            source_context=source_context if isinstance(source_context, dict) else {},
            yaml_text=final_yaml,
            validation=final_report,
            runtime_evidence=runtime_evidence,
        )
        shape_normalization_report = {"changed": False, "fixes": [], "errors": []}
        if not args.no_normalize_shape:
            final_yaml, shape_normalization_report = normalize_shape_yaml_text(final_yaml)
        normalization_report = {"changed": False, "added": [], "skipped": [], "errors": []}
        if not args.no_normalize_dependencies:
            final_yaml, normalization_report = normalize_yaml_text(final_yaml, plugin_evidence_dict)
        attempt_yaml_path = default_output_path(run_dir, attempt)
        attempt_yaml_path.write_text(final_yaml)
        final_report = validate_yaml_text(final_yaml).to_dict()
        attempt_report_path = run_dir / f"validation_report.runtime_repair{attempt}.json"
        shape_normalization_report_path = run_dir / f"shape_normalization.runtime_repair{attempt}.json"
        normalization_report_path = run_dir / f"dependency_normalization.runtime_repair{attempt}.json"
        write_json(attempt_report_path, final_report)
        write_json(shape_normalization_report_path, shape_normalization_report)
        write_json(normalization_report_path, normalization_report)
        attempts.append(
            {
                "attempt": attempt,
                "yaml_file": str(attempt_yaml_path),
                "validation_report": str(attempt_report_path),
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

    output_path = args.output or run_dir / "generated.runtime_repair.yml"
    output_path.write_text(final_yaml)
    summary = {
        "input_yaml": str(yaml_file),
        "output_yaml": str(output_path),
        "runtime_evidence_files": {
            "import_report": str(resolve_file(run_dir, args.import_report, "console_import.json")),
            "runtime_report": str(resolve_file(run_dir, args.runtime_report, "console_draft_run.json")),
            "run_detail": str(resolve_file(run_dir, args.run_detail, "console_run_detail.json")),
            "node_executions": str(resolve_file(run_dir, args.node_executions, "console_node_executions.json")),
        },
        "attempts": attempts,
        "final_validation": final_report,
    }
    report_path = args.report_output or run_dir / "runtime_repair_report.json"
    write_json(report_path, summary)

    print(f"Repaired YAML: {output_path}")
    print(f"Runtime repair report: {report_path}")
    print("PASS" if final_report.get("valid") else "FAIL")
    return 0 if final_report.get("valid") else 1


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Repair generated Dify DSL YAML from Console runtime debug evidence.")
    parser.add_argument("run_dir", type=Path, help="Generation run directory containing generated.yml and Console debug JSON.")
    parser.add_argument("--yaml-file", type=Path, help="Defaults to <run_dir>/generated.yml.")
    parser.add_argument("--import-report", type=Path, help="Defaults to <run_dir>/console_import.json if present.")
    parser.add_argument("--runtime-report", type=Path, help="Defaults to <run_dir>/console_draft_run.json.")
    parser.add_argument("--run-detail", type=Path, help="Defaults to <run_dir>/console_run_detail.json if present.")
    parser.add_argument("--node-executions", type=Path, help="Defaults to <run_dir>/console_node_executions.json if present.")
    parser.add_argument("--request-file", type=Path, help="Defaults to <run_dir>/request.txt.")
    parser.add_argument("--plan-json", type=Path, help="Defaults to <run_dir>/plan.json.")
    parser.add_argument("--plugin-evidence-json", type=Path, help="Defaults to <run_dir>/plugin_evidence.json.")
    parser.add_argument("--source-context-json", type=Path, help="Defaults to <run_dir>/source_context.json.")
    parser.add_argument("--output", type=Path, help="Defaults to <run_dir>/generated.runtime_repair.yml.")
    parser.add_argument("--report-output", type=Path, help="Defaults to <run_dir>/runtime_repair_report.json.")
    parser.add_argument("--model", default=os.environ.get("OPENAI_MODEL", "gpt-5.5"))
    parser.add_argument("--max-repairs", type=int, default=2)
    parser.add_argument("--no-normalize-shape", action="store_true")
    parser.add_argument("--no-normalize-dependencies", action="store_true")
    return parser.parse_args()


def main() -> int:
    try:
        return run(parse_args())
    except Exception as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
