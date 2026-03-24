"""
Datadog span attribute builder for Dify ops tracing.
"""

import json
import logging
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

logger = logging.getLogger(__name__)


class DatadogSpanBuilder:
    @staticmethod
    def _to_otel_message(role: str, content: str) -> dict[str, Any]:
        return {"role": role, "parts": [{"type": "text", "content": content}]}

    @staticmethod
    def _to_otel_output_message(role: str, content: str, finish_reason: str = "stop") -> dict[str, Any]:
        return {
            "role": role,
            "parts": [{"type": "text", "content": content}],
            "finish_reason": finish_reason,
        }

    @staticmethod
    def _convert_dify_prompt(prompt: dict[str, Any]) -> dict[str, Any]:
        """
        Transform Dify prompt payloads into OTel v1.37 chat messages.
        """
        role = prompt.get("role", "user")
        text = prompt.get("text", "") or prompt.get("content", "")
        return DatadogSpanBuilder._to_otel_message(str(role), str(text).strip())

    @staticmethod
    def _clean_provider_name(raw: str) -> str:
        """
        Strip Dify's provider prefix so Datadog receives the canonical provider name.
        """
        if not raw:
            return ""
        if raw.startswith("langgenius/"):
            parts = raw.split("/")
            if len(parts) > 1:
                return parts[1]
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
                    converted = DatadogSpanBuilder._convert_dify_prompt(item)
                    messages.append(
                        DatadogSpanBuilder._to_otel_output_message(
                            str(converted.get("role", "assistant")),
                            str(converted["parts"][0]["content"]),
                        )
                    )
                else:
                    messages.append(
                        DatadogSpanBuilder._to_otel_output_message("assistant", DatadogSpanBuilder._safe_json(item))
                    )
            return messages

        if isinstance(value, dict):
            if "role" in value and ("text" in value or "content" in value):
                converted = DatadogSpanBuilder._convert_dify_prompt(value)
                return [
                    DatadogSpanBuilder._to_otel_output_message(
                        str(converted.get("role", "assistant")),
                        str(converted["parts"][0]["content"]),
                    )
                ]
            return [DatadogSpanBuilder._to_otel_output_message("assistant", DatadogSpanBuilder._safe_json(value))]

        return [DatadogSpanBuilder._to_otel_output_message("assistant", str(value) if value else "")]

    @staticmethod
    def build_message_attrs(trace_info: MessageTraceInfo) -> dict[str, Any]:
        """
        Build Datadog attributes for a message span.
        """
        metadata = trace_info.metadata or {}
        message_data = trace_info.message_data or {}

        if isinstance(message_data, dict):
            provider = message_data.get("model_provider", "") or metadata.get("ls_provider", "")
            model = message_data.get("model_id", "") or metadata.get("ls_model_name", "")
        else:
            provider = metadata.get("ls_provider", "")
            model = metadata.get("ls_model_name", "")

        provider = DatadogSpanBuilder._clean_provider_name(str(provider))
        input_messages = DatadogSpanBuilder._normalize_input_messages(trace_info.inputs)
        output_messages = DatadogSpanBuilder._normalize_output_messages(trace_info.outputs)

        attrs: dict[str, Any] = {
            semconv.OPERATION_NAME: "chat",
            semconv.SYSTEM: provider,
            semconv.PROVIDER_NAME: provider,
            semconv.REQUEST_MODEL: model,
            semconv.RESPONSE_MODEL: model,
            semconv.USAGE_INPUT_TOKENS: trace_info.message_tokens,
            semconv.USAGE_OUTPUT_TOKENS: trace_info.answer_tokens,
            semconv.INPUT_MESSAGES: json.dumps(input_messages, ensure_ascii=False),
            semconv.OUTPUT_MESSAGES: json.dumps(output_messages, ensure_ascii=False),
        }

        if conversation_id := metadata.get("conversation_id"):
            attrs[semconv.CONVERSATION_ID] = conversation_id

        return attrs

    @staticmethod
    def build_workflow_attrs(trace_info: WorkflowTraceInfo) -> dict[str, Any]:
        """
        Build Datadog attributes for a workflow root span.
        """
        inputs = trace_info.workflow_run_inputs or {}
        outputs = trace_info.workflow_run_outputs or {}

        query = inputs.get("sys.query", "") or inputs.get("query", "")
        answer = outputs.get("answer", "") or DatadogSpanBuilder._safe_json(outputs)

        attrs: dict[str, Any] = {
            semconv.OPERATION_NAME: "workflow",
            semconv.INPUT_MESSAGES: json.dumps(
                [DatadogSpanBuilder._to_otel_message("user", str(query))],
                ensure_ascii=False,
            ),
            semconv.OUTPUT_MESSAGES: json.dumps(
                [DatadogSpanBuilder._to_otel_output_message("assistant", str(answer))],
                ensure_ascii=False,
            ),
        }

        if trace_info.conversation_id:
            attrs[semconv.CONVERSATION_ID] = trace_info.conversation_id

        if app_id := inputs.get("sys.app_id"):
            attrs["dify.app_id"] = app_id
        if workflow_id := inputs.get("sys.workflow_id"):
            attrs["dify.workflow_id"] = workflow_id

        return attrs

    @staticmethod
    def build_workflow_node_attrs(
        node_execution: WorkflowNodeExecution, trace_info: WorkflowTraceInfo
    ) -> dict[str, Any]:
        """
        Dispatch workflow node span attributes based on node type.
        """
        node_type = node_execution.node_type

        if node_type == BuiltinNodeTypes.LLM:
            return DatadogSpanBuilder._build_llm_node_attrs(node_execution, trace_info)
        if node_type == BuiltinNodeTypes.QUESTION_CLASSIFIER:
            return DatadogSpanBuilder._build_classifier_node_attrs(node_execution, trace_info)
        if node_type == BuiltinNodeTypes.PARAMETER_EXTRACTOR:
            return DatadogSpanBuilder._build_extractor_node_attrs(node_execution, trace_info)
        if node_type in (BuiltinNodeTypes.TOOL, BuiltinNodeTypes.HTTP_REQUEST):
            return DatadogSpanBuilder._build_tool_node_attrs(node_execution)
        if node_type == BuiltinNodeTypes.KNOWLEDGE_RETRIEVAL:
            return DatadogSpanBuilder._build_retrieval_node_attrs(node_execution)
        if node_type == BuiltinNodeTypes.AGENT:
            return DatadogSpanBuilder._build_agent_node_attrs(node_execution)
        return DatadogSpanBuilder._build_generic_node_attrs(node_execution)

    @staticmethod
    def _build_llm_node_attrs(
        node_execution: WorkflowNodeExecution, trace_info: WorkflowTraceInfo
    ) -> dict[str, Any]:
        """
        Build Datadog attributes for an LLM workflow node.
        """
        process_data = node_execution.process_data or {}
        outputs = node_execution.outputs or {}
        usage = process_data.get("usage", {}) if "usage" in process_data else outputs.get("usage", {})

        provider = DatadogSpanBuilder._clean_provider_name(str(process_data.get("model_provider", "")))
        model = str(process_data.get("model_name", ""))
        mode = process_data.get("model_mode", "chat")
        finish_reason = str(outputs.get("finish_reason", "stop"))

        raw_prompts = process_data.get("prompts", [])
        input_messages = [DatadogSpanBuilder._convert_dify_prompt(prompt) for prompt in raw_prompts]

        output_text = str(outputs.get("text", ""))
        output_messages = [
            DatadogSpanBuilder._to_otel_output_message("assistant", output_text, finish_reason)
        ]

        attrs: dict[str, Any] = {
            semconv.OPERATION_NAME: mode if mode in ("chat", "completion") else "chat",
            semconv.SYSTEM: provider,
            semconv.PROVIDER_NAME: provider,
            semconv.REQUEST_MODEL: model,
            semconv.RESPONSE_MODEL: model,
            semconv.USAGE_INPUT_TOKENS: usage.get("prompt_tokens", 0),
            semconv.USAGE_OUTPUT_TOKENS: usage.get("completion_tokens", 0),
            semconv.RESPONSE_FINISH_REASONS: json.dumps([finish_reason], ensure_ascii=False),
            semconv.INPUT_MESSAGES: json.dumps(input_messages, ensure_ascii=False),
            semconv.OUTPUT_MESSAGES: json.dumps(output_messages, ensure_ascii=False),
        }

        if conversation_id := trace_info.metadata.get("conversation_id"):
            attrs[semconv.CONVERSATION_ID] = conversation_id

        return attrs

    @staticmethod
    def _build_classifier_node_attrs(
        node_execution: WorkflowNodeExecution, trace_info: WorkflowTraceInfo
    ) -> dict[str, Any]:
        """
        Build Datadog attributes for a question classifier node.
        """
        process_data = node_execution.process_data or {}
        outputs = node_execution.outputs or {}
        usage = process_data.get("usage", {}) or {}

        provider = DatadogSpanBuilder._clean_provider_name(str(process_data.get("model_provider", "")))
        model = str(process_data.get("model_name", ""))
        finish_reason = str(process_data.get("finish_reason", "stop"))

        raw_prompts = process_data.get("prompts", [])
        input_messages = [DatadogSpanBuilder._convert_dify_prompt(prompt) for prompt in raw_prompts]

        output_text = outputs.get("class_name", "") or DatadogSpanBuilder._safe_json(outputs)
        output_messages = [
            DatadogSpanBuilder._to_otel_output_message("assistant", str(output_text), finish_reason)
        ]

        attrs: dict[str, Any] = {
            semconv.OPERATION_NAME: "chat",
            semconv.SYSTEM: provider,
            semconv.PROVIDER_NAME: provider,
            semconv.REQUEST_MODEL: model,
            semconv.RESPONSE_MODEL: model,
            semconv.USAGE_INPUT_TOKENS: usage.get("prompt_tokens", 0) if isinstance(usage, dict) else 0,
            semconv.USAGE_OUTPUT_TOKENS: usage.get("completion_tokens", 0) if isinstance(usage, dict) else 0,
            semconv.RESPONSE_FINISH_REASONS: json.dumps([finish_reason], ensure_ascii=False),
            semconv.INPUT_MESSAGES: json.dumps(input_messages, ensure_ascii=False),
            semconv.OUTPUT_MESSAGES: json.dumps(output_messages, ensure_ascii=False),
        }

        if conversation_id := trace_info.metadata.get("conversation_id"):
            attrs[semconv.CONVERSATION_ID] = conversation_id

        return attrs

    @staticmethod
    def _build_extractor_node_attrs(
        node_execution: WorkflowNodeExecution, trace_info: WorkflowTraceInfo
    ) -> dict[str, Any]:
        """
        Build Datadog attributes for a parameter extractor node.
        """
        process_data = node_execution.process_data or {}
        outputs = node_execution.outputs or {}
        usage = process_data.get("usage") or outputs.get("__usage") or {}

        provider = DatadogSpanBuilder._clean_provider_name(str(process_data.get("model_provider", "")))
        model = str(process_data.get("model_name", ""))
        finish_reason = str(process_data.get("finish_reason", "stop"))

        raw_prompts = process_data.get("prompts", [])
        input_messages = [DatadogSpanBuilder._convert_dify_prompt(prompt) for prompt in raw_prompts]

        output_text = process_data.get("llm_text", "") or DatadogSpanBuilder._safe_json(outputs)
        output_messages = [
            DatadogSpanBuilder._to_otel_output_message("assistant", str(output_text), finish_reason)
        ]

        attrs: dict[str, Any] = {
            semconv.OPERATION_NAME: "chat",
            semconv.SYSTEM: provider,
            semconv.PROVIDER_NAME: provider,
            semconv.REQUEST_MODEL: model,
            semconv.RESPONSE_MODEL: model,
            semconv.USAGE_INPUT_TOKENS: usage.get("prompt_tokens", 0) if isinstance(usage, dict) else 0,
            semconv.USAGE_OUTPUT_TOKENS: usage.get("completion_tokens", 0) if isinstance(usage, dict) else 0,
            semconv.RESPONSE_FINISH_REASONS: json.dumps([finish_reason], ensure_ascii=False),
            semconv.INPUT_MESSAGES: json.dumps(input_messages, ensure_ascii=False),
            semconv.OUTPUT_MESSAGES: json.dumps(output_messages, ensure_ascii=False),
        }

        if conversation_id := trace_info.metadata.get("conversation_id"):
            attrs[semconv.CONVERSATION_ID] = conversation_id

        return attrs

    @staticmethod
    def _build_tool_node_attrs(node_execution: WorkflowNodeExecution) -> dict[str, Any]:
        """
        Build Datadog attributes for tool-like workflow nodes.
        """
        return {
            semconv.OPERATION_NAME: "execute_tool",
            semconv.TOOL_NAME: node_execution.title or "",
            semconv.TOOL_CALL_ARGUMENTS: DatadogSpanBuilder._safe_json(node_execution.inputs or {}),
            semconv.TOOL_CALL_RESULT: DatadogSpanBuilder._safe_json(node_execution.outputs or {}),
        }

    @staticmethod
    def _build_retrieval_node_attrs(node_execution: WorkflowNodeExecution) -> dict[str, Any]:
        """
        Build Datadog attributes for a knowledge retrieval workflow node.
        """
        inputs = node_execution.inputs or {}
        outputs = node_execution.outputs or {}

        return {
            semconv.OPERATION_NAME: "retrieval",
            semconv.INPUT_MESSAGES: json.dumps(
                [DatadogSpanBuilder._to_otel_message("user", str(inputs.get("query", "")))],
                ensure_ascii=False,
            ),
            semconv.OUTPUT_MESSAGES: json.dumps(
                [
                    DatadogSpanBuilder._to_otel_output_message(
                        "assistant",
                        DatadogSpanBuilder._safe_json(outputs.get("result", [])),
                    )
                ],
                ensure_ascii=False,
            ),
        }

    @staticmethod
    def _build_agent_node_attrs(node_execution: WorkflowNodeExecution) -> dict[str, Any]:
        """
        Build Datadog attributes for an agent workflow node.
        """
        return {
            semconv.OPERATION_NAME: "invoke_agent",
            semconv.INPUT_MESSAGES: json.dumps(
                [
                    DatadogSpanBuilder._to_otel_message(
                        "user",
                        DatadogSpanBuilder._safe_json(node_execution.inputs or {}),
                    )
                ],
                ensure_ascii=False,
            ),
            semconv.OUTPUT_MESSAGES: json.dumps(
                [
                    DatadogSpanBuilder._to_otel_output_message(
                        "assistant",
                        DatadogSpanBuilder._safe_json(node_execution.outputs or {}),
                    )
                ],
                ensure_ascii=False,
            ),
        }

    @staticmethod
    def _build_generic_node_attrs(node_execution: WorkflowNodeExecution) -> dict[str, Any]:
        """
        Build Datadog attributes for non-LLM, non-tool workflow nodes.
        """
        return {
            semconv.OPERATION_NAME: "workflow",
            semconv.INPUT_MESSAGES: json.dumps(
                [
                    DatadogSpanBuilder._to_otel_message(
                        "user",
                        DatadogSpanBuilder._safe_json(node_execution.inputs or {}),
                    )
                ],
                ensure_ascii=False,
            ),
            semconv.OUTPUT_MESSAGES: json.dumps(
                [
                    DatadogSpanBuilder._to_otel_output_message(
                        "assistant",
                        DatadogSpanBuilder._safe_json(node_execution.outputs or {}),
                    )
                ],
                ensure_ascii=False,
            ),
        }

    @staticmethod
    def build_tool_attrs(trace_info: ToolTraceInfo) -> dict[str, Any]:
        """
        Build Datadog attributes for a standalone tool trace.
        """
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
        """
        Build Datadog attributes for a standalone dataset retrieval trace.
        """
        query = str(trace_info.inputs or "")
        documents = trace_info.documents or []

        doc_data = []
        for doc in documents:
            doc_data.append(
                {
                    "content": doc.page_content,
                    "metadata": doc.metadata,
                }
            )

        return {
            semconv.OPERATION_NAME: "retrieval",
            semconv.INPUT_MESSAGES: json.dumps(
                [DatadogSpanBuilder._to_otel_message("user", query)],
                ensure_ascii=False,
            ),
            semconv.OUTPUT_MESSAGES: json.dumps(
                [
                    DatadogSpanBuilder._to_otel_output_message(
                        "assistant",
                        DatadogSpanBuilder._safe_json(doc_data),
                    )
                ],
                ensure_ascii=False,
            ),
        }
