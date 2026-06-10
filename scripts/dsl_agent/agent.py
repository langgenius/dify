#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Any

import yaml
from openai import OpenAI

from dependency_normalizer import normalize_yaml_text
from plugin_resolver import PluginResolver
from prompts import (
    PLAN_SYSTEM_PROMPT,
    PLAN_USER_TEMPLATE,
    REPAIR_SYSTEM_PROMPT,
    REPAIR_USER_TEMPLATE,
    SPEC_SYSTEM_PROMPT,
    SPEC_USER_TEMPLATE,
    YAML_SYSTEM_PROMPT,
    YAML_USER_TEMPLATE,
)
from source_context import SourceContextCollector
from shape_normalizer import normalize_shape_yaml_text
from validator import validate_yaml_text


ROOT = Path(__file__).resolve().parents[3]
DEFAULT_OUTPUT_DIR = ROOT / "dify" / "scripts" / "dsl_agent" / "outputs"
PLUGIN_NODE_TYPES = {
    "agent",
    "datasource",
    "document-extractor",
    "knowledge-index",
    "knowledge-retrieval",
    "llm",
    "parameter-extractor",
    "question-classifier",
    "tool",
    "trigger-plugin",
}
PROMPT_STRING_LIMIT = 1200
PROMPT_LIST_LIMIT = 8


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


def chat(
    *,
    client: OpenAI,
    model: str,
    system: str,
    user: str,
    json_mode: bool = False,
    temperature: float = 0.2,
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
    if json_mode:
        kwargs["response_format"] = {"type": "json_object"}
    response = client.chat.completions.create(**kwargs)
    content = response.choices[0].message.content
    if not content:
        raise RuntimeError("Model returned an empty response.")
    return content


def extract_yaml(text: str) -> str:
    stripped = text.strip()
    fenced = re.search(r"```(?:yaml|yml)?\s*(.*?)```", stripped, flags=re.DOTALL | re.IGNORECASE)
    if fenced:
        stripped = fenced.group(1).strip()
    return stripped + "\n"


def generate_plan(client: OpenAI, model: str, request: str) -> dict[str, Any]:
    content = chat(
        client=client,
        model=model,
        system=PLAN_SYSTEM_PROMPT,
        user=PLAN_USER_TEMPLATE.format(request=request),
        json_mode=True,
        temperature=0.1,
    )
    try:
        plan = json.loads(content)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"Planner did not return valid JSON: {exc}\n{content}") from exc
    if not isinstance(plan, dict):
        raise RuntimeError("Planner JSON must be an object.")
    return plan


def generate_yaml(
    *,
    client: OpenAI,
    model: str,
    request: str,
    plan: dict[str, Any],
    plugin_evidence: dict[str, Any],
    source_context: dict[str, Any],
) -> str:
    content = chat(
        client=client,
        model=model,
        system=YAML_SYSTEM_PROMPT,
        user=YAML_USER_TEMPLATE.format(
            request=request,
            plan_json=json.dumps(plan, ensure_ascii=False, indent=2),
            plugin_json=json.dumps(plugin_evidence, ensure_ascii=False, indent=2),
            source_context_json=json.dumps(source_context, ensure_ascii=False, indent=2),
        ),
        temperature=0.2,
    )
    return extract_yaml(content)


def generate_spec(
    *,
    client: OpenAI,
    model: str,
    request: str,
    plan: dict[str, Any],
    plugin_evidence: dict[str, Any],
    source_context: dict[str, Any],
) -> str:
    content = chat(
        client=client,
        model=model,
        system=SPEC_SYSTEM_PROMPT,
        user=SPEC_USER_TEMPLATE.format(
            request=request,
            plan_json=json.dumps(plan, ensure_ascii=False, indent=2),
            plugin_json=json.dumps(plugin_evidence, ensure_ascii=False, indent=2),
            source_context_json=json.dumps(source_context, ensure_ascii=False, indent=2),
        ),
        temperature=0.15,
    )
    return extract_yaml(content)


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


def planned_node_types(plan: dict[str, Any]) -> set[str]:
    graph_plan = plan.get("graph_plan")
    if not isinstance(graph_plan, dict):
        return set()
    nodes = graph_plan.get("nodes")
    if not isinstance(nodes, list):
        return set()
    return {str(node.get("type")) for node in nodes if isinstance(node, dict) and node.get("type")}


def plan_needs_plugin_evidence(plan: dict[str, Any]) -> bool:
    requirements = plan.get("requirements")
    requirements = requirements if isinstance(requirements, dict) else {}
    explicit_needs = []
    for key in ("needs_plugins", "needs_triggers"):
        value = requirements.get(key)
        if isinstance(value, list):
            explicit_needs.extend(item for item in value if item)
    return bool(explicit_needs or (planned_node_types(plan) & PLUGIN_NODE_TYPES))


def truncate_prompt_value(value: Any, *, string_limit: int = PROMPT_STRING_LIMIT, list_limit: int = PROMPT_LIST_LIMIT) -> Any:
    if isinstance(value, str):
        if len(value) <= string_limit:
            return value
        return value[:string_limit] + "\n... [truncated for prompt] ..."
    if isinstance(value, list):
        return [truncate_prompt_value(item, string_limit=string_limit, list_limit=list_limit) for item in value[:list_limit]]
    if isinstance(value, dict):
        return {key: truncate_prompt_value(item, string_limit=string_limit, list_limit=list_limit) for key, item in value.items()}
    return value


def compact_candidate(candidate: Any) -> dict[str, Any]:
    if not isinstance(candidate, dict):
        return {}
    keep_keys = (
        "source",
        "kind",
        "name",
        "author",
        "version",
        "plugin_id",
        "package_identity",
        "minimum_dify_version",
        "label",
        "description",
        "provider_id",
        "provider_name",
        "provider_refs",
        "tools",
        "events",
        "models",
        "dependencies",
        "exact_dependency_evidence",
        "credential_requirements",
        "oauth_scopes",
        "resource",
        "score",
    )
    compact = {key: candidate.get(key) for key in keep_keys if key in candidate}
    docs = candidate.get("docs")
    if isinstance(docs, list):
        compact["docs"] = [
            {
                key: truncate_prompt_value(doc.get(key), string_limit=320, list_limit=3)
                for key in ("path", "title", "excerpt", "summary")
                if isinstance(doc, dict) and doc.get(key)
            }
            for doc in docs[:3]
            if isinstance(doc, dict)
        ]
    groups = compact.get("credential_requirements")
    if isinstance(groups, list):
        compact["credential_requirements"] = [
            {
                "name": group.get("name"),
                "fields": [
                    {
                        "name": field.get("name"),
                        "type": field.get("type"),
                        "required": field.get("required", False),
                        "label": truncate_prompt_value(field.get("label"), string_limit=120, list_limit=2),
                    }
                    for field in (group.get("fields") or [])[:8]
                    if isinstance(field, dict) and field.get("name")
                ],
            }
            for group in groups[:4]
            if isinstance(group, dict)
        ]
    return truncate_prompt_value(compact)


def compact_plugin_evidence_for_prompt(plugin_evidence: dict[str, Any], plan: dict[str, Any]) -> dict[str, Any]:
    if not plan_needs_plugin_evidence(plan):
        return {
            "resolution_policy": plugin_evidence.get("resolution_policy", []),
            "official_candidates": [],
            "model_provider_candidates": [],
            "extracted_template_candidates": [],
            "official_template_links": [],
            "pruned_reason": "Plan uses only native non-plugin workflow nodes.",
        }

    extracted = [
        item
        for item in plugin_evidence.get("extracted_template_candidates", [])
        if isinstance(item, dict)
    ][:PROMPT_LIST_LIMIT]
    linked_ids = {
        str(link.get("official_plugin_id"))
        for link in plugin_evidence.get("official_template_links", [])
        if isinstance(link, dict) and link.get("official_plugin_id")
    }
    official_candidates = [
        candidate
        for candidate in plugin_evidence.get("official_candidates", [])
        if isinstance(candidate, dict)
    ]
    strong_official = [
        candidate
        for candidate in official_candidates
        if int(candidate.get("score") or 0) >= 10 or str(candidate.get("plugin_id") or "") in linked_ids
    ]
    if len(strong_official) < 2:
        strong_official = official_candidates[:4]

    return {
        "resolution_policy": plugin_evidence.get("resolution_policy", []),
        "official_candidates": [
            compact_candidate(candidate)
            for candidate in strong_official[:PROMPT_LIST_LIMIT]
        ][:PROMPT_LIST_LIMIT],
        "model_provider_candidates": [
            compact_candidate(candidate)
            for candidate in plugin_evidence.get("model_provider_candidates", [])
            if isinstance(candidate, dict)
        ][:4],
        "extracted_template_candidates": truncate_prompt_value(
            extracted,
            string_limit=1000,
            list_limit=PROMPT_LIST_LIMIT,
        ),
        "official_template_links": truncate_prompt_value(
            plugin_evidence.get("official_template_links", []),
            string_limit=800,
            list_limit=PROMPT_LIST_LIMIT,
        ),
        "pruned_reason": "Prompt evidence is compacted; full evidence remains in plugin_evidence.json.",
    }


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
) -> str:
    content = chat(
        client=client,
        model=model,
        system=REPAIR_SYSTEM_PROMPT,
        user=REPAIR_USER_TEMPLATE.format(
            request=request,
            plan_json=json.dumps(plan, ensure_ascii=False, indent=2),
            plugin_json=json.dumps(plugin_evidence, ensure_ascii=False, indent=2),
            source_context_json=json.dumps(source_context, ensure_ascii=False, indent=2),
            validation_json=json.dumps(validation, ensure_ascii=False, indent=2),
            yaml_text=yaml_text,
        ),
        temperature=0.1,
    )
    return extract_yaml(content)


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
