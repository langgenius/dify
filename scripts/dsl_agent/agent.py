#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Any

import yaml
from openai import OpenAI

# The reusable generation logic and the deterministic passes now live in the
# `core.dsl_agent` package under the Dify api app, so the CLI and the api
# service share one implementation. Put the api dir on the path so this script
# keeps running standalone (`python3 dify/scripts/dsl_agent/agent.py ...`).
_API_DIR = Path(__file__).resolve().parents[2] / "api"
if str(_API_DIR) not in sys.path:
    sys.path.insert(0, str(_API_DIR))

from core.dsl_agent.dependency_normalizer import normalize_yaml_text  # noqa: E402
from core.dsl_agent.generation import (  # noqa: E402
    PLUGIN_NODE_TYPES,
    compact_plugin_evidence_for_prompt,
    generate_plan,
    generate_spec,
    generate_yaml,
    plan_needs_plugin_evidence,
    repair_yaml,
)
from core.dsl_agent.plugin_resolver import PluginResolver  # noqa: E402
from core.dsl_agent.shape_normalizer import normalize_shape_yaml_text  # noqa: E402
from core.dsl_agent.source_context import SourceContextCollector  # noqa: E402
from core.dsl_agent.validator import validate_yaml_text  # noqa: E402

# Re-exported for callers/tests that historically imported them from `agent`.
__all__ = [
    "PLUGIN_NODE_TYPES",
    "compact_plugin_evidence_for_prompt",
    "plan_needs_plugin_evidence",
    "main",
    "run",
]


ROOT = Path(__file__).resolve().parents[3]
DEFAULT_OUTPUT_DIR = ROOT / "dify" / "scripts" / "dsl_agent" / "outputs"


def read_request(args: argparse.Namespace) -> str:
    if args.request_file:
        return args.request_file.read_text().strip()
    if args.request:
        return args.request.strip()
    raise ValueError("Provide a request string or --request-file.")


def write_json(path: Path, data: Any) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2))


def append_stage_timing(run_dir: Path, timings: list[dict[str, Any]], stage: str, started: float) -> None:
    elapsed = round(time.perf_counter() - started, 3)
    timings.append({"stage": stage, "elapsed_seconds": elapsed})
    write_json(run_dir / "stage_timings.json", timings)
    print(f"[dsl-agent] {stage}: {elapsed}s", flush=True)


def compile_spec_text(spec_text: str, template_base_dir: Path) -> str:
    dsl_generator_dir = ROOT / "dify" / "scripts" / "dsl_generator"
    if str(dsl_generator_dir) not in sys.path:
        sys.path.append(str(dsl_generator_dir))
    from generate_dify_dsl import SpecValidationError, compile_spec

    raw = yaml.safe_load(spec_text)
    if not isinstance(raw, dict):
        raise SpecValidationError("Generated spec must be a YAML mapping.")
    compiled = compile_spec(raw, template_base_dir=template_base_dir)
    return yaml.safe_dump(compiled, sort_keys=False, allow_unicode=True)


def write_setup(run_dir: Path, mode: str | None) -> None:
    mode_text = mode or "workflow"
    setup = f"""# Manual Import And Debug

1. Import `generated.yml` manually in Dify.
2. Configure missing model/plugin credentials in Dify.
3. Publish or run the app and copy the app API endpoint and API key.
4. Use the runner after import:

```bash
python3 dify/scripts/dsl_agent/run_dify_app.py \\
  --mode {mode_text} \\
  --api-base https://YOUR_DIFY_HOST/v1 \\
  --api-key YOUR_APP_API_KEY \\
  --inputs '{{}}'
```

For chatflows, add `--query "hello"` and use `--mode advanced-chat`.

The default product boundary is still manual import, but this run directory also
includes `console_debug_plan.md` for internal Console API debugging.
"""
    (run_dir / "setup.md").write_text(setup)


def write_console_debug_plan(run_dir: Path, mode: str | None) -> None:
    mode_text = mode or "workflow"
    draft_command = (
        "debug-draft APP_ID --mode advanced-chat --query 'hello' --inputs '{}'"
        if mode_text == "advanced-chat"
        else "debug-draft APP_ID --mode workflow --inputs '{}'"
    )
    plan = f"""# Console API Debug Plan

Use this only against a Dify instance where you have Console credentials.
The generated DSL remains at `generated.yml`.

## 1. Login

```bash
python3 dify/scripts/dsl_agent/console_lifecycle.py \\
  --console-base http://localhost \\
  login \\
  --email you@example.com \\
  --password 'YOUR_PASSWORD'
```

## 2. Optional Import

For a one-command internal loop:

```bash
python3 dify/scripts/dsl_agent/debug_loop.py \\
  {run_dir} \\
  --console-base http://localhost \\
  --mode {mode_text} \\
  --inputs '{{}}' \\
  --install-missing-dependencies
```

For a full internal lifecycle after model/plugin credentials are configured:

```bash
python3 dify/scripts/dsl_agent/debug_loop.py \\
  {run_dir} \\
  --console-base http://localhost \\
  --mode {mode_text} \\
  --inputs '{{}}' \\
  --install-missing-dependencies \\
  --publish \\
  --enable-api \\
  --create-api-key \\
  --export-backup \\
  --service-regression
```

For manual step-by-step import:

```bash
python3 dify/scripts/dsl_agent/console_lifecycle.py \\
  --console-base http://localhost \\
  import-debug {run_dir / "generated.yml"} \\
  --confirm \\
  --output {run_dir / "console_import.json"}
```

Copy the returned `app_id` into the commands below.

## 3. Check Dependencies

```bash
python3 dify/scripts/dsl_agent/console_lifecycle.py \\
  --console-base http://localhost \\
  check-dependencies APP_ID
```

To install missing plugin dependencies from the check result:

```bash
python3 dify/scripts/dsl_agent/console_lifecycle.py \\
  --console-base http://localhost \\
  install-missing-dependencies APP_ID
```

## 4. Run Draft Debug Sequence

```bash
python3 dify/scripts/dsl_agent/console_lifecycle.py \\
  --console-base http://localhost \\
  {draft_command} \\
  --output {run_dir / "console_draft_run.json"}
```

The debug output contains dependency check results, parsed draft-run events,
`draft_run.summary.errors`, `draft_run.summary.failed_nodes`,
`draft_run.summary.workflow_run_id`, and run records when available.

## 5. Repair From Runtime Evidence

```bash
python3 dify/scripts/dsl_agent/runtime_repair.py \\
  {run_dir}
```

This reads `console_import.json` and/or `console_draft_run.json`, then writes
`generated.runtime_repair.yml` and `runtime_repair_report.json`.
If a repair file is produced, rerun step 2 with `generated.runtime_repair.yml`.

## 6. Fetch Full Run Records

```bash
python3 dify/scripts/dsl_agent/console_lifecycle.py \\
  --console-base http://localhost \\
  workflow-run-detail APP_ID WORKFLOW_RUN_ID \\
  --output {run_dir / "console_run_detail.json"}

python3 dify/scripts/dsl_agent/console_lifecycle.py \\
  --console-base http://localhost \\
  workflow-run-node-executions APP_ID WORKFLOW_RUN_ID \\
  --output {run_dir / "console_node_executions.json"}
```

## 7. Publish And Expose Service API

```bash
python3 dify/scripts/dsl_agent/console_lifecycle.py --console-base http://localhost publish APP_ID
python3 dify/scripts/dsl_agent/console_lifecycle.py --console-base http://localhost api-enable APP_ID
python3 dify/scripts/dsl_agent/console_lifecycle.py --console-base http://localhost api-key APP_ID
python3 dify/scripts/dsl_agent/console_lifecycle.py --console-base http://localhost export APP_ID --output {run_dir / "exported.yml"}
```
"""
    (run_dir / "console_debug_plan.md").write_text(plan)


def run(args: argparse.Namespace) -> int:
    request = read_request(args)
    run_id = args.run_id or datetime.now().strftime("%Y%m%d_%H%M%S")
    run_dir = args.output_dir / run_id
    run_dir.mkdir(parents=True, exist_ok=True)
    stage_timings: list[dict[str, Any]] = []

    (run_dir / "request.txt").write_text(request)

    started = time.perf_counter()
    plugin_evidence = PluginResolver().resolve(request, limit=args.plugin_limit)
    write_json(run_dir / "plugin_evidence.json", plugin_evidence)
    append_stage_timing(run_dir, stage_timings, "plugin_evidence", started)

    if args.plugin_evidence_only:
        print(run_dir / "plugin_evidence.json")
        return 0

    if not os.environ.get("OPENAI_API_KEY"):
        print("OPENAI_API_KEY is required unless --plugin-evidence-only is used.", file=sys.stderr)
        return 2

    client = OpenAI(timeout=args.openai_timeout_seconds)
    started = time.perf_counter()
    plan = generate_plan(client, args.model, request)
    write_json(run_dir / "plan.json", plan)
    append_stage_timing(run_dir, stage_timings, "plan", started)
    started = time.perf_counter()
    prompt_plugin_evidence = compact_plugin_evidence_for_prompt(plugin_evidence, plan)
    write_json(run_dir / "prompt_plugin_evidence.json", prompt_plugin_evidence)
    append_stage_timing(run_dir, stage_timings, "prompt_evidence", started)
    started = time.perf_counter()
    source_context = SourceContextCollector().collect(plan)
    write_json(run_dir / "source_context.json", source_context)
    append_stage_timing(run_dir, stage_timings, "source_context", started)

    if args.backend == "spec-compiler":
        started = time.perf_counter()
        spec_text = generate_spec(
            client=client,
            model=args.model,
            request=request,
            plan=plan,
            plugin_evidence=prompt_plugin_evidence,
            source_context=source_context,
        )
        (run_dir / "generated_spec.yml").write_text(spec_text)
        yaml_text = compile_spec_text(spec_text, template_base_dir=run_dir)
        append_stage_timing(run_dir, stage_timings, "spec_generation", started)
    else:
        started = time.perf_counter()
        yaml_text = generate_yaml(
            client=client,
            model=args.model,
            request=request,
            plan=plan,
            plugin_evidence=prompt_plugin_evidence,
            source_context=source_context,
        )
        append_stage_timing(run_dir, stage_timings, "yaml_generation", started)

    attempt = 0
    while True:
        started = time.perf_counter()
        shape_normalization_report = {"changed": False, "fixes": [], "errors": []}
        if not args.no_normalize_shape:
            yaml_text, shape_normalization_report = normalize_shape_yaml_text(yaml_text)

        normalization_report = {"changed": False, "skipped": [], "errors": []}
        if not args.no_normalize_dependencies:
            yaml_text, normalization_report = normalize_yaml_text(yaml_text, plugin_evidence)

        yaml_path = run_dir / ("generated.yml" if attempt == 0 else f"generated.repair{attempt}.yml")
        yaml_path.write_text(yaml_text)
        write_json(
            run_dir / ("shape_normalization_report.json" if attempt == 0 else f"shape_normalization_report.repair{attempt}.json"),
            shape_normalization_report,
        )
        write_json(
            run_dir / ("dependency_normalization_report.json" if attempt == 0 else f"dependency_normalization_report.repair{attempt}.json"),
            normalization_report,
        )
        report = validate_yaml_text(yaml_text)
        report_dict = report.to_dict()
        write_json(run_dir / ("validation_report.json" if attempt == 0 else f"validation_report.repair{attempt}.json"), report_dict)
        append_stage_timing(run_dir, stage_timings, f"normalize_validate_attempt_{attempt}", started)

        if report.valid:
            (run_dir / "generated.yml").write_text(yaml_text)
            write_json(run_dir / "shape_normalization_report.json", shape_normalization_report)
            write_json(run_dir / "dependency_normalization_report.json", normalization_report)
            write_json(run_dir / "validation_report.json", report_dict)
            break

        if attempt >= args.max_repairs:
            (run_dir / "generated.yml").write_text(yaml_text)
            write_json(run_dir / "shape_normalization_report.json", shape_normalization_report)
            write_json(run_dir / "dependency_normalization_report.json", normalization_report)
            write_json(run_dir / "validation_report.json", report_dict)
            break

        attempt += 1
        started = time.perf_counter()
        yaml_text = repair_yaml(
            client=client,
            model=args.model,
            request=request,
            plan=plan,
            plugin_evidence=prompt_plugin_evidence,
            source_context=source_context,
            yaml_text=yaml_text,
            validation=report_dict,
        )
        append_stage_timing(run_dir, stage_timings, f"llm_repair_attempt_{attempt}", started)

    mode = ((plan.get("app") or {}).get("mode") if isinstance(plan.get("app"), dict) else None)
    write_setup(run_dir, mode)
    write_console_debug_plan(run_dir, mode)

    print(f"Run directory: {run_dir}")
    print(f"Generated YAML: {run_dir / 'generated.yml'}")
    print(f"Validation report: {run_dir / 'validation_report.json'}")
    print(f"Console debug plan: {run_dir / 'console_debug_plan.md'}")
    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate Dify DSL YAML with a source-grounded agent.")
    parser.add_argument("request", nargs="?", help="Natural language request.")
    parser.add_argument("--request-file", type=Path)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--run-id")
    parser.add_argument("--model", default=os.environ.get("OPENAI_MODEL", "gpt-5.5"))
    parser.add_argument("--backend", choices=["direct-yaml", "spec-compiler"], default="direct-yaml")
    parser.add_argument("--max-repairs", type=int, default=2)
    parser.add_argument("--plugin-limit", type=int, default=8)
    parser.add_argument("--openai-timeout-seconds", type=float, default=float(os.environ.get("OPENAI_TIMEOUT_SECONDS", "90")))
    parser.add_argument("--plugin-evidence-only", action="store_true")
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
