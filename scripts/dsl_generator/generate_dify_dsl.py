#!/usr/bin/env python3
from __future__ import annotations

import argparse
import copy
import json
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml


ROOT_START_BY_MODE = {
    "workflow": {"x": 30, "y": 227},
    "advanced-chat": {"x": 80, "y": 282},
}
ROOT_X_GAP = 304
CHILD_X_GAP = 304
NODE_WIDTH = 244
DEFAULT_NODE_HEIGHT = 90
CONTAINER_START_POSITION = {"x": 24, "y": 68}
CHILD_START_POSITION = {"x": 128, "y": 68}
CONTAINER_MIN_SIZE = {
    "iteration": {"width": 388, "height": 178},
    "loop": {"width": 388, "height": 225},
}
START_NODE_TYPES = {
    "iteration": "iteration-start",
    "loop": "loop-start",
}
START_NODE_CUSTOM_TYPES = {
    "iteration": "custom-iteration-start",
    "loop": "custom-loop-start",
}
START_NODE_FLAGS = {
    "iteration": {"isInIteration": True},
    "loop": {"isInLoop": True},
}
START_VARIABLE_TYPE_ALIASES = {
    "json": "json_object",
    "object": "json_object",
}
COMPARISON_OPERATOR_ALIASES = {
    "==": "=",
    "!=": "≠",
    ">=": "≥",
    "<=": "≤",
}
TEMPLATES_DIR = Path(__file__).resolve().parent / "templates"
MODEL_REGISTRY_PATH = TEMPLATES_DIR / "models" / "registry.yml"
AUTO_TEMPLATE_TYPES = {"tool", "trigger-plugin"}
TEMPLATE_RESERVED_KEYS = {
    "_app_mode",
    "id",
    "type",
    "template",
    "position",
    "data",
    "width",
    "height",
    "dependencies",
    "dependency",
    "sequence",
    "start_node_id",
    "start_node_data",
    "iterator_selector",
    "iterator_input_type",
    "output_selector",
    "output_type",
    "is_parallel",
    "parallel_nums",
    "error_handle_mode",
    "loop_count",
    "loop_variables",
    "break_conditions",
    "logical_operator",
    "zIndex",
    "model_dependency",
    "model_dependencies",
}


class SpecValidationError(ValueError):
    pass


@dataclass
class CompileContext:
    app_mode: str
    in_iteration: bool = False
    in_loop: bool = False
    iteration_id: str | None = None
    loop_id: str | None = None
    parent_id: str | None = None
    child_y: int = 68
    child_z_index: int = 1002


@dataclass
class NodeBlueprint:
    data: dict[str, Any]
    width: int = NODE_WIDTH
    height: int = DEFAULT_NODE_HEIGHT
    dependencies: list[dict[str, Any]] = field(default_factory=list)


@dataclass
class NodeTemplate:
    data: dict[str, Any]
    width: int = NODE_WIDTH
    height: int = DEFAULT_NODE_HEIGHT
    dependencies: list[dict[str, Any]] = field(default_factory=list)


_AUTO_TEMPLATE_INDEX: dict[str, dict[tuple[str, str], Path]] | None = None


def deep_merge(base: dict[str, Any], override: dict[str, Any] | None) -> dict[str, Any]:
    result = copy.deepcopy(base)
    if not override:
        return result
    for key, value in override.items():
        if isinstance(value, dict) and isinstance(result.get(key), dict):
            result[key] = deep_merge(result[key], value)
        else:
            result[key] = copy.deepcopy(value)
    return result


def default_features() -> dict[str, Any]:
    return {
        "file_upload": {},
        "opening_statement": "",
        "retriever_resource": {"enabled": True},
        "sensitive_word_avoidance": {"enabled": False},
        "speech_to_text": {"enabled": False},
        "suggested_questions": [],
        "suggested_questions_after_answer": {"enabled": False},
        "text_to_speech": {"enabled": False, "language": "", "voice": ""},
    }


def build_node_shell(
    *,
    node_id: str,
    custom_type: str = "custom",
    position: dict[str, Any],
    data: dict[str, Any],
    width: int = NODE_WIDTH,
    height: int = DEFAULT_NODE_HEIGHT,
    parent_id: str | None = None,
    z_index: int | None = None,
    draggable: bool | None = None,
    selectable: bool | None = None,
) -> dict[str, Any]:
    node: dict[str, Any] = {
        "id": node_id,
        "type": custom_type,
        "position": position,
        "sourcePosition": "right",
        "targetPosition": "left",
        "data": data,
    }
    if width != NODE_WIDTH or height != DEFAULT_NODE_HEIGHT or parent_id:
        node["width"] = width
        node["height"] = height
    if parent_id:
        node["parentId"] = parent_id
    if z_index is not None:
        node["zIndex"] = z_index
    if draggable is not None:
        node["draggable"] = draggable
    if selectable is not None:
        node["selectable"] = selectable
    return node


def build_edge(
    *,
    source_id: str,
    source_type: str,
    target_id: str,
    target_type: str,
    in_iteration: bool = False,
    in_loop: bool = False,
    iteration_id: str | None = None,
    loop_id: str | None = None,
    z_index: int = 0,
) -> dict[str, Any]:
    edge: dict[str, Any] = {
        "id": f"{source_id}-source-{target_id}-target",
        "source": source_id,
        "sourceHandle": "source",
        "target": target_id,
        "targetHandle": "target",
        "data": {
            "sourceType": source_type,
            "targetType": target_type,
            "isInIteration": bool(in_iteration),
            "isInLoop": bool(in_loop),
        },
    }
    if iteration_id:
        edge["data"]["iteration_id"] = iteration_id
    if loop_id:
        edge["data"]["loop_id"] = loop_id
    if in_iteration or in_loop or z_index != 0:
        edge["type"] = "custom"
        edge["zIndex"] = z_index
    return edge


def build_edge_from_spec(
    edge_spec: dict[str, Any],
    *,
    node_type_by_id: dict[str, str],
    ctx: CompileContext,
) -> dict[str, Any]:
    source_id = edge_spec.get("source")
    target_id = edge_spec.get("target")
    if not source_id or not target_id:
        raise SpecValidationError(f"Edge requires `source` and `target`: {edge_spec!r}")
    if source_id not in node_type_by_id:
        raise SpecValidationError(f"Edge source `{source_id}` is not defined in this graph scope.")
    if target_id not in node_type_by_id:
        raise SpecValidationError(f"Edge target `{target_id}` is not defined in this graph scope.")

    source_handle = edge_spec.get("source_handle", "source")
    target_handle = edge_spec.get("target_handle", "target")
    source_type = edge_spec.get("source_type", node_type_by_id[source_id])
    target_type = edge_spec.get("target_type", node_type_by_id[target_id])

    edge_id = edge_spec.get("id")
    if not edge_id:
        edge_id = f"{source_id}-{source_handle}-{target_id}-{target_handle}"

    edge: dict[str, Any] = {
        "id": edge_id,
        "source": source_id,
        "sourceHandle": source_handle,
        "target": target_id,
        "targetHandle": target_handle,
        "data": {
            "sourceType": source_type,
            "targetType": target_type,
            "isInIteration": bool(ctx.in_iteration),
            "isInLoop": bool(ctx.in_loop),
        },
    }
    edge_type = edge_spec.get("type")
    edge_z_index = edge_spec.get("zIndex", ctx.child_z_index if ctx.parent_id else 0)
    edge_data = edge_spec.get("data")
    if ctx.iteration_id:
        edge["data"]["iteration_id"] = ctx.iteration_id
    if ctx.loop_id:
        edge["data"]["loop_id"] = ctx.loop_id
    if edge_data:
        edge["data"] = deep_merge(edge["data"], edge_data)
    if ctx.in_iteration or ctx.in_loop or edge_type or edge_z_index != 0:
        edge["type"] = edge_type or "custom"
        edge["zIndex"] = edge_z_index
    return edge


def build_start_data(spec: dict[str, Any]) -> dict[str, Any]:
    variables = copy.deepcopy(spec.get("variables", []))
    if isinstance(variables, list):
        for variable in variables:
            if not isinstance(variable, dict):
                continue
            variable_type = variable.get("type")
            if isinstance(variable_type, str):
                variable["type"] = START_VARIABLE_TYPE_ALIASES.get(variable_type, variable_type)
    return deep_merge(
        {
            "title": spec.get("title", "Start"),
            "desc": spec.get("desc", ""),
            "type": "start",
            "variables": variables,
        },
        spec.get("data"),
    )


def build_trigger_schedule_data(spec: dict[str, Any]) -> dict[str, Any]:
    mode = spec.get("mode", "visual")
    if mode not in {"visual", "cron"}:
        raise SpecValidationError(f"Schedule trigger `{spec['id']}` has unsupported mode `{mode}`.")

    if mode == "cron":
        cron_expression = spec.get("cron_expression")
        if not cron_expression:
            raise SpecValidationError(f"Schedule trigger `{spec['id']}` in cron mode requires `cron_expression`.")
        frequency = None
        visual_config = None
    else:
        frequency = spec.get("frequency", "daily")
        if frequency not in {"hourly", "daily", "weekly", "monthly"}:
            raise SpecValidationError(
                f"Schedule trigger `{spec['id']}` has unsupported frequency `{frequency}`."
            )
        visual_config = deep_merge(
            {
                "time": "12:00 AM",
                "weekdays": ["sun"],
                "on_minute": 0,
                "monthly_days": [1],
            },
            spec.get("visual_config"),
        )
        cron_expression = spec.get("cron_expression")

    timezone = spec.get("timezone", "UTC")
    config = {
        "mode": mode,
        "timezone": timezone,
    }
    if frequency is not None:
        config["frequency"] = frequency
    if visual_config is not None:
        config["visual_config"] = visual_config
    if cron_expression:
        config["cron_expression"] = cron_expression

    return deep_merge(
        {
            "title": spec.get("title", "Schedule Trigger"),
            "desc": spec.get("desc", ""),
            "type": "trigger-schedule",
            "mode": mode,
            "frequency": frequency,
            "cron_expression": cron_expression,
            "visual_config": visual_config,
            "timezone": timezone,
            "config": config,
        },
        spec.get("data"),
    )


def build_trigger_webhook_data(spec: dict[str, Any]) -> dict[str, Any]:
    method = str(spec.get("method", "POST")).upper()
    allowed_methods = {"GET", "POST", "PUT", "DELETE", "PATCH", "HEAD"}
    if method not in allowed_methods:
        raise SpecValidationError(f"Webhook trigger `{spec['id']}` has unsupported method `{method}`.")

    content_type = spec.get("content_type", "application/json")
    variables = spec.get("variables")
    if variables is None:
        variables = [
            {
                "variable": "_webhook_raw",
                "label": "raw",
                "value_type": "object",
                "value_selector": [],
                "required": True,
            }
        ]

    return deep_merge(
        {
            "title": spec.get("title", "Webhook Trigger"),
            "desc": spec.get("desc", ""),
            "type": "trigger-webhook",
            "webhook_url": spec.get("webhook_url", ""),
            "webhook_debug_url": spec.get("webhook_debug_url", ""),
            "method": method,
            "content_type": content_type,
            "headers": spec.get("headers", []),
            "params": spec.get("params", []),
            "body": spec.get("body", []),
            "async_mode": spec.get("async_mode", True),
            "status_code": spec.get("status_code", 200),
            "response_body": spec.get("response_body", ""),
            "variables": variables,
        },
        spec.get("data"),
    )


def build_http_request_data(spec: dict[str, Any]) -> dict[str, Any]:
    method = str(spec.get("method", "GET")).upper()
    allowed_methods = {"GET", "POST", "PUT", "DELETE", "PATCH", "HEAD"}
    if method not in allowed_methods:
        raise SpecValidationError(f"HTTP node `{spec['id']}` has unsupported method `{method}`.")
    url = spec.get("url")
    if not url:
        raise SpecValidationError(f"HTTP node `{spec['id']}` requires `url`.")

    body = deep_merge(
        {
            "type": "none",
            "data": [],
        },
        spec.get("body"),
    )

    authorization = deep_merge(
        {
            "type": "no-auth",
            "config": None,
        },
        spec.get("authorization"),
    )

    timeout = deep_merge(
        {
            "connect": 30,
            "read": 30,
            "write": 30,
            "max_connect_timeout": 10,
            "max_read_timeout": 600,
            "max_write_timeout": 600,
        },
        spec.get("timeout"),
    )

    retry_config = deep_merge(
        {
            "retry_enabled": True,
            "max_retries": 3,
            "retry_interval": 100,
        },
        spec.get("retry_config"),
    )

    return deep_merge(
        {
            "title": spec.get("title", "HTTP Request"),
            "desc": spec.get("desc", ""),
            "type": "http-request",
            "variables": spec.get("variables", []),
            "method": method,
            "url": url,
            "authorization": authorization,
            "headers": spec.get("headers", ""),
            "params": spec.get("params", ""),
            "body": body,
            "ssl_verify": spec.get("ssl_verify", True),
            "timeout": timeout,
            "retry_config": retry_config,
        },
        spec.get("data"),
    )


def build_question_classifier_data(spec: dict[str, Any]) -> dict[str, Any]:
    query_variable_selector = spec.get("query_variable_selector")
    if not query_variable_selector:
        raise SpecValidationError(
            f"Question classifier `{spec['id']}` requires `query_variable_selector`."
        )

    model_override = spec.get("model") if isinstance(spec.get("model"), dict) else None
    model = deep_merge(
        {
            "provider": spec.get("provider", ""),
            "name": spec.get("model", ""),
            "mode": spec.get("model_mode", "chat"),
            "completion_params": spec.get("completion_params", {"temperature": 0.7}),
        },
        model_override,
    )
    if not model.get("provider"):
        raise SpecValidationError(f"Question classifier `{spec['id']}` requires a model provider.")

    classes = spec.get("classes")
    if not isinstance(classes, list) or not classes:
        raise SpecValidationError(f"Question classifier `{spec['id']}` requires non-empty `classes`.")
    for class_item in classes:
        if not isinstance(class_item, dict) or not class_item.get("id") or not class_item.get("name"):
            raise SpecValidationError(
                f"Question classifier `{spec['id']}` classes must include `id` and `name`."
            )

    vision = deep_merge(
        {
            "enabled": False,
        },
        spec.get("vision"),
    )

    return deep_merge(
        {
            "title": spec.get("title", "Question Classifier"),
            "desc": spec.get("desc", ""),
            "type": "question-classifier",
            "query_variable_selector": query_variable_selector,
            "model": model,
            "classes": classes,
            "_targetBranches": copy.deepcopy(classes),
            "instruction": spec.get("instruction", ""),
            "memory": spec.get("memory"),
            "vision": vision,
        },
        spec.get("data"),
    )


def build_document_extractor_data(spec: dict[str, Any]) -> dict[str, Any]:
    variable_selector = spec.get("variable_selector")
    if not variable_selector:
        raise SpecValidationError(
            f"Document extractor `{spec['id']}` requires `variable_selector`."
        )

    return deep_merge(
        {
            "title": spec.get("title", "Document Extractor"),
            "desc": spec.get("desc", ""),
            "type": "document-extractor",
            "variable_selector": variable_selector,
            "is_array_file": spec.get("is_array_file", False),
        },
        spec.get("data"),
    )


def build_knowledge_retrieval_data(spec: dict[str, Any]) -> dict[str, Any]:
    dataset_ids = spec.get("dataset_ids")
    if not isinstance(dataset_ids, list) or not dataset_ids:
        raise SpecValidationError(
            f"Knowledge retrieval `{spec['id']}` requires non-empty `dataset_ids`."
        )

    retrieval_mode = spec.get("retrieval_mode", "multiple")
    if retrieval_mode not in {"single", "multiple"}:
        raise SpecValidationError(
            f"Knowledge retrieval `{spec['id']}` has unsupported retrieval_mode `{retrieval_mode}`."
        )

    query_variable_selector = spec.get("query_variable_selector", [])
    query_attachment_selector = spec.get("query_attachment_selector", [])

    multiple_retrieval_config = deep_merge(
        {
            "top_k": 3,
            "score_threshold": None,
            "reranking_enable": False,
        },
        spec.get("multiple_retrieval_config"),
    )

    single_retrieval_config = spec.get("single_retrieval_config")
    if retrieval_mode == "single":
        single_retrieval_config = deep_merge(
            {
                "model": {
                    "provider": spec.get("provider", ""),
                    "name": spec.get("model", ""),
                    "mode": spec.get("model_mode", "chat"),
                    "completion_params": spec.get("completion_params", {"temperature": 0.7}),
                }
            },
            single_retrieval_config,
        )
        model = single_retrieval_config.get("model", {})
        if not model.get("provider"):
            raise SpecValidationError(
                f"Knowledge retrieval `{spec['id']}` in single mode requires model provider."
            )

    metadata_filtering_mode = spec.get("metadata_filtering_mode", "disabled")
    if metadata_filtering_mode not in {"disabled", "automatic", "manual"}:
        raise SpecValidationError(
            f"Knowledge retrieval `{spec['id']}` has unsupported metadata_filtering_mode `{metadata_filtering_mode}`."
        )

    vision = deep_merge(
        {
            "enabled": False,
        },
        spec.get("vision"),
    )

    return deep_merge(
        {
            "title": spec.get("title", "Knowledge Retrieval"),
            "desc": spec.get("desc", ""),
            "type": "knowledge-retrieval",
            "query_variable_selector": query_variable_selector,
            "query_attachment_selector": query_attachment_selector,
            "dataset_ids": dataset_ids,
            "retrieval_mode": retrieval_mode,
            "multiple_retrieval_config": multiple_retrieval_config if retrieval_mode == "multiple" else None,
            "single_retrieval_config": single_retrieval_config if retrieval_mode == "single" else None,
            "metadata_filtering_mode": metadata_filtering_mode,
            "metadata_filtering_conditions": spec.get("metadata_filtering_conditions"),
            "metadata_model_config": spec.get("metadata_model_config"),
            "vision": vision,
        },
        spec.get("data"),
    )


def build_if_else_data(spec: dict[str, Any]) -> dict[str, Any]:
    cases = spec.get("cases")
    if not isinstance(cases, list) or not cases:
        legacy_conditions = spec.get("conditions")
        if isinstance(legacy_conditions, list) and legacy_conditions:
            cases = [
                {
                    "case_id": spec.get("case_id", "true"),
                    "logical_operator": spec.get("logical_operator", "and"),
                    "conditions": legacy_conditions,
                }
            ]
        else:
            raise SpecValidationError(f"If/Else node `{spec['id']}` requires non-empty `cases` or `conditions`.")

    for case in cases:
        if not isinstance(case, dict) or not case.get("case_id"):
            raise SpecValidationError(f"If/Else node `{spec['id']}` has invalid case entry: {case!r}")
        if "conditions" not in case or not isinstance(case["conditions"], list):
            raise SpecValidationError(f"If/Else node `{spec['id']}` case `{case.get('case_id')}` requires conditions.")

    target_branches = spec.get("_targetBranches")
    if not target_branches:
        target_branches = [
            {
                "id": case["case_id"],
                "name": str(case.get("name") or case["case_id"]).upper() if case["case_id"] == "true" else str(case.get("name") or case["case_id"]),
            }
            for case in cases
        ]
        existing_ids = {branch["id"] for branch in target_branches}
        if "false" not in existing_ids:
            target_branches.append({"id": "false", "name": "ELSE"})

    return deep_merge(
        {
            "title": spec.get("title", "IF/ELSE"),
            "desc": spec.get("desc", ""),
            "type": "if-else",
            "cases": cases,
            "_targetBranches": target_branches,
        },
        spec.get("data"),
    )


def build_list_operator_data(spec: dict[str, Any]) -> dict[str, Any]:
    variable = spec.get("variable")
    if not variable:
        raise SpecValidationError(f"List operator `{spec['id']}` requires `variable`.")

    return deep_merge(
        {
            "title": spec.get("title", "List Operator"),
            "desc": spec.get("desc", ""),
            "type": "list-operator",
            "variable": variable,
            "var_type": spec.get("var_type", "array[object]"),
            "item_var_type": spec.get("item_var_type", "object"),
            "filter_by": deep_merge(
                {
                    "enabled": False,
                    "conditions": [],
                },
                spec.get("filter_by"),
            ),
            "extract_by": deep_merge(
                {
                    "enabled": False,
                    "serial": "1",
                },
                spec.get("extract_by"),
            ),
            "order_by": deep_merge(
                {
                    "enabled": False,
                    "key": "",
                    "value": "asc",
                },
                spec.get("order_by"),
            ),
            "limit": deep_merge(
                {
                    "enabled": False,
                    "size": 10,
                },
                spec.get("limit"),
            ),
        },
        spec.get("data"),
    )


def build_variable_assigner_data(spec: dict[str, Any]) -> dict[str, Any]:
    variables = spec.get("variables", [])
    advanced_settings = deep_merge(
        {
            "group_enabled": False,
            "groups": [],
        },
        spec.get("advanced_settings"),
    )
    if not variables and not advanced_settings.get("groups"):
        raise SpecValidationError(
            f"Variable assigner `{spec['id']}` requires `variables` or grouped advanced_settings."
        )

    return deep_merge(
        {
            "title": spec.get("title", "Variable Assigner"),
            "desc": spec.get("desc", ""),
            "type": spec.get("node_type_override", "variable-assigner"),
            "output_type": spec.get("output_type", "string"),
            "variables": variables,
            "advanced_settings": advanced_settings,
        },
        spec.get("data"),
    )


def normalize_retry_config(retry_config: dict[str, Any] | None) -> dict[str, Any] | None:
    if retry_config is None:
        return None
    normalized = copy.deepcopy(retry_config)
    if "enabled" in normalized and "retry_enabled" not in normalized:
        normalized["retry_enabled"] = normalized.pop("enabled")
    if "exponential_backoff" in normalized and normalized["exponential_backoff"] is None:
        normalized.pop("exponential_backoff")
    return normalized


def normalize_conditions(conditions: Any) -> Any:
    normalized = copy.deepcopy(conditions)

    def visit(value: Any) -> None:
        if isinstance(value, dict):
            operator = value.get("comparison_operator")
            if isinstance(operator, str):
                value["comparison_operator"] = COMPARISON_OPERATOR_ALIASES.get(operator, operator)
            for child in value.values():
                visit(child)
        elif isinstance(value, list):
            for item in value:
                visit(item)

    visit(normalized)
    return normalized


def build_llm_data(spec: dict[str, Any]) -> dict[str, Any]:
    app_mode = spec.get("_app_mode", "workflow")
    is_advanced_chat = app_mode == "advanced-chat"

    prompt_template = spec.get("prompt_template")
    if not prompt_template:
        system_prompt = spec.get("system_prompt", "")
        user_prompt = spec.get("user_prompt", "")
        if is_advanced_chat:
            prompt_template = [
                {"role": "system", "text": system_prompt},
            ]
        else:
            prompt_template = [
                {"role": "system", "text": system_prompt},
                {"role": "user", "text": user_prompt},
            ]

    default_memory: dict[str, Any] | None
    if is_advanced_chat:
        default_memory = {
            "window": {"enabled": False, "size": 10},
            "query_prompt_template": spec.get("user_prompt", "{{#sys.query#}}\n\n{{#sys.files#}}"),
            "role_prefix": {"user": "", "assistant": ""},
        }
    else:
        default_memory = {
            "enabled": False,
            "window": {"enabled": False, "size": 50},
        }

    data = {
        "title": spec.get("title", "LLM"),
        "desc": spec.get("desc", ""),
        "type": "llm",
        "variables": spec.get("variables", []),
        "model": {
            "provider": spec.get("provider", ""),
            "name": spec.get("model", ""),
            "mode": spec.get("model_mode", "chat"),
            "completion_params": spec.get("completion_params", {"temperature": 0.7}),
        },
        "prompt_template": prompt_template,
        "vision": spec.get("vision", {"enabled": False}),
        "memory": spec.get("memory", default_memory),
        "context": spec.get("context", {"enabled": False, "variable_selector": []}),
    }

    structured_output = spec.get("structured_output")
    if structured_output is not None:
        data["structured_output"] = structured_output
        data["structured_output_enabled"] = bool(structured_output.get("enabled", True))
    elif spec.get("structured_output_enabled") is not None:
        data["structured_output_enabled"] = bool(spec["structured_output_enabled"])

    retry_config = normalize_retry_config(spec.get("retry_config"))
    if retry_config is not None:
        data["retry_config"] = retry_config

    return deep_merge(data, spec.get("data"))


def build_code_data(spec: dict[str, Any]) -> dict[str, Any]:
    if "code" not in spec:
        raise SpecValidationError(f"Code node `{spec['id']}` requires `code`.")
    return deep_merge(
        {
            "title": spec.get("title", "Code"),
            "desc": spec.get("desc", ""),
            "type": "code",
            "variables": spec.get("variables", []),
            "code_language": spec.get("code_language", "python3"),
            "code": spec["code"],
            "outputs": spec.get("outputs", {}),
        },
        spec.get("data"),
    )


def build_template_transform_data(spec: dict[str, Any]) -> dict[str, Any]:
    if "template" not in spec:
        raise SpecValidationError(f"Template node `{spec['id']}` requires `template`.")
    return deep_merge(
        {
            "title": spec.get("title", "Template"),
            "desc": spec.get("desc", ""),
            "type": "template-transform",
            "template": spec["template"],
            "variables": spec.get("variables", []),
        },
        spec.get("data"),
    )


def build_answer_data(spec: dict[str, Any]) -> dict[str, Any]:
    if "answer" not in spec:
        raise SpecValidationError(f"Answer node `{spec['id']}` requires `answer`.")
    return deep_merge(
        {
            "title": spec.get("title", "Answer"),
            "desc": spec.get("desc", ""),
            "type": "answer",
            "variables": spec.get("variables", []),
            "answer": spec["answer"],
        },
        spec.get("data"),
    )


def build_end_data(spec: dict[str, Any]) -> dict[str, Any]:
    outputs = spec.get("outputs")
    if outputs is None:
        raise SpecValidationError(f"End node `{spec['id']}` requires `outputs`.")
    return deep_merge(
        {
            "title": spec.get("title", "End"),
            "desc": spec.get("desc", ""),
            "type": "end",
            "outputs": outputs,
        },
        spec.get("data"),
    )


def build_assigner_data(spec: dict[str, Any]) -> dict[str, Any]:
    items = spec.get("items")
    if items is None:
        raise SpecValidationError(f"Assigner node `{spec['id']}` requires `items`.")
    return deep_merge(
        {
            "title": spec.get("title", "Variable Assigner"),
            "desc": spec.get("desc", ""),
            "type": "assigner",
            "version": spec.get("version", "2"),
            "items": items,
        },
        spec.get("data"),
    )


def _drop_none_values(data: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in data.items() if value is not None}


def normalize_dependency(dep: Any) -> list[dict[str, Any]]:
    if dep is None:
        return []
    if isinstance(dep, list):
        normalized: list[dict[str, Any]] = []
        for item in dep:
            normalized.extend(normalize_dependency(item))
        return normalized
    if isinstance(dep, str):
        return [
            {
                "current_identifier": None,
                "type": "marketplace",
                "value": {
                    "marketplace_plugin_unique_identifier": dep,
                    "version": None,
                },
            }
        ]
    if not isinstance(dep, dict):
        raise SpecValidationError(f"Unsupported dependency format: {dep!r}")
    if "type" in dep and "value" in dep:
        normalized = copy.deepcopy(dep)
        if normalized.get("type") == "marketplace" and isinstance(normalized.get("value"), dict):
            normalized["value"].setdefault("version", None)
        normalized.setdefault("current_identifier", None)
        return [normalized]
    if "marketplace_plugin_unique_identifier" in dep:
        return normalize_dependency(
            {
                "type": "marketplace",
                "value": {
                    "marketplace_plugin_unique_identifier": dep["marketplace_plugin_unique_identifier"],
                    "version": dep.get("version"),
                },
            }
        )
    raise SpecValidationError(f"Dependency entry is missing `type/value`: {dep!r}")


def dedupe_dependencies(dependencies: list[dict[str, Any]]) -> list[dict[str, Any]]:
    unique_by_key: dict[str, dict[str, Any]] = {}
    for dep in dependencies:
        value = dep.get("value") or {}
        identity = (
            value.get("marketplace_plugin_unique_identifier")
            or value.get("plugin_unique_identifier")
            or value.get("github_plugin_unique_identifier")
        )
        key = identity or json.dumps(dep, sort_keys=True)
        previous = unique_by_key.get(key)
        if previous is None or len(json.dumps(dep, sort_keys=True)) > len(json.dumps(previous, sort_keys=True)):
            unique_by_key[key] = dep
    return list(unique_by_key.values())


def load_yaml_mapping(path: Path) -> dict[str, Any]:
    raw = yaml.safe_load(path.read_text())
    if raw is None:
        return {}
    if not isinstance(raw, dict):
        raise SpecValidationError(f"YAML at `{path}` must be a mapping.")
    return raw


def resolve_template_path(template_ref: str, template_base_dir: Path) -> Path:
    direct = Path(template_ref)
    candidates = []
    if direct.is_absolute():
        candidates.append(direct)
    else:
        candidates.extend(
            [
                template_base_dir / direct,
                TEMPLATES_DIR / direct,
                TEMPLATES_DIR / f"{template_ref}.yml",
                TEMPLATES_DIR / f"{template_ref}.yaml",
            ]
        )
    for candidate in candidates:
        if candidate.exists():
            return candidate
    raise SpecValidationError(f"Template `{template_ref}` was not found.")


def load_model_dependency_registry() -> dict[str, list[dict[str, Any]]]:
    if not MODEL_REGISTRY_PATH.exists():
        return {}
    raw = load_yaml_mapping(MODEL_REGISTRY_PATH)
    providers = raw.get("providers", {})
    if not isinstance(providers, dict):
        raise SpecValidationError("Model registry `providers` must be a mapping.")

    registry: dict[str, list[dict[str, Any]]] = {}
    for provider, value in providers.items():
        registry[provider] = normalize_dependency(value.get("dependencies") or value.get("dependency"))
    return registry


def load_node_template(template_ref: str, template_base_dir: Path) -> NodeTemplate:
    template_path = resolve_template_path(template_ref, template_base_dir)
    raw = yaml.safe_load(template_path.read_text())
    if not isinstance(raw, dict):
        raise SpecValidationError(f"Template `{template_ref}` must be a mapping.")

    node_spec = raw.get("node", raw)
    if not isinstance(node_spec, dict):
        raise SpecValidationError(f"Template `{template_ref}` must define a `node` mapping.")

    data = node_spec.get("data")
    if not isinstance(data, dict):
        raise SpecValidationError(f"Template `{template_ref}` must define `node.data`.")

    return NodeTemplate(
        data=copy.deepcopy(data),
        width=int(node_spec.get("width", NODE_WIDTH)),
        height=int(node_spec.get("height", DEFAULT_NODE_HEIGHT)),
        dependencies=normalize_dependency(raw.get("dependencies") or raw.get("dependency")),
    )


def auto_template_priority(path: Path) -> tuple[int, int, str]:
    return (
        0 if "extracted" in path.parts else 1,
        len(path.stem),
        path.as_posix(),
    )


def load_auto_template_index() -> dict[str, dict[tuple[str, str], Path]]:
    global _AUTO_TEMPLATE_INDEX
    if _AUTO_TEMPLATE_INDEX is not None:
        return _AUTO_TEMPLATE_INDEX

    index: dict[str, dict[tuple[str, str], Path]] = {
        "tool": {},
        "trigger-plugin": {},
    }
    for candidate in TEMPLATES_DIR.rglob("*.yml"):
        try:
            raw = yaml.safe_load(candidate.read_text())
        except yaml.YAMLError:
            continue
        if not isinstance(raw, dict):
            continue
        node_spec = raw.get("node", raw)
        if not isinstance(node_spec, dict):
            continue
        data = node_spec.get("data")
        if not isinstance(data, dict):
            continue
        node_type = data.get("type")
        if node_type not in AUTO_TEMPLATE_TYPES:
            continue

        if node_type == "tool":
            identities = [
                (data.get("provider_id"), data.get("tool_name")),
                (data.get("plugin_id"), data.get("tool_name")),
            ]
        else:
            identities = [
                (data.get("provider_id"), data.get("event_name")),
                (data.get("plugin_id"), data.get("event_name")),
            ]

        for identity, name in identities:
            if not identity or not name:
                continue
            key = (str(identity), str(name))
            existing = index[node_type].get(key)
            if existing is None or auto_template_priority(candidate) < auto_template_priority(existing):
                index[node_type][key] = candidate

    _AUTO_TEMPLATE_INDEX = index
    return index


def resolve_auto_template_ref(spec: dict[str, Any]) -> str | None:
    if spec.get("template"):
        return str(spec["template"])

    node_type = spec["type"]
    if node_type not in AUTO_TEMPLATE_TYPES:
        return None

    index = load_auto_template_index()
    if node_type == "tool":
        identities = [
            (spec.get("provider_id"), spec.get("tool_name")),
            (spec.get("plugin_id"), spec.get("tool_name")),
        ]
    else:
        identities = [
            (spec.get("provider_id"), spec.get("event_name")),
            (spec.get("plugin_id"), spec.get("event_name")),
        ]

    for identity, name in identities:
        if not identity or not name:
            continue
        match = index[node_type].get((str(identity), str(name)))
        if match:
            return str(match)
    return None


def with_resolved_template(spec: dict[str, Any]) -> dict[str, Any]:
    template_ref = resolve_auto_template_ref(spec)
    if not template_ref or spec.get("template") == template_ref:
        return spec
    next_spec = copy.deepcopy(spec)
    next_spec["template"] = template_ref
    return next_spec


def infer_model_dependencies(spec: dict[str, Any], data: dict[str, Any]) -> list[dict[str, Any]]:
    explicit = spec.get("model_dependencies") or spec.get("model_dependency")
    if explicit:
        return dedupe_dependencies(normalize_dependency(explicit))

    registry = load_model_dependency_registry()
    found: list[dict[str, Any]] = []

    def walk(value: Any) -> None:
        if isinstance(value, dict):
            provider = value.get("provider")
            if isinstance(provider, str) and any(key in value for key in ("model", "model_type", "name")):
                found.extend(registry.get(provider, []))
            for nested in value.values():
                walk(nested)
        elif isinstance(value, list):
            for item in value:
                walk(item)

    walk(data)
    return dedupe_dependencies(found)


def build_tool_blueprint(spec: dict[str, Any], template_base_dir: Path) -> NodeBlueprint:
    spec = with_resolved_template(spec)
    template = load_node_template(spec["template"], template_base_dir) if spec.get("template") else None

    tool_defaults = _drop_none_values(
        {
            "title": spec.get("title"),
            "desc": spec.get("desc"),
            "type": "tool",
            "selected": False,
            "provider_id": spec.get("provider_id"),
            "provider_type": spec.get("provider_type"),
            "provider_name": spec.get("provider_name"),
            "plugin_id": spec.get("plugin_id"),
            "tool_name": spec.get("tool_name"),
            "tool_label": spec.get("tool_label"),
            "tool_description": spec.get("tool_description"),
            "tool_node_version": spec.get("tool_node_version"),
            "tool_parameters": spec.get("tool_parameters"),
            "tool_configurations": spec.get("tool_configurations"),
        }
    )

    template_data = template.data if template else {}
    data = deep_merge(template_data, tool_defaults)
    data = deep_merge(data, spec.get("data"))
    data.setdefault("type", "tool")
    data.setdefault("title", "Tool")
    data.setdefault("desc", "")
    data.setdefault("provider_type", "builtin")
    data.setdefault("tool_parameters", {})
    data.setdefault("tool_configurations", {})

    provider_id = data.get("provider_id")
    tool_name = data.get("tool_name")
    if not provider_id:
        raise SpecValidationError(f"Tool node `{spec['id']}` requires `provider_id` or a template that provides it.")
    if not tool_name:
        raise SpecValidationError(f"Tool node `{spec['id']}` requires `tool_name` or a template that provides it.")
    if not data.get("provider_name"):
        data["provider_name"] = provider_id
    if "tool_label" not in data:
        data["tool_label"] = tool_name

    dependencies = []
    if template:
        dependencies.extend(template.dependencies)
    dependencies.extend(normalize_dependency(spec.get("dependencies") or spec.get("dependency")))
    dependencies.extend(infer_model_dependencies(spec, data))

    return NodeBlueprint(
        data=data,
        width=int(spec.get("width", template.width if template else NODE_WIDTH)),
        height=int(spec.get("height", template.height if template else DEFAULT_NODE_HEIGHT)),
        dependencies=dedupe_dependencies(dependencies),
    )


def build_template_node_blueprint(spec: dict[str, Any], template_base_dir: Path) -> NodeBlueprint:
    spec = with_resolved_template(spec)
    if not spec.get("template"):
        raise SpecValidationError(f"Node `{spec['id']}` requires `template` for template-based generation.")

    template = load_node_template(spec["template"], template_base_dir)
    top_level_overrides = {
        key: copy.deepcopy(value)
        for key, value in spec.items()
        if key not in TEMPLATE_RESERVED_KEYS
    }
    data = deep_merge(template.data, top_level_overrides)
    data = deep_merge(data, spec.get("data"))
    data.setdefault("type", spec["type"])
    data.setdefault("title", spec["id"])
    data.setdefault("desc", "")

    dependencies = []
    dependencies.extend(template.dependencies)
    dependencies.extend(normalize_dependency(spec.get("dependencies") or spec.get("dependency")))
    dependencies.extend(infer_model_dependencies(spec, data))

    return NodeBlueprint(
        data=data,
        width=int(spec.get("width", template.width)),
        height=int(spec.get("height", template.height)),
        dependencies=dedupe_dependencies(dependencies),
    )


def build_default_node_data(node_spec: dict[str, Any]) -> dict[str, Any]:
    builders = {
        "start": build_start_data,
        "trigger-schedule": build_trigger_schedule_data,
        "trigger-webhook": build_trigger_webhook_data,
        "http-request": build_http_request_data,
        "question-classifier": build_question_classifier_data,
        "document-extractor": build_document_extractor_data,
        "knowledge-retrieval": build_knowledge_retrieval_data,
        "if-else": build_if_else_data,
        "list-operator": build_list_operator_data,
        "variable-assigner": build_variable_assigner_data,
        "llm": build_llm_data,
        "code": build_code_data,
        "template-transform": build_template_transform_data,
        "answer": build_answer_data,
        "end": build_end_data,
        "assigner": build_assigner_data,
    }
    node_type = node_spec["type"]
    try:
        return builders[node_type](node_spec)
    except KeyError as exc:
        raise SpecValidationError(f"Unsupported node type `{node_type}` in v1 generator.") from exc


def build_node_blueprint(spec: dict[str, Any], template_base_dir: Path) -> NodeBlueprint:
    spec = with_resolved_template(spec)
    if spec["type"] == "tool":
        return build_tool_blueprint(spec, template_base_dir)
    if spec.get("template") and spec["type"] != "template-transform":
        return build_template_node_blueprint(spec, template_base_dir)
    data = build_default_node_data(spec)
    return NodeBlueprint(
        data=data,
        width=int(spec.get("width", NODE_WIDTH)),
        height=int(spec.get("height", DEFAULT_NODE_HEIGHT)),
        dependencies=dedupe_dependencies(
            normalize_dependency(spec.get("dependencies") or spec.get("dependency"))
            + infer_model_dependencies(spec, data)
        ),
    )


def attach_container_flags(data: dict[str, Any], ctx: CompileContext) -> dict[str, Any]:
    next_data = copy.deepcopy(data)
    if ctx.in_iteration:
        next_data["isInIteration"] = True
        next_data["iteration_id"] = ctx.iteration_id
    if ctx.in_loop:
        next_data["isInLoop"] = True
        next_data["loop_id"] = ctx.loop_id
    return next_data


def container_size(child_nodes: list[dict[str, Any]], container_type: str) -> dict[str, int]:
    minimum = CONTAINER_MIN_SIZE[container_type]
    if not child_nodes:
        return minimum
    max_right = max(int(node["position"]["x"]) + int(node.get("width", NODE_WIDTH)) for node in child_nodes)
    max_bottom = max(int(node["position"]["y"]) + int(node.get("height", DEFAULT_NODE_HEIGHT)) for node in child_nodes)
    return {
        "width": max(minimum["width"], max_right + 80),
        "height": max(minimum["height"], max_bottom + 80),
    }


def validate_sequence_for_mode(sequence: list[dict[str, Any]], app_mode: str) -> None:
    for node in sequence:
        node_type = node["type"]
        if app_mode == "advanced-chat" and node_type == "end":
            raise SpecValidationError("`end` is not allowed in advanced-chat mode; use `answer`.")
        if app_mode == "workflow" and node_type == "answer":
            raise SpecValidationError("`answer` is not allowed in workflow mode; use `end`.")


def compile_sequence(
    sequence: list[dict[str, Any]],
    ctx: CompileContext,
    *,
    root_start_position: dict[str, int] | None = None,
    template_base_dir: Path,
    edge_specs: list[dict[str, Any]] | None = None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    validate_sequence_for_mode(sequence, ctx.app_mode)
    nodes: list[dict[str, Any]] = []
    edges: list[dict[str, Any]] = []
    dependencies: list[dict[str, Any]] = []
    compiled_refs: list[dict[str, str]] = []
    node_type_by_id: dict[str, str] = {}

    for index, spec in enumerate(sequence):
        node_type = spec["type"]
        if not spec.get("id"):
            raise SpecValidationError(f"Every node needs an `id`. Invalid entry: {spec!r}")

        if spec.get("position"):
            position = copy.deepcopy(spec["position"])
        elif root_start_position:
            position = {
                "x": root_start_position["x"] + index * ROOT_X_GAP,
                "y": root_start_position["y"],
            }
        else:
            position = {
                "x": CHILD_START_POSITION["x"] + index * CHILD_X_GAP,
                "y": ctx.child_y,
            }

        if node_type in {"iteration", "loop"}:
            compiled_nodes, compiled_edges, compiled_dependencies = compile_container(
                spec,
                ctx,
                position,
                template_base_dir=template_base_dir,
            )
            nodes.extend(compiled_nodes)
            edges.extend(compiled_edges)
            dependencies.extend(compiled_dependencies)
            compiled_refs.append({"id": spec["id"], "type": node_type})
            node_type_by_id[spec["id"]] = node_type
            continue

        spec_with_app_mode = copy.deepcopy(spec)
        spec_with_app_mode["_app_mode"] = ctx.app_mode
        blueprint = build_node_blueprint(spec_with_app_mode, template_base_dir)
        data = attach_container_flags(blueprint.data, ctx)
        node = build_node_shell(
            node_id=spec["id"],
            position=position,
            data=data,
            width=blueprint.width,
            height=blueprint.height,
            parent_id=ctx.parent_id,
            z_index=ctx.child_z_index if ctx.parent_id else spec.get("zIndex"),
        )
        nodes.append(node)
        dependencies.extend(blueprint.dependencies)
        compiled_refs.append({"id": spec["id"], "type": node_type})
        node_type_by_id[spec["id"]] = node_type

    if edge_specs is not None:
        for edge_spec in edge_specs:
            edges.append(
                build_edge_from_spec(
                    edge_spec,
                    node_type_by_id=node_type_by_id,
                    ctx=ctx,
                )
            )
    else:
        for left, right in zip(compiled_refs, compiled_refs[1:]):
            edges.append(
                build_edge(
                    source_id=left["id"],
                    source_type=left["type"],
                    target_id=right["id"],
                    target_type=right["type"],
                    in_iteration=ctx.in_iteration,
                    in_loop=ctx.in_loop,
                    iteration_id=ctx.iteration_id,
                    loop_id=ctx.loop_id,
                    z_index=ctx.child_z_index if ctx.parent_id else 0,
                )
            )

    return nodes, edges, dedupe_dependencies(dependencies)


def compile_container(
    spec: dict[str, Any],
    parent_ctx: CompileContext,
    root_position: dict[str, int],
    *,
    template_base_dir: Path,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    container_type = spec["type"]
    sequence = spec.get("sequence") or []
    if not sequence:
        raise SpecValidationError(f"Container node `{spec['id']}` requires a non-empty `sequence`.")

    start_node_id = spec.get("start_node_id", f"{spec['id']}start")
    child_ctx = CompileContext(
        app_mode=parent_ctx.app_mode,
        in_iteration=container_type == "iteration",
        in_loop=container_type == "loop",
        iteration_id=spec["id"] if container_type == "iteration" else None,
        loop_id=spec["id"] if container_type == "loop" else None,
        parent_id=spec["id"],
    )
    child_nodes, child_edges, child_dependencies = compile_sequence(
        sequence,
        child_ctx,
        template_base_dir=template_base_dir,
        edge_specs=spec.get("edges"),
    )
    size = container_size(child_nodes, container_type)

    if container_type == "iteration":
        container_data = {
            "title": spec.get("title", "Iteration"),
            "desc": spec.get("desc", ""),
            "type": "iteration",
            "selected": False,
            "start_node_id": start_node_id,
            "iterator_selector": spec.get("iterator_selector"),
            "iterator_input_type": spec.get("iterator_input_type", "array[string]"),
            "output_selector": spec.get("output_selector"),
            "output_type": spec.get("output_type", "array[string]"),
            "is_parallel": spec.get("is_parallel", False),
            "parallel_nums": spec.get("parallel_nums", 10),
            "error_handle_mode": spec.get("error_handle_mode", "terminated"),
            "width": size["width"],
            "height": size["height"],
        }
        if container_data["iterator_selector"] is None:
            raise SpecValidationError(f"Iteration node `{spec['id']}` requires `iterator_selector`.")
        if container_data["output_selector"] is None:
            raise SpecValidationError(f"Iteration node `{spec['id']}` requires `output_selector`.")
    else:
        container_data = {
            "title": spec.get("title", "Loop"),
            "desc": spec.get("desc", ""),
            "type": "loop",
            "selected": False,
            "start_node_id": start_node_id,
            "loop_count": spec.get("loop_count", 10),
            "loop_variables": spec.get("loop_variables", []),
            "break_conditions": normalize_conditions(spec.get("break_conditions", [])),
            "logical_operator": spec.get("logical_operator", "and"),
            "error_handle_mode": spec.get("error_handle_mode", "terminated"),
            "width": size["width"],
            "height": size["height"],
        }

    container_node = build_node_shell(
        node_id=spec["id"],
        position=root_position,
        data=deep_merge(container_data, spec.get("data")),
        width=size["width"],
        height=size["height"],
        z_index=1,
    )

    start_node = build_node_shell(
        node_id=start_node_id,
        custom_type=START_NODE_CUSTOM_TYPES[container_type],
        position=copy.deepcopy(CONTAINER_START_POSITION),
        data=deep_merge(
            {
                "title": "",
                "desc": "",
                "type": START_NODE_TYPES[container_type],
                "selected": False,
                **START_NODE_FLAGS[container_type],
            },
            spec.get("start_node_data"),
        ),
        width=44,
        height=48,
        parent_id=spec["id"],
        z_index=1002,
        draggable=False,
        selectable=False,
    )

    first_child = sequence[0]
    start_edge = build_edge(
        source_id=start_node_id,
        source_type=START_NODE_TYPES[container_type],
        target_id=first_child["id"],
        target_type=first_child["type"],
        in_iteration=container_type == "iteration",
        in_loop=container_type == "loop",
        iteration_id=spec["id"] if container_type == "iteration" else None,
        loop_id=spec["id"] if container_type == "loop" else None,
        z_index=1002,
    )

    dependencies = normalize_dependency(spec.get("dependencies") or spec.get("dependency"))
    dependencies.extend(child_dependencies)

    return [container_node, start_node, *child_nodes], [start_edge, *child_edges], dedupe_dependencies(dependencies)


def compile_spec(spec: dict[str, Any], *, template_base_dir: Path) -> dict[str, Any]:
    app_spec = spec.get("app") or {}
    workflow_spec = spec.get("workflow") or {}
    app_mode = app_spec.get("mode", "advanced-chat")
    if app_mode not in ROOT_START_BY_MODE:
        raise SpecValidationError(f"Unsupported app mode `{app_mode}`.")

    sequence = workflow_spec.get("nodes") or workflow_spec.get("sequence") or []
    if not sequence:
        raise SpecValidationError("`workflow.nodes` or `workflow.sequence` must be a non-empty list.")

    root_ctx = CompileContext(app_mode=app_mode)
    nodes, edges, auto_dependencies = compile_sequence(
        sequence,
        root_ctx,
        root_start_position=workflow_spec.get("root_start_position", ROOT_START_BY_MODE[app_mode]),
        template_base_dir=template_base_dir,
        edge_specs=workflow_spec.get("edges"),
    )

    workflow_data = {
        "graph": {
            "nodes": nodes,
            "edges": edges,
            "viewport": workflow_spec.get("viewport", {"x": 0, "y": 0, "zoom": 1}),
        },
        "features": workflow_spec.get("features", default_features()),
        "environment_variables": workflow_spec.get("environment_variables", []),
        "conversation_variables": workflow_spec.get("conversation_variables", []),
    }

    dependencies = normalize_dependency(spec.get("dependencies"))
    dependencies.extend(auto_dependencies)

    return {
        "version": spec.get("version", "0.6.0"),
        "kind": "app",
        "app": {
            "name": app_spec.get("name", "generated_dify_app"),
            "mode": app_mode,
            "description": app_spec.get("description", ""),
            "icon": app_spec.get("icon", "🤖"),
            "icon_background": app_spec.get("icon_background", "#FFEAD5"),
            "use_icon_as_answer_icon": app_spec.get("use_icon_as_answer_icon", False),
        },
        "dependencies": dedupe_dependencies(dependencies),
        "workflow": workflow_data,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate Dify workflow DSL YAML from a simplified spec.")
    parser.add_argument("spec", type=Path, help="Path to simplified workflow spec YAML.")
    parser.add_argument("-o", "--output", type=Path, help="Where to write generated DSL YAML.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        raw = yaml.safe_load(args.spec.read_text())
        if not isinstance(raw, dict):
            raise SpecValidationError("Top-level spec must be a mapping.")
        compiled = compile_spec(raw, template_base_dir=args.spec.parent)
        rendered = yaml.safe_dump(compiled, sort_keys=False, allow_unicode=True)
    except FileNotFoundError:
        print(f"Spec file not found: {args.spec}", file=sys.stderr)
        return 1
    except SpecValidationError as exc:
        print(f"Spec validation failed: {exc}", file=sys.stderr)
        return 2

    if args.output:
        args.output.write_text(rendered)
    else:
        sys.stdout.write(rendered)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
