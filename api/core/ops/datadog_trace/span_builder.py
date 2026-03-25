"""
Datadog span attribute builder for Dify ops tracing.
"""

import json
from typing import Any

from core.ops.datadog_trace.entities import semconv
from core.ops.entities.trace_entity import (
    DatasetRetrievalTraceInfo,
    MessageTraceInfo,
    ToolTraceInfo,
    WorkflowTraceInfo,
)
from dify_graph.entities.workflow_node_execution import WorkflowNodeExecution
from dify_graph.nodes import BuiltinNodeTypes


class DatadogSpanBuilder:
    @staticmethod
    def _to_otel_message(role: str, content: str, *, finish_reason: str | None = None) -> dict[str, Any]:
        msg: dict[str, Any] = {"role": role, "parts": [{"type": "text", "content": content}]}
        if finish_reason is not None:
            msg["finish_reason"] = finish_reason
        return msg

    @staticmethod
    def _convert_dify_prompt(prompt: dict[str, Any]) -> dict[str, Any]:
        role = prompt.get("role", "user")
        text = prompt.get("text", "") or prompt.get("content", "")
        return DatadogSpanBuilder._to_otel_message(str(role), str(text).strip())

    @staticmethod
    def _clean_provider_name(raw: str) -> str:
        if not raw:
            return ""
        if raw.startswith("langgenius/"):
            return raw.split("/", 2)[1]
        return raw

    @staticmethod
    def _safe_json(obj: Any) -> str:
        try:
            return json.dumps(obj, ensure_ascii=False, default=str)
        except Exception:
            return str(obj)

    @staticmethod
    def _normalize_input_messages(value: Any) -> list[dict[str, Any]]:
        if isinstance(value, list):
            messages: list[dict[str, Any]] = []
            for item in value:
                if isinstance(item, dict):
                    messages.append(DatadogSpanBuilder._convert_dify_prompt(item))
                else:
                    messages.append(DatadogSpanBuilder._to_otel_message("user", str(item)))
            return messages

        if isinstance(value, dict):
            if "role" in value and ("text" in value or "content" in value):
                return [DatadogSpanBuilder._convert_dify_prompt(value)]
            return [DatadogSpanBuilder._to_otel_message("user", DatadogSpanBuilder._safe_json(value))]

        return [DatadogSpanBuilder._to_otel_message("user", str(value) if value else "")]

    @staticmethod
    def _normalize_output_messages(value: Any) -> list[dict[str, Any]]:
        if isinstance(value, list):
            messages: list[dict[str, Any]] = []
            for item in value:
                if isinstance(item, dict) and "role" in item and ("text" in item or "content" in item):
                    role = str(item.get("role", "assistant"))
                    text = str(item.get("text", "") or item.get("content", "")).strip()
                    messages.append(DatadogSpanBuilder._to_otel_message(role, text, finish_reason="stop"))
                else:
                    content = DatadogSpanBuilder._safe_json(item)
                    messages.append(
                        DatadogSpanBuilder._to_otel_message("assistant", content, finish_reason="stop")
                    )
            return messages

        if isinstance(value, dict):
            if "role" in value and ("text" in value or "content" in value):
                role = str(value.get("role", "assistant"))
                text = str(value.get("text", "") or value.get("content", "")).strip()
                return [DatadogSpanBuilder._to_otel_message(role, text, finish_reason="stop")]
            content = DatadogSpanBuilder._safe_json(value)
            return [DatadogSpanBuilder._to_otel_message("assistant", content, finish_reason="stop")]

        return [DatadogSpanBuilder._to_otel_message("assistant", str(value) if value else "", finish_reason="stop")]

    @staticmethod
    def _single_exchange_attrs(
        operation_name: str,
        input_text: str,
        output_text: str,
        **extra_attrs: Any,
    ) -> dict[str, Any]:
        attrs: dict[str, Any] = {
            semconv.OPERATION_NAME: operation_name,
            semconv.INPUT_MESSAGES: json.dumps(
                [DatadogSpanBuilder._to_otel_message("user", input_text)], ensure_ascii=False
            ),
            semconv.OUTPUT_MESSAGES: json.dumps(
                [DatadogSpanBuilder._to_otel_message("assistant", output_text, finish_reason="stop")],
                ensure_ascii=False,
            ),
        }
        attrs.update(extra_attrs)
        return attrs

    @staticmethod
    def _build_llm_like_attrs(
        *,
        operation_name: str,
        provider: str,
        model: str,
        input_tokens: int,
        output_tokens: int,
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
            semconv.USAGE_INPUT_TOKENS: input_tokens,
            semconv.USAGE_OUTPUT_TOKENS: output_tokens,
            semconv.INPUT_MESSAGES: json.dumps(input_messages, ensure_ascii=False),
            semconv.OUTPUT_MESSAGES: json.dumps(output_messages, ensure_ascii=False),
        }

        if finish_reason is not None:
            attrs[semconv.RESPONSE_FINISH_REASONS] = json.dumps([finish_reason], ensure_ascii=False)
        if conversation_id:
            attrs[semconv.CONVERSATION_ID] = conversation_id

        return attrs

    @staticmethod
    def build_message_attrs(trace_info: MessageTraceInfo) -> dict[str, Any]:
        metadata = trace_info.metadata or {}
        message_data = trace_info.message_data or {}

        if isinstance(message_data, dict):
            provider = message_data.get("model_provider", "") or metadata.get("ls_provider", "")
            model = message_data.get("model_id", "") or metadata.get("ls_model_name", "")
        else:
            provider = metadata.get("ls_provider", "")
            model = metadata.get("ls_model_name", "")

        return DatadogSpanBuilder._build_llm_like_attrs(
            operation_name="chat",
            provider=DatadogSpanBuilder._clean_provider_name(str(provider)),
            model=str(model),
            input_tokens=trace_info.message_tokens,
            output_tokens=trace_info.answer_tokens,
            input_messages=DatadogSpanBuilder._normalize_input_messages(trace_info.inputs),
            output_messages=DatadogSpanBuilder._normalize_output_messages(trace_info.outputs),
            conversation_id=metadata.get("conversation_id"),
        )

    @staticmethod
    def build_workflow_attrs(trace_info: WorkflowTraceInfo) -> dict[str, Any]:
        inputs = trace_info.workflow_run_inputs or {}
        outputs = trace_info.workflow_run_outputs or {}

        query = inputs.get("sys.query", "") or inputs.get("query", "")
        answer = outputs.get("answer", "") or DatadogSpanBuilder._safe_json(outputs)

        extra: dict[str, Any] = {}
        if trace_info.conversation_id:
            extra[semconv.CONVERSATION_ID] = trace_info.conversation_id
        if app_id := inputs.get("sys.app_id"):
            extra[semconv.DIFY_APP_ID] = app_id
        if workflow_id := inputs.get("sys.workflow_id"):
            extra[semconv.DIFY_WORKFLOW_ID] = workflow_id

        return DatadogSpanBuilder._single_exchange_attrs("workflow", str(query), str(answer), **extra)

    @staticmethod
    def build_workflow_node_attrs(
        node_execution: WorkflowNodeExecution, trace_info: WorkflowTraceInfo
    ) -> dict[str, Any]:
        node_type = node_execution.node_type

        _prompt_types = (
            BuiltinNodeTypes.LLM, BuiltinNodeTypes.QUESTION_CLASSIFIER, BuiltinNodeTypes.PARAMETER_EXTRACTOR,
        )
        if node_type in _prompt_types:
            return DatadogSpanBuilder._build_prompt_model_node_attrs(node_execution, trace_info)
        if node_type in (BuiltinNodeTypes.TOOL, BuiltinNodeTypes.HTTP_REQUEST):
            return DatadogSpanBuilder._build_tool_node_attrs(node_execution)
        if node_type == BuiltinNodeTypes.KNOWLEDGE_RETRIEVAL:
            return DatadogSpanBuilder._build_retrieval_node_attrs(node_execution)
        if node_type == BuiltinNodeTypes.AGENT:
            return DatadogSpanBuilder._build_agent_node_attrs(node_execution)
        return DatadogSpanBuilder._build_generic_node_attrs(node_execution)

    @staticmethod
    def _build_prompt_model_node_attrs(
        node_execution: WorkflowNodeExecution, trace_info: WorkflowTraceInfo
    ) -> dict[str, Any]:
        process_data = node_execution.process_data or {}
        outputs = node_execution.outputs or {}
        node_type = node_execution.node_type

        # Usage location differs per node type
        if node_type == BuiltinNodeTypes.PARAMETER_EXTRACTOR:
            usage = process_data.get("usage") or outputs.get("__usage") or {}
        elif node_type == BuiltinNodeTypes.LLM:
            usage = process_data.get("usage") or outputs.get("usage") or {}
        else:
            usage = process_data.get("usage", {}) or {}

        # Output text location differs per node type
        if node_type == BuiltinNodeTypes.LLM:
            output_text = str(outputs.get("text", ""))
            finish_reason = str(outputs.get("finish_reason", "stop"))
            mode = process_data.get("model_mode", "chat")
            operation_name = mode if mode in ("chat", "completion") else "chat"
        elif node_type == BuiltinNodeTypes.QUESTION_CLASSIFIER:
            output_text = str(outputs.get("class_name", "") or DatadogSpanBuilder._safe_json(outputs))
            finish_reason = str(process_data.get("finish_reason", "stop"))
            operation_name = "chat"
        else:
            output_text = str(process_data.get("llm_text", "") or DatadogSpanBuilder._safe_json(outputs))
            finish_reason = str(process_data.get("finish_reason", "stop"))
            operation_name = "chat"

        raw_prompts = process_data.get("prompts", [])

        return DatadogSpanBuilder._build_llm_like_attrs(
            operation_name=operation_name,
            provider=DatadogSpanBuilder._clean_provider_name(str(process_data.get("model_provider", ""))),
            model=str(process_data.get("model_name", "")),
            input_tokens=usage.get("prompt_tokens", 0) if isinstance(usage, dict) else 0,
            output_tokens=usage.get("completion_tokens", 0) if isinstance(usage, dict) else 0,
            input_messages=[DatadogSpanBuilder._convert_dify_prompt(p) for p in raw_prompts],
            output_messages=[
                DatadogSpanBuilder._to_otel_message("assistant", output_text, finish_reason=finish_reason)
            ],
            conversation_id=trace_info.metadata.get("conversation_id"),
            finish_reason=finish_reason,
        )

    @staticmethod
    def _build_tool_node_attrs(node_execution: WorkflowNodeExecution) -> dict[str, Any]:
        return {
            semconv.OPERATION_NAME: "execute_tool",
            semconv.TOOL_NAME: node_execution.title or "",
            semconv.TOOL_CALL_ARGUMENTS: DatadogSpanBuilder._safe_json(node_execution.inputs or {}),
            semconv.TOOL_CALL_RESULT: DatadogSpanBuilder._safe_json(node_execution.outputs or {}),
        }

    @staticmethod
    def _build_retrieval_node_attrs(node_execution: WorkflowNodeExecution) -> dict[str, Any]:
        inputs = node_execution.inputs or {}
        outputs = node_execution.outputs or {}
        return DatadogSpanBuilder._single_exchange_attrs(
            "retrieval",
            str(inputs.get("query", "")),
            DatadogSpanBuilder._safe_json(outputs.get("result", [])),
        )

    @staticmethod
    def _build_agent_node_attrs(node_execution: WorkflowNodeExecution) -> dict[str, Any]:
        return DatadogSpanBuilder._single_exchange_attrs(
            "invoke_agent",
            DatadogSpanBuilder._safe_json(node_execution.inputs or {}),
            DatadogSpanBuilder._safe_json(node_execution.outputs or {}),
        )

    @staticmethod
    def _build_generic_node_attrs(node_execution: WorkflowNodeExecution) -> dict[str, Any]:
        return DatadogSpanBuilder._single_exchange_attrs(
            "workflow",
            DatadogSpanBuilder._safe_json(node_execution.inputs or {}),
            DatadogSpanBuilder._safe_json(node_execution.outputs or {}),
        )

    @staticmethod
    def build_tool_attrs(trace_info: ToolTraceInfo) -> dict[str, Any]:
        tool_result = trace_info.tool_outputs
        if not isinstance(tool_result, str):
            tool_result = DatadogSpanBuilder._safe_json(tool_result)

        return {
            semconv.OPERATION_NAME: "execute_tool",
            semconv.TOOL_NAME: trace_info.tool_name,
            semconv.TOOL_CALL_ARGUMENTS: DatadogSpanBuilder._safe_json(trace_info.tool_inputs),
            semconv.TOOL_CALL_RESULT: tool_result or "",
        }

    @staticmethod
    def build_retrieval_attrs(trace_info: DatasetRetrievalTraceInfo) -> dict[str, Any]:
        query = str(trace_info.inputs or "")
        documents = trace_info.documents or []

        doc_data = [
            {"content": doc.get("page_content", ""), "metadata": doc.get("metadata", {})}
            if isinstance(doc, dict)
            else {"content": doc.page_content, "metadata": doc.metadata}
            for doc in documents
        ]

        return DatadogSpanBuilder._single_exchange_attrs(
            "retrieval", query, DatadogSpanBuilder._safe_json(doc_data)
        )
