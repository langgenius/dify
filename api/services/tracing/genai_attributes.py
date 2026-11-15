"""GenAI semantic attributes shared by the Aliyun and Tencent adapters."""

from core.ops.unified_trace.entities import CanonicalSpan, CanonicalSpanKind, CanonicalTrace
from services.tracing.provider_common import json_value, token_usage


def attributes(span: CanonicalSpan, trace: CanonicalTrace, provider: str) -> dict[str, object]:
    kind = span.kind.value.upper()
    if provider == "tencent":
        kind = {"LLM": "GENERATION", "CHAIN": "WORKFLOW"}.get(kind, kind)
    result: dict[str, object] = {
        "gen_ai.span.kind": kind,
        "gen_ai.session.id": trace.session_id,
        "gen_ai.framework": "dify",
        "dify.span.id": span.id,
        "dify.metadata": json_value(span.metadata),
        "gen_ai.entity.input" if provider == "tencent" else "input.value": json_value(span.inputs),
        "gen_ai.entity.output" if provider == "tencent" else "output.value": json_value(span.outputs),
    }
    if provider == "tencent" and span.id == trace.root_span_id:
        result["gen_ai.is_entry"] = "true"
    for key in ("tenant_id", "app_id", "agent_id", "workflow_run_id", "node_execution_id", "message_id"):
        value = span.metadata.get(key) or trace.spans[0].metadata.get(key)
        if value:
            result[f"dify.{key}"] = str(value)
    user_id = span.metadata.get("user_id") or trace.spans[0].metadata.get("user_id")
    if user_id:
        result["gen_ai.user.id"] = str(user_id)
    if span.kind is CanonicalSpanKind.LLM:
        result["gen_ai.operation.name"] = "chat"
        result["gen_ai.prompt"] = json_value(span.inputs)
        result["gen_ai.completion"] = json_value(span.outputs)
        result["gen_ai.input.messages"] = json_value(span.inputs)
        result["gen_ai.output.messages"] = json_value(span.outputs)
        model = span.metadata.get("model") or span.metadata.get("model_name")
        if model:
            result["gen_ai.request.model"] = str(model)
            result["gen_ai.response.model"] = str(model)
        if span.metadata.get("model_provider"):
            result["gen_ai.provider.name"] = str(span.metadata["model_provider"])
        result.update({f"gen_ai.usage.{key}_tokens": value for key, value in token_usage(span).items()})
        ttft = span.metadata.get("time_to_first_token", span.metadata.get("ttft"))
        if isinstance(ttft, (int, float)) and ttft >= 0:
            result["gen_ai.response.time_to_first_token"] = int(ttft * 1_000_000_000)
    elif span.kind is CanonicalSpanKind.AGENT:
        result["gen_ai.operation.name"] = "invoke_agent"
        result["gen_ai.agent.name"] = span.name
    elif span.kind is CanonicalSpanKind.TOOL:
        result["gen_ai.operation.name"] = "execute_tool"
        result["gen_ai.tool.name"] = span.name
        result["gen_ai.tool.call.arguments"] = json_value(span.inputs)
        result["gen_ai.tool.call.result"] = json_value(span.outputs)
        result["tool.name"] = span.name
        result["tool.parameters"] = json_value(span.inputs)
    elif span.kind is CanonicalSpanKind.RETRIEVER:
        result["retrieval.query"] = json_value(span.inputs)
        result["retrieval.document"] = json_value(span.outputs)
    return result
