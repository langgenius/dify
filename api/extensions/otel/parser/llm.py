"""
Parser for LLM nodes that captures LLM-specific metadata.
"""

import logging
from collections.abc import Mapping
from typing import Any

from opentelemetry.trace import Span

from core.workflow.graph_events import GraphNodeEventBase
from core.workflow.nodes.base.node import Node
from extensions.otel.parser.base import DefaultNodeOTelParser, safe_json_dumps
from extensions.otel.semconv.gen_ai import LLMAttributes

logger = logging.getLogger(__name__)


def _format_input_messages(process_data: Mapping[str, Any]) -> str:
    """
    Format input messages from process_data for LLM spans.

    Args:
        process_data: Process data containing prompts

    Returns:
        JSON string of formatted input messages
    """
    try:
        if not isinstance(process_data, dict):
            return safe_json_dumps([])

        prompts = process_data.get("prompts", [])
        if not prompts:
            return safe_json_dumps([])

        valid_roles = {"system", "user", "assistant", "tool"}
        input_messages = []
        for prompt in prompts:
            if not isinstance(prompt, dict):
                continue

            role = prompt.get("role", "")
            text = prompt.get("text", "")

            if not role or role not in valid_roles:
                continue

            if text:
                message = {"role": role, "parts": [{"type": "text", "content": text}]}
                input_messages.append(message)

        return safe_json_dumps(input_messages)
    except Exception as e:
        logger.warning("Failed to format input messages: %s", e, exc_info=True)
        return safe_json_dumps([])


def _format_output_messages(outputs: Mapping[str, Any]) -> str:
    """
    Format output messages from outputs for LLM spans.

    Args:
        outputs: Output data containing text and finish_reason

    Returns:
        JSON string of formatted output messages
    """
    try:
        if not isinstance(outputs, dict):
            return safe_json_dumps([])

        text = outputs.get("text", "")
        finish_reason = outputs.get("finish_reason", "")

        if not text:
            return safe_json_dumps([])

        valid_finish_reasons = {"stop", "length", "content_filter", "tool_call", "error"}
        if finish_reason not in valid_finish_reasons:
            finish_reason = "stop"

        output_message = {
            "role": "assistant",
            "parts": [{"type": "text", "content": text}],
            "finish_reason": finish_reason,
        }

        return safe_json_dumps([output_message])
    except Exception as e:
        logger.warning("Failed to format output messages: %s", e, exc_info=True)
        return safe_json_dumps([])


class LLMNodeOTelParser:
    """Parser for LLM nodes that captures LLM-specific metadata."""

    def __init__(self) -> None:
        self._delegate = DefaultNodeOTelParser()

    def parse(
        self, *, node: Node, span: "Span", error: Exception | None, result_event: GraphNodeEventBase | None = None
    ) -> None:
        self._delegate.parse(node=node, span=span, error=error, result_event=result_event)

        if not result_event or not result_event.node_run_result:
            return

        node_run_result = result_event.node_run_result
        process_data = node_run_result.process_data or {}
        outputs = node_run_result.outputs or {}

        # Extract usage data (from process_data or outputs)
        usage_data = process_data.get("usage") or outputs.get("usage") or {}

        # Model and provider information
        model_name = process_data.get("model_name") or ""
        model_provider = process_data.get("model_provider") or ""

        if model_name:
            span.set_attribute(LLMAttributes.REQUEST_MODEL, model_name)
        if model_provider:
            span.set_attribute(LLMAttributes.PROVIDER_NAME, model_provider)

        # Token usage
        if usage_data:
            prompt_tokens = usage_data.get("prompt_tokens", 0)
            completion_tokens = usage_data.get("completion_tokens", 0)
            total_tokens = usage_data.get("total_tokens", 0)

            span.set_attribute(LLMAttributes.USAGE_INPUT_TOKENS, prompt_tokens)
            span.set_attribute(LLMAttributes.USAGE_OUTPUT_TOKENS, completion_tokens)
            span.set_attribute(LLMAttributes.USAGE_TOTAL_TOKENS, total_tokens)

        # Prompts and completion
        prompts = process_data.get("prompts", [])
        if prompts:
            prompts_json = safe_json_dumps(prompts)
            span.set_attribute(LLMAttributes.PROMPT, prompts_json)

        text_output = str(outputs.get("text", ""))
        if text_output:
            span.set_attribute(LLMAttributes.COMPLETION, text_output)

        # Finish reason
        finish_reason = outputs.get("finish_reason") or ""
        if finish_reason:
            span.set_attribute(LLMAttributes.RESPONSE_FINISH_REASON, finish_reason)

        # Structured input/output messages
        gen_ai_input_message = _format_input_messages(process_data)
        gen_ai_output_message = _format_output_messages(outputs)

        span.set_attribute(LLMAttributes.INPUT_MESSAGE, gen_ai_input_message)
        span.set_attribute(LLMAttributes.OUTPUT_MESSAGE, gen_ai_output_message)
