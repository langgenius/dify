"""OpenTelemetry GenAI semantic-convention attributes shared by GenAI-dialect providers."""

from collections.abc import Mapping
from dataclasses import dataclass

from dify_trace_sdk.exporting import json_value
from dify_trace_sdk.model import Span, SpanKind, Trace

_DIFY_ID_ATTRIBUTES = ("tenant_id", "app_id", "agent_id", "workflow_run_id", "node_execution_id", "message_id")


@dataclass(frozen=True)
class GenAIDialect:
    """The few places where GenAI-compatible destinations disagree."""

    kind_labels: Mapping[SpanKind, str]
    input_key: str
    output_key: str
    mark_entry_span: bool


def genai_attributes(span: Span, trace: Trace, dialect: GenAIDialect) -> dict[str, object]:
    root = trace.root
    result: dict[str, object] = {
        "gen_ai.span.kind": dialect.kind_labels.get(span.kind, span.kind.value.upper()),
        "gen_ai.session.id": trace.session_id,
        "gen_ai.framework": "dify",
        "dify.span.id": span.span_id,
        "dify.metadata": json_value(span.attributes),
        dialect.input_key: json_value(span.inputs),
        dialect.output_key: json_value(span.outputs),
    }
    if dialect.mark_entry_span and span is root and trace.parent is None:
        result["gen_ai.is_entry"] = "true"
    for key in _DIFY_ID_ATTRIBUTES:
        value = span.attributes.get(key) or root.attributes.get(key)
        if value:
            result[f"dify.{key}"] = str(value)
    if trace.user_id:
        result["gen_ai.user.id"] = trace.user_id
    if span.kind is SpanKind.LLM:
        result["gen_ai.operation.name"] = "chat"
        result["gen_ai.prompt"] = json_value(span.inputs)
        result["gen_ai.completion"] = json_value(span.outputs)
        result["gen_ai.input.messages"] = json_value(span.inputs)
        result["gen_ai.output.messages"] = json_value(span.outputs)
        if span.model_name:
            result["gen_ai.request.model"] = span.model_name
            result["gen_ai.response.model"] = span.model_name
        if span.model_provider:
            result["gen_ai.provider.name"] = span.model_provider
        if span.usage is not None:
            result["gen_ai.usage.input_tokens"] = span.usage.prompt_tokens
            result["gen_ai.usage.output_tokens"] = span.usage.completion_tokens
            result["gen_ai.usage.total_tokens"] = span.usage.total_tokens
        if span.time_to_first_token is not None:
            result["gen_ai.response.time_to_first_token"] = int(span.time_to_first_token * 1_000_000_000)
    elif span.kind is SpanKind.AGENT:
        result["gen_ai.operation.name"] = "invoke_agent"
        result["gen_ai.agent.name"] = span.name
    elif span.kind is SpanKind.TOOL:
        result["gen_ai.operation.name"] = "execute_tool"
        result["gen_ai.tool.name"] = span.name
        result["gen_ai.tool.call.arguments"] = json_value(span.inputs)
        result["gen_ai.tool.call.result"] = json_value(span.outputs)
        result["tool.name"] = span.name
        result["tool.parameters"] = json_value(span.inputs)
    elif span.kind is SpanKind.RETRIEVER:
        result["retrieval.query"] = json_value(span.inputs)
        result["retrieval.document"] = json_value(span.outputs)
    return result
