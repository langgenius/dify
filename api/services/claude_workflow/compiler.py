"""Compile Claude workflow documents into Dify app DSL YAML.

The compiler intentionally emits a narrow subset of Dify workflow DSL that
matches the current Claude workflow schema. It preserves node identifiers,
builds the synthetic Dify start node from top-level inputs, and keeps edge
handles deterministic so the later import service can hand the result directly
to ``AppDslService.import_app()``.
"""

from __future__ import annotations

from typing import cast

import yaml

from .schema import ClaudeWorkflowDocument, CodeNode, EndNode, HttpRequestNode, IfElseNode, LlmNode

DEFAULT_ICON_BACKGROUND = "#FFEAD5"
DEFAULT_VIEWPORT = {"x": 0, "y": 0, "zoom": 0.7}
DEFAULT_TIMEOUT = {"connect": 10, "read": 30, "write": 30}
DEFAULT_RETRY_CONFIG = {
    "enabled": False,
    "max_retries": 1,
    "retry_interval": 1000,
    "exponential_backoff": {"enabled": False, "multiplier": 2, "max_interval": 10000},
}
NODE_WIDTH = 244


def compile_claude_workflow_to_dify_dsl(document: ClaudeWorkflowDocument) -> str:
    """Compile a validated Claude workflow document into Dify workflow YAML."""

    graph_nodes = [_build_start_node(document)]
    graph_nodes.extend(_build_workflow_node(node, index) for index, node in enumerate(document.nodes, start=1))

    payload = {
        "app": {
            "description": document.app.description or "",
            "icon": document.app.icon or "",
            "icon_background": DEFAULT_ICON_BACKGROUND,
            "mode": document.app.mode,
            "name": document.app.name,
            "use_icon_as_answer_icon": False,
        },
        "dependencies": [],
        "kind": "app",
        "version": "0.3.1",
        "workflow": {
            "conversation_variables": [],
            "environment_variables": [],
            "features": _build_workflow_features(),
            "graph": {
                "edges": [_build_edge(edge, document) for edge in document.edges],
                "nodes": graph_nodes,
                "viewport": DEFAULT_VIEWPORT,
            },
        },
    }

    return yaml.safe_dump(payload, sort_keys=False, allow_unicode=True)


def _build_workflow_features() -> dict:
    return {
        "file_upload": {"enabled": False},
        "opening_statement": "",
        "retriever_resource": {"enabled": False},
        "sensitive_word_avoidance": {"enabled": False},
        "speech_to_text": {"enabled": False},
        "suggested_questions": [],
        "suggested_questions_after_answer": {"enabled": False},
        "text_to_speech": {"enabled": False},
    }


def _build_start_node(document: ClaudeWorkflowDocument) -> dict:
    variables = [
        {
            "label": workflow_input.name,
            "max_length": None,
            "options": [],
            "required": workflow_input.required,
            "type": "text-input",
            "variable": workflow_input.name,
        }
        for workflow_input in document.inputs
    ]

    return _graph_node(
        node_id="start",
        title="Start",
        node_type="start",
        data={"desc": "", "selected": False, "title": "Start", "type": "start", "variables": variables},
        x=30,
        y=227,
        height=90,
    )


def _build_workflow_node(node: object, index: int) -> dict:
    x = 30 + (index * 304)
    y = 227

    if isinstance(node, LlmNode):
        data = {
            "desc": "",
            "title": node.title,
            "type": "llm",
            "model": {
                "provider": node.model.provider,
                "name": node.model.name,
                "mode": node.model.mode,
            },
            "prompt_template": [
                {"role": prompt.role, "text": prompt.text or _selector_to_template(prompt.selector.value)}
                for prompt in node.prompt
            ],
            "vision": {"enabled": False, "configs": {"variable_selector": []}},
            "memory": {"enabled": False, "window": {"enabled": False, "size": 50}},
            "context": {"enabled": False, "variable_selector": []},
            "structured_output": {"enabled": False},
            "retry_config": DEFAULT_RETRY_CONFIG,
        }
        return _graph_node(node.id, node.title, "llm", data, x=x, y=y, height=90)

    if isinstance(node, IfElseNode):
        raw_cases = cast(list[dict], node.model_extra.get("cases", []))
        data = {
            "cases": [_build_if_else_case(case, node.id) for case in raw_cases],
            "desc": "",
            "selected": False,
            "title": node.title,
            "type": "if-else",
        }
        return _graph_node(node.id, node.title, "if-else", data, x=x, y=y + 36, height=126)

    if isinstance(node, HttpRequestNode):
        raw_url = node.model_extra.get("url")
        data = {
            "desc": "",
            "title": node.title,
            "type": "http-request",
            "method": str(node.model_extra.get("method", "GET")).upper(),
            "url": _compile_string_or_selector(raw_url),
            "authorization": {"type": "no-auth"},
            "headers": "",
            "params": "",
            "body": {"type": "none", "data": ""},
            "timeout": DEFAULT_TIMEOUT,
            "retry_config": DEFAULT_RETRY_CONFIG,
        }
        return _graph_node(node.id, node.title, "http-request", data, x=x, y=y, height=90)

    if isinstance(node, CodeNode):
        raw_outputs = cast(list[dict], node.model_extra.get("outputs", []))
        raw_inputs = cast(list[dict], node.model_extra.get("inputs", []))
        data = {
            "code": str(node.model_extra.get("source", "")),
            "code_language": str(node.model_extra.get("language", "python3")),
            "desc": "",
            "outputs": {
                output["name"]: {"children": None, "type": output.get("type", "string")}
                for output in raw_outputs
            },
            "selected": False,
            "title": node.title,
            "type": "code",
            "variables": [
                {
                    "value_selector": _selector_parts(input_value["selector"]),
                    "value_type": input_value.get("value_type", "string"),
                    "variable": input_value["name"],
                }
                for input_value in raw_inputs
            ],
        }
        return _graph_node(node.id, node.title, "code", data, x=x, y=y, height=54)

    if isinstance(node, EndNode):
        data = {
            "desc": "",
            "outputs": [
                {
                    "value_selector": list(output.selector.value),
                    "value_type": "string",
                    "variable": output.name,
                }
                for output in node.outputs
            ],
            "selected": False,
            "title": node.title,
            "type": "end",
        }
        return _graph_node(node.id, node.title, "end", data, x=x, y=y, height=90)

    raise TypeError(f"Unsupported node instance: {type(node)!r}")


def _build_if_else_case(raw_case: dict, node_id: str) -> dict:
    case_id = str(raw_case["id"])
    conditions = []

    for index, raw_condition in enumerate(cast(list[dict], raw_case.get("conditions", []))):
        conditions.append(
            {
                "comparison_operator": raw_condition["operator"],
                "id": f"{node_id}-{case_id}-{index}",
                "value": raw_condition["value"],
                "varType": raw_condition.get("value_type", "string"),
                "variable_selector": _selector_parts(raw_condition["selector"]),
            }
        )

    return {
        "case_id": case_id,
        "conditions": conditions,
        "id": case_id,
        "logical_operator": raw_case.get("logical_operator", "and"),
    }


def _build_edge(edge: object, document: ClaudeWorkflowDocument) -> dict:
    source = cast(str, getattr(edge, "source"))
    target = cast(str, getattr(edge, "target"))
    source_handle = cast(str | None, getattr(edge, "source_handle")) or "source"
    target_handle = cast(str | None, getattr(edge, "target_handle")) or "target"
    source_type = _dify_node_type(source, document)
    target_type = _dify_node_type(target, document)

    return {
        "data": {
            "isInIteration": False,
            "isInLoop": False,
            "sourceType": source_type,
            "targetType": target_type,
        },
        "id": f"{source}-{source_handle}-{target}-{target_handle}",
        "source": source,
        "sourceHandle": source_handle,
        "target": target,
        "targetHandle": target_handle,
        "type": "custom",
        "zIndex": 0,
    }


def _dify_node_type(node_id: str, document: ClaudeWorkflowDocument) -> str:
    if node_id == "start":
        return "start"

    node = next(node for node in document.nodes if node.id == node_id)

    if isinstance(node, IfElseNode):
        return "if-else"
    if isinstance(node, HttpRequestNode):
        return "http-request"
    return node.type


def _compile_string_or_selector(raw_value: object) -> str:
    if isinstance(raw_value, dict) and "selector" in raw_value:
        return _selector_to_template(tuple(_selector_parts(raw_value["selector"])))
    if isinstance(raw_value, list):
        return _selector_to_template(tuple(_selector_parts(raw_value)))
    return str(raw_value or "")


def _selector_parts(raw_selector: object) -> list[str]:
    if isinstance(raw_selector, dict):
        raw_selector = raw_selector.get("selector")

    if not isinstance(raw_selector, (list, tuple)) or len(raw_selector) != 2:
        raise ValueError(f"Invalid selector payload: {raw_selector!r}")

    return [str(raw_selector[0]), str(raw_selector[1])]


def _selector_to_template(selector: tuple[str, str]) -> str:
    return f"{{{{#{selector[0]}.{selector[1]}#}}}}"


def _graph_node(node_id: str, title: str, node_type: str, data: dict, *, x: int, y: int, height: int) -> dict:
    return {
        "data": data,
        "height": height,
        "id": node_id,
        "position": {"x": x, "y": y},
        "positionAbsolute": {"x": x, "y": y},
        "selected": False,
        "sourcePosition": "right",
        "targetPosition": "left",
        "type": "custom",
        "width": NODE_WIDTH,
    }
