#!/usr/bin/env python3
from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[3]
DIFY_API_DIR = ROOT / "dify" / "api"
DSL_GENERATOR_DIR = ROOT / "dify" / "scripts" / "dsl_generator"


def ensure_runtime() -> None:
    if sys.version_info < (3, 12):
        raise SystemExit("Graphon schema validation requires Python 3.12+.")
    for site_packages in (DIFY_API_DIR / ".venv" / "lib").glob("python*/site-packages"):
        sys.path.insert(0, str(site_packages))
    sys.path.insert(0, str(DIFY_API_DIR))
    sys.path.insert(0, str(DSL_GENERATOR_DIR))


def load_node_classes() -> dict[str, Any]:
    imports = {
        "start": ("graphon.nodes.start.entities", "StartNodeData"),
        "end": ("graphon.nodes.end.entities", "EndNodeData"),
        "answer": ("graphon.nodes.answer.entities", "AnswerNodeData"),
        "llm": ("graphon.nodes.llm.entities", "LLMNodeData"),
        "code": ("graphon.nodes.code.entities", "CodeNodeData"),
        "template-transform": ("graphon.nodes.template_transform.entities", "TemplateTransformNodeData"),
        "document-extractor": ("graphon.nodes.document_extractor.entities", "DocumentExtractorNodeData"),
        "list-operator": ("graphon.nodes.list_operator.entities", "ListOperatorNodeData"),
        "http-request": ("graphon.nodes.http_request.entities", "HttpRequestNodeData"),
        "if-else": ("graphon.nodes.if_else.entities", "IfElseNodeData"),
        "iteration": ("graphon.nodes.iteration.entities", "IterationNodeData"),
        "iteration-start": ("graphon.nodes.iteration.entities", "IterationStartNodeData"),
        "loop": ("graphon.nodes.loop.entities", "LoopNodeData"),
        "loop-start": ("graphon.nodes.loop.entities", "LoopStartNodeData"),
        "loop-end": ("graphon.nodes.loop.entities", "LoopEndNodeData"),
        "tool": ("graphon.nodes.tool.entities", "ToolNodeData"),
        "question-classifier": ("graphon.nodes.question_classifier.entities", "QuestionClassifierNodeData"),
        "parameter-extractor": ("graphon.nodes.parameter_extractor.entities", "ParameterExtractorNodeData"),
        "human-input": ("graphon.nodes.human_input.entities", "HumanInputNodeData"),
        "agent": ("core.workflow.nodes.agent.entities", "AgentNodeData"),
        "trigger-schedule": ("core.workflow.nodes.trigger_schedule.entities", "TriggerScheduleNodeData"),
        "knowledge-retrieval": ("core.workflow.nodes.knowledge_retrieval.entities", "KnowledgeRetrievalNodeData"),
    }
    classes: dict[str, Any] = {}
    for node_type, (module_name, class_name) in imports.items():
        try:
            module = __import__(module_name, fromlist=[class_name])
            classes[node_type] = getattr(module, class_name)
        except Exception as exc:
            print(f"[WARN] cannot load {node_type} schema: {type(exc).__name__}: {exc}", file=sys.stderr)
    return classes


def load_document(path: Path, *, spec_mode: bool) -> dict[str, Any]:
    import yaml

    raw = yaml.safe_load(path.read_text())
    if not isinstance(raw, dict):
        raise ValueError(f"{path} must be a YAML mapping.")
    if not spec_mode:
        return raw

    from generate_dify_dsl import compile_spec

    return compile_spec(raw, template_base_dir=path.parent)


def validate_document(path: Path, *, spec_mode: bool, classes: dict[str, Any]) -> list[str]:
    document = load_document(path, spec_mode=spec_mode)
    nodes = (((document.get("workflow") or {}).get("graph") or {}).get("nodes") or [])
    errors: list[str] = []
    for index, node in enumerate(nodes):
        if not isinstance(node, dict):
            errors.append(f"{path}: node #{index} is not a mapping")
            continue
        data = node.get("data") or {}
        if not isinstance(data, dict):
            errors.append(f"{path}: node {node.get('id') or index} data is not a mapping")
            continue
        node_type = data.get("type")
        schema = classes.get(str(node_type))
        if not schema:
            continue
        try:
            schema.model_validate(data)
        except Exception as exc:
            errors.append(f"{path}: node {node.get('id') or index} ({node_type}) schema failed: {exc}")
    return errors


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Validate Dify DSL node data with local graphon pydantic schemas.")
    parser.add_argument("files", nargs="+", type=Path)
    parser.add_argument("--spec", action="store_true", help="Treat inputs as simplified compiler specs before validating.")
    return parser.parse_args()


def main() -> int:
    ensure_runtime()
    args = parse_args()
    classes = load_node_classes()
    failures: list[str] = []
    for path in args.files:
        failures.extend(validate_document(path, spec_mode=args.spec, classes=classes))
    if failures:
        for failure in failures:
            print(f"[FAIL] {failure}")
        return 1
    print(f"PASS: graphon schema validation succeeded for {len(args.files)} file(s).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
