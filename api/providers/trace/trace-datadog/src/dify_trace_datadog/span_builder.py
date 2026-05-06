"""
Datadog span attribute builder for Dify ops tracing.
"""

import json
from typing import Any

from core.ops.entities.trace_entity import (
    DatasetRetrievalTraceInfo,
    MessageTraceInfo,
    ToolTraceInfo,
    WorkflowTraceInfo,
)
from dify_trace_datadog import semconv
from graphon.entities.workflow_node_execution import WorkflowNodeExecution
from graphon.nodes import BuiltinNodeTypes

_PROMPT_MODEL_NODE_TYPES = (
    BuiltinNodeTypes.LLM,
    BuiltinNodeTypes.QUESTION_CLASSIFIER,
    BuiltinNodeTypes.PARAMETER_EXTRACTOR,
)


def _to_otel_message(role: str, content: str, *, finish_reason: str | None = None) -> dict[str, Any]:
    msg: dict[str, Any] = {"role": role, "parts": [{"type": "text", "content": content}]}
    if finish_reason is not None:
        msg["finish_reason"] = finish_reason
    return msg


def _convert_dify_prompt(prompt: dict[str, Any]) -> dict[str, Any]:
    role = prompt.get("role", "user")
    text = prompt.get("text", "") or prompt.get("content", "")
    return _to_otel_message(str(role), str(text).strip())


def _clean_provider_name(raw: str) -> str:
    if not raw:
        return ""
    if raw.startswith("langgenius/"):
        return raw.split("/", 2)[1]
    return raw


def _safe_json(obj: Any) -> str:
    try:
        return json.dumps(obj, ensure_ascii=False, default=str)
    except Exception:
        return str(obj)


def _token_count(value: Any) -> int | None:
    if isinstance(value, int) and not isinstance(value, bool):
        return value
    return None


def _normalize_input_messages(value: Any) -> list[dict[str, Any]]:
    if isinstance(value, list):
        messages: list[dict[str, Any]] = []
        for item in value:
            if isinstance(item, dict):
                messages.append(_convert_dify_prompt(item))
            else:
                messages.append(_to_otel_message("user", str(item)))
        return messages

    if isinstance(value, dict):
        if "role" in value and ("text" in value or "content" in value):
            return [_convert_dify_prompt(value)]
        return [_to_otel_message("user", _safe_json(value))]

    return [_to_otel_message("user", str(value) if value else "")]


def _normalize_output_messages(value: Any) -> list[dict[str, Any]]:
    if isinstance(value, list):
        messages: list[dict[str, Any]] = []
        for item in value:
            if isinstance(item, dict) and "role" in item and ("text" in item or "content" in item):
                role = str(item.get("role", "assistant"))
                text = str(item.get("text", "") or item.get("content", "")).strip()
                messages.append(_to_otel_message(role, text, finish_reason="stop"))
            else:
                messages.append(
                    _to_otel_message("assistant", _safe_json(item), finish_reason="stop")
                )
        return messages

    if isinstance(value, dict):
        if "role" in value and ("text" in value or "content" in value):
            role = str(value.get("role", "assistant"))
            text = str(value.get("text", "") or value.get("content", "")).strip()
            return [_to_otel_message(role, text, finish_reason="stop")]
        return [_to_otel_message("assistant", _safe_json(value), finish_reason="stop")]

    return [_to_otel_message("assistant", str(value) if value else "", finish_reason="stop")]


def _single_exchange_attrs(
    operation_name: str,
    input_text: str,
    output_text: str,
    **extra_attrs: Any,
) -> dict[str, Any]:
    attrs: dict[str, Any] = {
        semconv.OPERATION_NAME: operation_name,
        semconv.INPUT_MESSAGES: json.dumps(
            [_to_otel_message("user", input_text)], ensure_ascii=False
        ),
        semconv.OUTPUT_MESSAGES: json.dumps(
            [_to_otel_message("assistant", output_text, finish_reason="stop")],
            ensure_ascii=False,
        ),
    }
    attrs.update(extra_attrs)
    return attrs


def _add_token_attrs(
    attrs: dict[str, Any],
    *,
    input_tokens: int | None = None,
    output_tokens: int | None = None,
    total_tokens: int | None = None,
) -> None:
    if input_tokens is not None:
        attrs[semconv.USAGE_INPUT_TOKENS] = input_tokens
    if output_tokens is not None:
        attrs[semconv.USAGE_OUTPUT_TOKENS] = output_tokens
    if total_tokens is not None:
        attrs[semconv.USAGE_TOTAL_TOKENS] = total_tokens


def _build_llm_like_attrs(
    *,
    operation_name: str,
    provider: str,
    model: str,
    input_tokens: int,
    output_tokens: int,
    total_tokens: int | None = None,
    input_messages: list[dict[str, Any]],
    output_messages: list[dict[str, Any]],
    conversation_id: str | None = None,
    finish_reason: str | None = None,
) -> dict[str, Any]:
    attrs: dict[str, Any] = {
        semconv.OPERATION_NAME: operation_name,
        semconv.SYSTEM: provider,
        semconv.PROVIDER_NAME: provider,
        semconv.REQUEST_MODEL: model,
        semconv.RESPONSE_MODEL: model,
        semconv.INPUT_MESSAGES: json.dumps(input_messages, ensure_ascii=False),
        semconv.OUTPUT_MESSAGES: json.dumps(output_messages, ensure_ascii=False),
    }
    _add_token_attrs(attrs, input_tokens=input_tokens, output_tokens=output_tokens, total_tokens=total_tokens)

    if finish_reason is not None:
        attrs[semconv.RESPONSE_FINISH_REASONS] = [finish_reason]
    if conversation_id:
        attrs[semconv.CONVERSATION_ID] = conversation_id

    return attrs


# -- Public builders ----------------------------------------------------------


def build_message_attrs(trace_info: MessageTraceInfo) -> dict[str, Any]:
    metadata = trace_info.metadata or {}
    message_data = trace_info.message_data or {}
    operation_name = "completion" if str(trace_info.conversation_mode) == "completion" else "chat"

    if isinstance(message_data, dict):
        provider = message_data.get("model_provider", "") or metadata.get("ls_provider", "")
        model = message_data.get("model_id", "") or metadata.get("ls_model_name", "")
    else:
        provider = metadata.get("ls_provider", "")
        model = metadata.get("ls_model_name", "")

    return _build_llm_like_attrs(
        operation_name=operation_name,
        provider=_clean_provider_name(str(provider)),
        model=str(model),
        input_tokens=trace_info.message_tokens,
        output_tokens=trace_info.answer_tokens,
        total_tokens=trace_info.total_tokens,
        input_messages=_normalize_input_messages(trace_info.inputs),
        output_messages=_normalize_output_messages(trace_info.outputs),
        conversation_id=metadata.get("conversation_id"),
    )


def build_workflow_attrs(trace_info: WorkflowTraceInfo) -> dict[str, Any]:
    inputs = trace_info.workflow_run_inputs or {}
    outputs = trace_info.workflow_run_outputs or {}
    metadata = trace_info.metadata or {}

    query = inputs.get("sys.query") or inputs.get("query") or trace_info.query
    if not query:
        user_inputs = {key: value for key, value in inputs.items() if not str(key).startswith("sys.")}
        query = _safe_json(user_inputs) if user_inputs else ""
    answer = outputs.get("answer", "") or _safe_json(outputs)

    extra: dict[str, Any] = {}
    if trace_info.conversation_id:
        extra[semconv.CONVERSATION_ID] = trace_info.conversation_id
    if app_id := inputs.get("sys.app_id") or metadata.get("app_id"):
        extra[semconv.DIFY_APP_ID] = app_id
    if workflow_id := inputs.get("sys.workflow_id") or metadata.get("workflow_id") or trace_info.workflow_id:
        extra[semconv.DIFY_WORKFLOW_ID] = workflow_id

    attrs = _single_exchange_attrs("workflow", str(query), str(answer), **extra)
    _add_token_attrs(
        attrs,
        input_tokens=_token_count(trace_info.prompt_tokens),
        output_tokens=_token_count(trace_info.completion_tokens),
        total_tokens=_token_count(trace_info.total_tokens),
    )
    return attrs


def build_workflow_node_attrs(
    node_execution: WorkflowNodeExecution, trace_info: WorkflowTraceInfo
) -> dict[str, Any]:
    node_type = node_execution.node_type

    if node_type in _PROMPT_MODEL_NODE_TYPES:
        return _build_prompt_model_node_attrs(node_execution, trace_info)
    if node_type in (BuiltinNodeTypes.TOOL, BuiltinNodeTypes.HTTP_REQUEST):
        return _build_tool_node_attrs(node_execution)
    if node_type == BuiltinNodeTypes.KNOWLEDGE_RETRIEVAL:
        return _build_retrieval_node_attrs(node_execution)
    if node_type == BuiltinNodeTypes.AGENT:
        return _build_agent_node_attrs(node_execution)
    return _build_generic_node_attrs(node_execution)


def build_tool_attrs(trace_info: ToolTraceInfo) -> dict[str, Any]:
    tool_result = trace_info.tool_outputs
    if not isinstance(tool_result, str):
        tool_result = _safe_json(tool_result)

    return {
        semconv.OPERATION_NAME: "execute_tool",
        semconv.TOOL_NAME: trace_info.tool_name,
        semconv.TOOL_CALL_ARGUMENTS: _safe_json(trace_info.tool_inputs),
        semconv.TOOL_CALL_RESULT: tool_result or "",
    }


def build_retrieval_attrs(trace_info: DatasetRetrievalTraceInfo) -> dict[str, Any]:
    query = str(trace_info.inputs or "")
    documents = trace_info.documents or []

    doc_data = [
        {"content": doc.get("page_content", ""), "metadata": doc.get("metadata", {})}
        if isinstance(doc, dict)
        else {"content": doc.page_content, "metadata": doc.metadata}
        for doc in documents
    ]

    return _single_exchange_attrs("retrieval", query, _safe_json(doc_data))


# -- Private node builders ----------------------------------------------------


def _build_prompt_model_node_attrs(
    node_execution: WorkflowNodeExecution, trace_info: WorkflowTraceInfo
) -> dict[str, Any]:
    process_data = node_execution.process_data or {}
    outputs = node_execution.outputs or {}
    node_type = node_execution.node_type

    if node_type == BuiltinNodeTypes.PARAMETER_EXTRACTOR:
        usage = process_data.get("usage") or outputs.get("__usage") or {}
    elif node_type == BuiltinNodeTypes.LLM:
        usage = process_data.get("usage") or outputs.get("usage") or {}
    else:
        usage = process_data.get("usage", {}) or {}

    if node_type == BuiltinNodeTypes.LLM:
        output_text = str(outputs.get("text", ""))
        finish_reason = str(outputs.get("finish_reason", "stop"))
        mode = process_data.get("model_mode", "chat")
        operation_name = mode if mode in ("chat", "completion") else "chat"
    elif node_type == BuiltinNodeTypes.QUESTION_CLASSIFIER:
        output_text = str(outputs.get("class_name", "") or _safe_json(outputs))
        finish_reason = str(process_data.get("finish_reason", "stop"))
        operation_name = "chat"
    else:
        output_text = str(process_data.get("llm_text", "") or _safe_json(outputs))
        finish_reason = str(process_data.get("finish_reason", "stop"))
        operation_name = "chat"

    raw_prompts = process_data.get("prompts", [])

    return _build_llm_like_attrs(
        operation_name=operation_name,
        provider=_clean_provider_name(str(process_data.get("model_provider", ""))),
        model=str(process_data.get("model_name", "")),
        input_tokens=usage.get("prompt_tokens", 0) if isinstance(usage, dict) else 0,
        output_tokens=usage.get("completion_tokens", 0) if isinstance(usage, dict) else 0,
        total_tokens=usage.get("total_tokens") if isinstance(usage, dict) else None,
        input_messages=_normalize_input_messages(raw_prompts),
        output_messages=[
            _to_otel_message("assistant", output_text, finish_reason=finish_reason)
        ],
        conversation_id=trace_info.metadata.get("conversation_id"),
        finish_reason=finish_reason,
    )


def _build_tool_node_attrs(node_execution: WorkflowNodeExecution) -> dict[str, Any]:
    return {
        semconv.OPERATION_NAME: "execute_tool",
        semconv.TOOL_NAME: node_execution.title or "",
        semconv.TOOL_CALL_ARGUMENTS: _safe_json(node_execution.inputs or {}),
        semconv.TOOL_CALL_RESULT: _safe_json(node_execution.outputs or {}),
    }


def _build_retrieval_node_attrs(node_execution: WorkflowNodeExecution) -> dict[str, Any]:
    inputs = node_execution.inputs or {}
    outputs = node_execution.outputs or {}
    return _single_exchange_attrs(
        "retrieval",
        str(inputs.get("query", "")),
        _safe_json(outputs.get("result", [])),
    )


def _build_agent_node_attrs(node_execution: WorkflowNodeExecution) -> dict[str, Any]:
    return _single_exchange_attrs(
        "invoke_agent",
        _safe_json(node_execution.inputs or {}),
        _safe_json(node_execution.outputs or {}),
    )


def _build_generic_node_attrs(node_execution: WorkflowNodeExecution) -> dict[str, Any]:
    return _single_exchange_attrs(
        "workflow",
        _safe_json(node_execution.inputs or {}),
        _safe_json(node_execution.outputs or {}),
    )
