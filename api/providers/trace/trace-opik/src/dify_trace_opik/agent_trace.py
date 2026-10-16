"""Synchronous Opik SDK ingestion with native UUIDv7, thread, and usage fields."""

from collections.abc import Mapping
from datetime import datetime
from typing import Any
from uuid import NAMESPACE_URL, UUID, uuid5

from core.ops.exceptions import RetryableTraceDispatchError
from core.ops.unified_trace.entities import CanonicalSpanKind, CanonicalSpanStatus, CanonicalTrace
from services.tracing.provider_common import endpoint, finished_at, json_value, token_usage, usd_cost, utc
from services.tracing.provider_dispatch import TraceExportRejectedError, TraceExportResult, TraceExportUncertainError
from services.tracing.sdk_transport import SSRFTransport


def _provider_id(trace_id: str, span_id: str, started_at: datetime) -> str:
    from opik.id_helpers import uuid4_to_uuid7

    seeded = UUID(str(uuid5(NAMESPACE_URL, f"dify:{trace_id}:{span_id}")), version=4)
    return str(uuid4_to_uuid7(utc(started_at), str(seeded)))


def _content(value: Any) -> dict[str, Any] | list[dict[str, Any]] | str | None:
    """Opik accepts objects, object lists and strings, but not every JSON value."""
    if value is None or isinstance(value, (dict, str)):
        return value
    if isinstance(value, list) and all(isinstance(item, dict) for item in value):
        return value
    return json_value(value)


def export_trace(provider: str, config: Mapping[str, Any], trace: CanonicalTrace) -> TraceExportResult:
    import httpx
    from opik.rest_api.client import OpikApi
    from opik.rest_api.types.error_info_write import ErrorInfoWrite
    from opik.rest_api.types.span_write import SpanWrite

    url = endpoint(config.get("url", "https://www.comet.com/opik/api"))
    project = str(config.get("project") or "Default Project")
    root = trace.spans[0]
    trace_id = _provider_id(trace.trace_id, "trace", root.start_time)
    ids = {span.id: _provider_id(trace.trace_id, span.id, span.start_time) for span in trace.spans}
    accepted = False
    with httpx.Client(transport=SSRFTransport(provider), timeout=30) as http_client:
        client = OpikApi(
            base_url=url,
            api_key=config.get("api_key"),
            workspace_name=str(config.get("workspace") or "default"),
            httpx_client=http_client,
        )
        spans = []
        for span in trace.spans:
            usage = token_usage(span)
            native_usage = {
                "prompt_tokens" if key == "input" else "completion_tokens" if key == "output" else "total_tokens": value
                for key, value in usage.items()
            }
            ttft = span.metadata.get("time_to_first_token", span.metadata.get("ttft"))
            spans.append(
                SpanWrite(
                    id=ids[span.id],
                    trace_id=trace_id,
                    parent_span_id=ids.get(span.parent_id or ""),
                    project_name=project,
                    name=span.name,
                    type="llm"
                    if span.kind is CanonicalSpanKind.LLM
                    else "tool"
                    if span.kind is CanonicalSpanKind.TOOL
                    else "general",
                    start_time=utc(span.start_time),
                    end_time=finished_at(span),
                    input=_content(span.inputs),
                    output=_content(span.outputs),
                    metadata={
                        **span.metadata,
                        "dify.span.kind": span.kind.value,
                        "dify.span.id": span.id,
                        "dify.trace_id": trace.trace_id,
                        "session_id": trace.session_id,
                    },
                    model=str(span.metadata.get("model") or span.metadata.get("model_name") or "")
                    if span.kind is CanonicalSpanKind.LLM
                    else None,
                    provider=str(span.metadata.get("model_provider") or "")
                    if span.kind is CanonicalSpanKind.LLM
                    else None,
                    usage=native_usage or None,
                    total_estimated_cost=usd_cost(span),
                    ttft=float(ttft) * 1000
                    if span.kind is CanonicalSpanKind.LLM and isinstance(ttft, (int, float)) and ttft >= 0
                    else None,
                    error_info=ErrorInfoWrite(
                        exception_type="DifyExecutionError",
                        message=span.error or "Trace operation failed",
                        traceback="",
                    )
                    if span.status is CanonicalSpanStatus.ERROR
                    else None,
                )
            )
        try:
            client.traces.create_trace(
                id=trace_id,
                project_name=project,
                name=root.name,
                start_time=utc(root.start_time),
                end_time=finished_at(root),
                input=_content(root.inputs),
                output=_content(root.outputs),
                metadata={**root.metadata, "dify.trace_id": trace.trace_id},
                thread_id=trace.session_id,
                request_options={"max_retries": 0},
            )
            accepted = True
            client.spans.create_spans(spans=spans, request_options={"max_retries": 0})
        except Exception as error:
            if accepted:
                raise TraceExportUncertainError("Opik accepted part of the trace; reconciliation is required") from None
            if isinstance(error, (RetryableTraceDispatchError, TraceExportRejectedError)):
                raise
            raise TraceExportRejectedError("Opik rejected the trace") from None
    return TraceExportResult(trace_id=trace_id)
