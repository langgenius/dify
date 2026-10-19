"""Aliyun LLM tracing export with synchronous OTLP/HTTP acknowledgment."""

from collections.abc import Mapping
from typing import Any

from core.ops.unified_trace.entities import CanonicalTrace
from dify_trace_aliyun.configuration import AliyunConfigurationError, ingestion_url
from services.tracing.genai_attributes import attributes
from services.tracing.otlp_export import build_request, export_http
from services.tracing.provider_dispatch import TraceExportRejectedError, TraceExportResult


def export_trace(provider: str, config: Mapping[str, Any], trace: CanonicalTrace) -> TraceExportResult:
    try:
        url = ingestion_url(config)
    except AliyunConfigurationError:
        raise TraceExportRejectedError("Aliyun tracing configuration is invalid") from None
    payload = build_request(
        trace,
        {
            "service.name": str(config.get("app_name") or "dify_app"),
            "acs.arms.service.feature": "genai_app",
        },
        lambda span: attributes(span, trace, provider),
    )
    export_http(provider, url, {}, payload)
    return TraceExportResult(trace_id=trace.trace_id)
