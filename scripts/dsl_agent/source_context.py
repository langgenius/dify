#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[3]
DIFY_API_DIR = ROOT / "dify" / "api"


NODE_TYPE_HINTS: dict[str, list[str]] = {
    "start": ["graphon/nodes/start/entities.py"],
    "end": ["graphon/nodes/end/entities.py"],
    "answer": ["graphon/nodes/answer/entities.py"],
    "llm": ["graphon/nodes/llm/entities.py"],
    "code": ["graphon/nodes/code/entities.py"],
    "template-transform": ["graphon/nodes/template_transform/entities.py"],
    "document-extractor": ["graphon/nodes/document_extractor/entities.py"],
    "list-operator": ["graphon/nodes/list_operator/entities.py"],
    "variable-assigner": ["graphon/nodes/variable_assigner"],
    "http-request": ["graphon/nodes/http_request"],
    "if-else": ["graphon/nodes/if_else"],
    "iteration": ["graphon/nodes/iteration"],
    "iteration-start": ["graphon/nodes/iteration"],
    "loop": ["graphon/nodes/loop"],
    "loop-start": ["graphon/nodes/loop"],
    "tool": ["graphon/nodes/tool"],
    "question-classifier": ["graphon/nodes/question_classifier/entities.py"],
    "parameter-extractor": ["graphon/nodes/parameter_extractor/entities.py"],
    "human-input": ["graphon/nodes/human_input/entities.py"],
    "agent": ["api/core/workflow/nodes/agent/entities.py"],
    "trigger-plugin": ["api/core/workflow/nodes/trigger_plugin/entities.py"],
    "trigger-schedule": ["api/core/workflow/nodes/trigger_schedule/entities.py"],
    "trigger-webhook": ["api/core/workflow/nodes/trigger_webhook/entities.py"],
    "knowledge-retrieval": ["api/core/workflow/nodes/knowledge_retrieval/entities.py"],
    "datasource": ["api/core/workflow/nodes/datasource/entities.py"],
    "knowledge-index": ["api/core/workflow/nodes/knowledge_index/entities.py"],
}


def read_text_limited(path: Path, limit: int = 9000) -> str:
    try:
        text = path.read_text(errors="replace")
    except Exception:
        return ""
    if len(text) > limit:
        return text[:limit] + "\n# ... truncated ...\n"
    return text


def find_graphon_roots() -> list[Path]:
    roots: list[Path] = []
    for candidate in DIFY_API_DIR.glob(".venv/lib/python*/site-packages"):
        graphon = candidate / "graphon"
        if graphon.exists():
            roots.append(candidate)
    return roots


def resolve_hint(hint: str) -> list[Path]:
    paths: list[Path] = []
    if hint.startswith("api/"):
        direct = ROOT / "dify" / hint
        if direct.is_file():
            paths.append(direct)
        elif direct.is_dir():
            paths.extend(sorted(direct.glob("**/entities.py"))[:4])
        return paths

    for root in find_graphon_roots():
        direct = root / hint
        if direct.is_file():
            paths.append(direct)
        elif direct.is_dir():
            paths.extend(sorted(direct.glob("**/entities.py"))[:4])
    return paths


def extract_node_types(plan: dict[str, Any]) -> list[str]:
    found: list[str] = []
    graph_plan = plan.get("graph_plan") or {}
    nodes = graph_plan.get("nodes") or []
    if isinstance(nodes, list):
        for node in nodes:
            if isinstance(node, dict) and node.get("type"):
                found.append(str(node["type"]))
    return sorted(set(found))


def extract_current_dsl_facts() -> dict[str, Any]:
    app_dsl = ROOT / "dify" / "api" / "services" / "app_dsl_service.py"
    text = read_text_limited(app_dsl, 14000)
    version_match = re.search(r'CURRENT_DSL_VERSION\s*=\s*"([^"]+)"', text)
    return {
        "app_dsl_service": str(app_dsl),
        "current_app_dsl_version": version_match.group(1) if version_match else None,
        "facts": [
            "App DSL import parses YAML with yaml.safe_load.",
            "If version is absent, app import defaults to legacy 0.1.0.",
            "Imported app DSL version must parse as a string.",
            "Dependencies from top-level dependencies are used for plugin checks when present.",
            "Workflow/advanced-chat app imports require workflow data.",
            "Knowledge retrieval dataset ids may be encrypted in exported DSL.",
            "Tool and agent credential_id fields are stripped from exported DSL when include_secret is false.",
        ],
    }


class SourceContextCollector:
    def collect(self, plan: dict[str, Any]) -> dict[str, Any]:
        node_types = extract_node_types(plan)
        snippets: list[dict[str, Any]] = []
        for node_type in node_types:
            hints = NODE_TYPE_HINTS.get(node_type, [])
            for hint in hints:
                for path in resolve_hint(hint):
                    snippets.append(
                        {
                            "node_type": node_type,
                            "path": str(path),
                            "snippet": read_text_limited(path),
                        }
                    )

        return {
            "source_policy": [
                "Prefer local Dify source over public repo assumptions.",
                "Use snippets as schema evidence, not as code to execute.",
                "When source and plugin evidence conflict, call out uncertainty instead of inventing fields.",
            ],
            "dsl_facts": extract_current_dsl_facts(),
            "node_types": node_types,
            "snippets": snippets,
        }


def main() -> int:
    parser = argparse.ArgumentParser(description="Collect Dify source context for a graph plan JSON.")
    parser.add_argument("plan_json", type=Path)
    args = parser.parse_args()
    plan = json.loads(args.plan_json.read_text())
    result = SourceContextCollector().collect(plan)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
