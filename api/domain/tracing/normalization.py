"""Normalize Agent runtime observations and outer traces for the Agent trace collector."""

import json
import math
from collections.abc import Mapping, Sequence
from datetime import UTC, datetime
from typing import Any

from dify_trace_sdk.model import Cost, Span, SpanKind, SpanStatus, TokenUsage, Trace

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
    if isinstance(value, float) and not math.isfinite(value):
        return str(value)
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


def _count(value: object) -> int | None:
    return int(value) if isinstance(value, int | float) and not isinstance(value, bool) and value >= 0 else None


def _amount(value: object) -> float | None:
    """A finite, non-negative price; the Agent runtime reports its decimal price as a string."""
    if isinstance(value, bool) or not isinstance(value, int | float | str):
        return None
    try:
        amount = float(value)
    except ValueError:
        return None
    return amount if math.isfinite(amount) and amount >= 0 else None


def _agent_kind(attributes: Mapping[str, Any]) -> SpanKind:
    operation = str(attributes.get("gen_ai.operation.name", ""))
    declared = str(attributes.get("openinference.span.kind", "")).lower()
    if operation in {"invoke_agent", "agent"} or declared == "agent":
        return SpanKind.AGENT
    if operation in {"execute_tool", "tool"} or "gen_ai.tool.name" in attributes or declared == "tool":
        return SpanKind.TOOL
    if (
        operation in {"chat", "text_completion", "generate_content", "embeddings"}
        or "gen_ai.request.model" in attributes
        or declared == "llm"
    ):
        return SpanKind.LLM
    if declared == "retriever":
        return SpanKind.RETRIEVER
    return SpanKind.CHAIN


def normalize_agent_span(data: Mapping[str, Any], *, capture_content: bool) -> Span:
    attributes = safe_attributes(data.get("attributes") or {}, capture_content=capture_content)
    kind = _agent_kind(attributes)
    metadata: dict[str, Any] = {key: value for key, value in attributes.items() if key not in _CONTENT_ATTRIBUTES}
    model_name = _first(attributes, ("gen_ai.response.model", "gen_ai.request.model", "llm.model_name"))
    model_provider = _first(attributes, ("gen_ai.provider.name", "gen_ai.system"))
    prompt_tokens = _count(_first(attributes, ("gen_ai.usage.input_tokens", "llm.token_count.prompt")))
    completion_tokens = _count(_first(attributes, ("gen_ai.usage.output_tokens", "llm.token_count.completion")))
    cache_read_tokens = _first(attributes, ("gen_ai.usage.cache_read.input_tokens", "gen_ai.usage.input_tokens.cached"))
    if cache_read_tokens is not None:
        metadata["cache_read_tokens"] = cache_read_tokens
    price = _amount(_first(attributes, ("dify.llm.total_price",)))
    currency = _first(attributes, ("dify.llm.currency",))
    time_to_first_token = _first(attributes, ("gen_ai.response.time_to_first_token",))
    usage = cost = None
    if kind is SpanKind.LLM:
        if prompt_tokens is not None or completion_tokens is not None:
            usage = TokenUsage(
                prompt_tokens=prompt_tokens or 0,
                completion_tokens=completion_tokens or 0,
                total_tokens=(prompt_tokens or 0) + (completion_tokens or 0),
            )
        if price is not None:
            cost = Cost(amount=price, currency=str(currency or "USD"))
    else:
        # Agent and chain aggregates are context, never another billed generation.
        for key, value in (("prompt_tokens", prompt_tokens), ("completion_tokens", completion_tokens)):
            if value is not None:
                metadata[f"aggregate_{key}"] = value
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
    return Span(
        span_id=str(data["span_id"]),
        parent_span_id=data.get("parent_span_id"),
        name=str(data["name"]),
        kind=kind,
        start_time=datetime.fromtimestamp(int(data["start_time_ns"]) / 1e9, UTC),
        end_time=datetime.fromtimestamp(int(data["end_time_ns"]) / 1e9, UTC),
        status=SpanStatus.ERROR if error else SpanStatus.OK,
        error=error,
        inputs=sanitize(_decoded(inputs)),
        outputs=sanitize(_decoded(outputs)),
        model_name=str(model_name) if kind is SpanKind.LLM and model_name else None,
        model_provider=str(model_provider) if kind is SpanKind.LLM and model_provider else None,
        usage=usage,
        cost=cost,
        time_to_first_token=float(time_to_first_token)
        if kind is SpanKind.LLM and isinstance(time_to_first_token, int | float) and time_to_first_token >= 0
        else None,
        attributes=sanitize(metadata),
    )


_SAFE_OUTER_ATTRIBUTES = frozenset(
    {
        "workflow_id",
        "workflow_run_id",
        "workflow_app_log_id",
        "node_id",
        "node_execution_id",
        "node_type",
        "status",
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
        "parent_workflow_run_id",
        "parent_node_execution_id",
        "linked_parent_workflow_run_id",
        "linked_parent_node_execution_id",
        "linked_parent_application_trace_id",
        "linked_parent_trace_id",
    }
)


def remap_outer_trace(
    trace: Trace, *, trace_id: str, capture_content: bool, synthetic_span_ids: frozenset[str]
) -> Trace:
    """Adopt the run's trace ID and capture policy; drop spans the Agent runtime reports itself."""
    spans: list[Span] = []
    for original in trace.spans:
        if original.span_id in synthetic_span_ids:
            continue
        attributes = dict(original.attributes)
        if trace.external_trace_id:
            attributes.setdefault("external_trace_id", trace.external_trace_id)
        if not capture_content:
            attributes = {key: value for key, value in attributes.items() if key in _SAFE_OUTER_ATTRIBUTES}
        spans.append(
            original.model_copy(
                update={
                    "inputs": sanitize(original.inputs) if capture_content else None,
                    "outputs": sanitize(original.outputs) if capture_content else None,
                    "attributes": sanitize(attributes),
                    "error": original.error
                    if capture_content or not original.error
                    else "Application execution failed",
                }
            )
        )
    return Trace(
        trace_id=trace_id,
        external_trace_id=None,
        session_id=trace.session_id,
        user_id=trace.user_id,
        parent=None,
        spans=tuple(spans),
    )


def legacy_outer_trace(data: Mapping[str, Any]) -> Trace:
    """Read an outer trace in the shape the previous release stored, so runs captured before an
    upgrade still export. Its spans already carry this ledger's identifiers and capture policy."""
    spans: list[Span] = []
    for raw in data["spans"]:
        metadata = raw.get("metadata") or {}
        llm = raw["kind"] == SpanKind.LLM.value
        prompt, completion = _count(metadata.get("prompt_tokens")), _count(metadata.get("completion_tokens"))
        amount, currency = _amount(metadata.get("total_price")), metadata.get("currency")
        spans.append(
            Span(
                span_id=raw["id"],
                parent_span_id=raw["parent_id"],
                name=raw["name"],
                kind=SpanKind(raw["kind"]),
                start_time=raw["start_time"],
                end_time=raw["end_time"] or raw["start_time"],
                status=SpanStatus(raw["status"]),
                error=raw.get("error"),
                inputs=sanitize(raw.get("inputs")),
                outputs=sanitize(raw.get("outputs")),
                model_name=metadata.get("model_name") if llm else None,
                model_provider=metadata.get("model_provider") if llm else None,
                usage=TokenUsage(
                    prompt_tokens=prompt or 0,
                    completion_tokens=completion or 0,
                    total_tokens=_count(metadata.get("total_tokens")) or (prompt or 0) + (completion or 0),
                )
                if llm and (prompt is not None or completion is not None)
                else None,
                cost=Cost(amount=amount, currency=currency)
                if llm and amount is not None and isinstance(currency, str) and currency
                else None,
                attributes=sanitize(metadata),
            )
        )
    return Trace(
        trace_id=data["trace_id"],
        external_trace_id=None,
        session_id=data.get("session_id") or None,
        user_id=None,
        parent=None,
        spans=tuple(spans),
    )


def order_spans(root_id: str, spans: Sequence[Span]) -> tuple[Span, ...]:
    by_id: dict[str, Span] = {}
    for span in spans:
        prior = by_id.get(span.span_id)
        if prior is not None and prior != span:
            raise ValueError("Conflicting trace span identity")
        by_id[span.span_id] = span
    if root_id not in by_id:
        raise ValueError("Trace root is missing")
    ordered: list[Span] = []
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
        if span.parent_span_id is not None:
            visit(span.parent_span_id)
        elif span.span_id != root_id:
            raise ValueError("Unexpected trace root")
        visiting.remove(identifier)
        complete.add(identifier)
        ordered.append(span)

    visit(root_id)
    for span in spans:
        visit(span.span_id)
    return tuple(ordered)
