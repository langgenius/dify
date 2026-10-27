"""Normalize Agent SDK observations without conflating business and provider IDs."""

import hashlib
import json
from collections.abc import Mapping, Sequence
from datetime import UTC, datetime
from typing import Any

from core.ops.unified_trace.entities import CanonicalSpan, CanonicalSpanKind, CanonicalSpanStatus, CanonicalTrace

MAX_VALUE_CHARS = 16000
_SECRET_KEYS = frozenset(
    {
        "api_key",
        "apikey",
        "secret",
        "secret_key",
        "authorization",
        "password",
        "access_token",
        "refresh_token",
        "credentials",
    }
)
_CONTENT_ATTRIBUTES = frozenset(
    {
        "gen_ai.input.messages",
        "gen_ai.output.messages",
        "gen_ai.system_instructions",
        "gen_ai.prompt",
        "gen_ai.completion",
        "tool_arguments",
        "tool_response",
        "gen_ai.tool.call.arguments",
        "gen_ai.tool.call.result",
        "input",
        "output",
        "inputs",
        "outputs",
    }
)


def span_id(logical_id: str) -> str:
    """Stable nonzero OTel span identity for Dify's persisted logical ID."""
    value = hashlib.sha256(f"dify-application-span:{logical_id}".encode()).hexdigest()[:16]
    return value if int(value, 16) else "0000000000000001"


def sanitize(value: Any, *, depth: int = 0) -> Any:
    if depth > 12:
        return "[truncated]"
    if isinstance(value, Mapping):
        return {
            str(k): "[redacted]" if str(k).lower() in _SECRET_KEYS else sanitize(v, depth=depth + 1)
            for k, v in value.items()
        }
    if isinstance(value, (list, tuple)):
        return [sanitize(item, depth=depth + 1) for item in value[:256]]
    if isinstance(value, str):
        if value.lstrip().startswith(("{", "[")):
            try:
                decoded = json.loads(value)
            except ValueError:
                pass
            else:
                if isinstance(decoded, (dict, list)):
                    return sanitize(decoded, depth=depth + 1)
        return value[:MAX_VALUE_CHARS] + ("[truncated]" if len(value) > MAX_VALUE_CHARS else "")
    if value is None or isinstance(value, (int, float, bool)):
        return value
    return str(value)[:MAX_VALUE_CHARS]


def safe_attributes(attributes: Mapping[str, Any], *, capture_content: bool) -> dict[str, Any]:
    """Content-off is an allowlist, including metadata and error attributes."""
    if capture_content:
        result = sanitize(attributes)
        return dict(result) if isinstance(result, Mapping) else {}
    safe = {
        "gen_ai.system",
        "gen_ai.provider.name",
        "gen_ai.operation.name",
        "gen_ai.agent.name",
        "gen_ai.tool.name",
        "gen_ai.tool.call.id",
        "logfire.span_type",
        "llm.model_name",
        "openinference.span.kind",
        "dify.llm.total_price",
        "dify.llm.currency",
        "dify.agent.execution_state",
        "gen_ai.response.time_to_first_token",
        "dify.llm.time_to_first_token_unit",
        "dify.llm.time_to_first_token_source",
        "gen_ai.request.model",
        "gen_ai.response.model",
        "gen_ai.response.id",
        "gen_ai.request.max_tokens",
        "gen_ai.request.temperature",
        "gen_ai.request.top_p",
        "dify.trace_id",
        "dify.tenant_id",
        "dify.app_id",
        "dify.agent_id",
        "dify.invoke_from",
        "dify.conversation.id",
        "dify.workflow.id",
        "dify.workflow.run_id",
        "dify.node.id",
        "dify.node.execution_id",
        "dify.tracing.run_id",
        "dify.tracing.invocation_id",
        "gen_ai.user.id",
    }
    return {
        str(key): sanitize(value)
        for key, value in attributes.items()
        if key not in _CONTENT_ATTRIBUTES
        and (
            key in safe
            and isinstance(value, (str, int, float, bool))
            or str(key).startswith(("gen_ai.usage.", "llm.token_count."))
            and isinstance(value, (int, float))
        )
    }


def _decoded(value: Any) -> Any:
    if isinstance(value, str):
        try:
            return json.loads(value)
        except (ValueError, TypeError):
            return value
    return value


def _first(attributes: Mapping[str, Any], keys: Sequence[str]) -> Any:
    for key in keys:
        value = attributes.get(key)
        if value is not None:
            return value
    return None


def normalize_agent_span(data: Mapping[str, Any], *, capture_content: bool) -> CanonicalSpan:
    attributes = safe_attributes(data.get("attributes") or {}, capture_content=capture_content)
    operation = str(attributes.get("gen_ai.operation.name", ""))
    declared = str(attributes.get("openinference.span.kind", "")).lower()
    if operation in {"invoke_agent", "agent"} or declared == "agent":
        kind = CanonicalSpanKind.AGENT
    elif operation in {"execute_tool", "tool"} or "gen_ai.tool.name" in attributes or declared == "tool":
        kind = CanonicalSpanKind.TOOL
    elif (
        operation in {"chat", "text_completion", "generate_content", "embeddings"}
        or "gen_ai.request.model" in attributes
        or declared == "llm"
    ):
        kind = CanonicalSpanKind.LLM
    elif declared == "retriever":
        kind = CanonicalSpanKind.RETRIEVER
    else:
        kind = CanonicalSpanKind.CHAIN
    metadata = {key: value for key, value in attributes.items() if key not in _CONTENT_ATTRIBUTES}
    mappings = {
        "model_name": ("gen_ai.response.model", "gen_ai.request.model", "llm.model_name"),
        "model_provider": ("gen_ai.provider.name", "gen_ai.system"),
        "prompt_tokens": ("gen_ai.usage.input_tokens", "llm.token_count.prompt"),
        "completion_tokens": ("gen_ai.usage.output_tokens", "llm.token_count.completion"),
        "cache_read_tokens": ("gen_ai.usage.cache_read.input_tokens", "gen_ai.usage.input_tokens.cached"),
        "total_price": ("dify.llm.total_price",),
        "currency": ("dify.llm.currency",),
        "time_to_first_token": ("gen_ai.response.time_to_first_token",),
    }
    for key, candidates in mappings.items():
        value = _first(attributes, candidates)
        if value is not None:
            metadata[key] = value
    if kind == CanonicalSpanKind.LLM:
        input_tokens, output_tokens = metadata.get("prompt_tokens"), metadata.get("completion_tokens")
        if isinstance(input_tokens, (int, float)) and isinstance(output_tokens, (int, float)):
            metadata["total_tokens"] = input_tokens + output_tokens
    else:
        # Agent/chain aggregate usage is useful context, never another billed generation.
        for key in ("prompt_tokens", "completion_tokens", "total_tokens", "total_price"):
            if key in metadata:
                metadata[f"aggregate_{key}"] = metadata.pop(key)
    error = str(data.get("status_message") or "Agent operation failed") if data.get("status") == "error" else None
    if error and not capture_content:
        error = "Agent operation failed"
    inputs = (
        _first(
            attributes,
            (
                "gen_ai.input.messages",
                "gen_ai.prompt",
                "gen_ai.tool.call.arguments",
                "tool_arguments",
                "input",
                "inputs",
            ),
        )
        if capture_content
        else None
    )
    outputs = (
        _first(
            attributes,
            (
                "gen_ai.output.messages",
                "gen_ai.completion",
                "gen_ai.tool.call.result",
                "tool_response",
                "output",
                "outputs",
            ),
        )
        if capture_content
        else None
    )
    return CanonicalSpan(
        id=str(data["span_id"]),
        parent_id=data.get("parent_span_id"),
        name=str(data["name"]),
        kind=kind,
        start_time=datetime.fromtimestamp(int(data["start_time_ns"]) / 1e9, UTC),
        end_time=datetime.fromtimestamp(int(data["end_time_ns"]) / 1e9, UTC),
        inputs=sanitize(_decoded(inputs)),
        outputs=sanitize(_decoded(outputs)),
        status=CanonicalSpanStatus.ERROR if error else CanonicalSpanStatus.OK,
        error=error,
        metadata=metadata,
    )


def remap_outer_trace(
    trace: CanonicalTrace, *, trace_id: str, capture_content: bool, agent_message: bool
) -> CanonicalTrace:
    """Use the same IDs allocated before runtime and suppress synthetic Agent usage."""
    safe_metadata = {
        "workflow_id",
        "workflow_run_id",
        "workflow_app_log_id",
        "node_id",
        "node_execution_id",
        "node_type",
        "status",
        "model_provider",
        "model_name",
        "prompt_tokens",
        "completion_tokens",
        "total_tokens",
        "total_price",
        "currency",
        "trace_entity_type",
        "wrapper_type",
        "wrapper_index",
        "container_execution_id",
        "tenant_id",
        "app_id",
        "agent_id",
        "user_id",
        "conversation_id",
        "external_trace_id",
        "message_execution_state",
        "linked_parent_workflow_run_id",
        "linked_parent_node_execution_id",
        "linked_parent_application_trace_id",
        "linked_parent_trace_id",
    }
    spans = []
    for original in trace.spans:
        if agent_message and original.synthetic and original.kind == CanonicalSpanKind.LLM:
            continue
        metadata = (
            sanitize(original.metadata)
            if capture_content
            else {k: sanitize(v) for k, v in original.metadata.items() if k in safe_metadata}
        )
        if trace.trace_id != trace_id:
            metadata.setdefault("external_trace_id", trace.trace_id)
        if trace.external_parent is not None:
            # This pipeline exports a complete local tree. Cross-workflow
            # correlation is explicit until a durable cross-run merge exists.
            metadata["linked_parent_workflow_run_id"] = trace.external_parent.parent_workflow_run_id
            if trace.external_parent.parent_node_execution_id:
                metadata["linked_parent_node_execution_id"] = trace.external_parent.parent_node_execution_id
            metadata.pop("parent_trace_context", None)
        if original.kind != CanonicalSpanKind.LLM:
            for key in ("prompt_tokens", "completion_tokens", "total_tokens", "total_price"):
                if key in metadata:
                    metadata[f"aggregate_{key}"] = metadata.pop(key)
        spans.append(
            original.model_copy(
                update={
                    "id": span_id(original.id),
                    "parent_id": span_id(original.parent_id) if original.parent_id else None,
                    "inputs": sanitize(original.inputs) if capture_content else None,
                    "outputs": sanitize(original.outputs) if capture_content else None,
                    "metadata": metadata,
                    "error": original.error
                    if capture_content or not original.error
                    else "Application execution failed",
                    "can_parent_workflow": False,
                    "publishes_parent_context": False,
                }
            )
        )
    return CanonicalTrace(
        trace_id=trace_id, session_id=trace.session_id, root_span_id=span_id(trace.root_span_id), spans=tuple(spans)
    )


def order_spans(root_id: str, spans: Sequence[CanonicalSpan]) -> tuple[CanonicalSpan, ...]:
    by_id: dict[str, CanonicalSpan] = {}
    for span in spans:
        prior = by_id.get(span.id)
        if prior is not None and prior != span:
            raise ValueError("Conflicting trace span identity")
        by_id[span.id] = span
    if root_id not in by_id:
        raise ValueError("Trace root is missing")
    ordered: list[CanonicalSpan] = []
    complete: set[str] = set()
    visiting: set[str] = set()

    def visit(identifier: str) -> None:
        if identifier in complete:
            return
        if identifier in visiting:
            raise ValueError("Trace parent cycle")
        span = by_id.get(identifier)
        if span is None:
            raise ValueError("Trace parent is missing")
        visiting.add(identifier)
        if span.parent_id is not None:
            visit(span.parent_id)
        elif span.id != root_id:
            raise ValueError("Unexpected trace root")
        visiting.remove(identifier)
        complete.add(identifier)
        ordered.append(span)

    for span in spans:
        visit(span.id)
    return tuple(ordered)
