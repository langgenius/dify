"""Export complete Agent/Workflow trees through Langfuse v4 OTLP ingestion."""

import base64
from collections.abc import Mapping
from datetime import timedelta
from typing import Any
from urllib.parse import quote

from core.ops.unified_trace.entities import CanonicalSpan, CanonicalSpanKind, CanonicalSpanStatus, CanonicalTrace
from services.tracing.otlp_export import build_request, export_http
from services.tracing.provider_common import endpoint, json_value, required, token_usage, usd_cost, utc
from services.tracing.provider_dispatch import TraceExportResult


def export_trace(provider: str, config: Mapping[str, Any], trace: CanonicalTrace) -> TraceExportResult:
    host = endpoint(config.get("host", "https://cloud.langfuse.com"))
    public_key, secret_key = required(config, "public_key"), required(config, "secret_key")
    auth = base64.b64encode(f"{public_key}:{secret_key}".encode()).decode("ascii")
    root = trace.spans[0]
    project_url = config.get("project_url")
    trace_url = f"{endpoint(project_url)}/traces/{trace.trace_id}" if project_url else None

    def attributes(span: CanonicalSpan) -> dict[str, object]:
        values: dict[str, object] = {
            "langfuse.trace.name": root.name,
            "langfuse.session.id": trace.session_id,
            "langfuse.observation.type": "generation" if span.kind is CanonicalSpanKind.LLM else span.kind.value,
            "langfuse.observation.input": json_value(span.inputs),
            "langfuse.observation.output": json_value(span.outputs),
            "langfuse.observation.level": "ERROR" if span.status is CanonicalSpanStatus.ERROR else "DEFAULT",
            "dify.span.id": span.id,
        }
        for key, value in root.metadata.items():
            if value is not None:
                values[f"langfuse.trace.metadata.{key}"] = value if isinstance(value, str) else json_value(value)
        for key, value in span.metadata.items():
            if value is not None:
                values[f"langfuse.observation.metadata.{key}"] = value if isinstance(value, str) else json_value(value)
        user_id = span.metadata.get("user_id") or root.metadata.get("user_id")
        if user_id:
            values["langfuse.user.id"] = str(user_id)
        if span.error:
            values["langfuse.observation.status_message"] = span.error
        if span.kind is CanonicalSpanKind.LLM:
            model = span.metadata.get("model") or span.metadata.get("model_name")
            if model:
                values["langfuse.observation.model.name"] = str(model)
            usage = token_usage(span)
            if usage:
                values["langfuse.observation.usage_details"] = json_value(usage)
            cost = usd_cost(span)
            if cost is not None:
                values["langfuse.observation.cost_details"] = json_value({"total": cost})
            ttft = span.metadata.get("time_to_first_token", span.metadata.get("ttft"))
            if isinstance(ttft, (int, float)) and ttft >= 0:
                values["langfuse.observation.completion_start_time"] = (
                    utc(span.start_time) + timedelta(seconds=ttft)
                ).isoformat()
        return values

    payload = build_request(trace, {"service.name": "dify-application"}, attributes)
    export_http(
        provider,
        f"{host}/api/public/otel/v1/traces",
        {
            "Authorization": f"Basic {auth}",
            "x-langfuse-ingestion-version": "4",
        },
        payload,
    )
    return TraceExportResult(
        trace_id=trace.trace_id,
        trace_url=trace_url,
        span_urls={span.id: f"{trace_url}?observation={quote(span.id)}" for span in trace.spans} if trace_url else {},
    )
