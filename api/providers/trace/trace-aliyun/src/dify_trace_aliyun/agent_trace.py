"""Aliyun LLM tracing export with synchronous OTLP/HTTP acknowledgment."""

from collections.abc import Mapping
from typing import Any
from urllib.parse import quote, urlsplit

from core.ops.unified_trace.entities import CanonicalTrace
from services.tracing.genai_attributes import attributes
from services.tracing.otlp_export import build_request, export_http
from services.tracing.provider_common import endpoint, required
from services.tracing.provider_dispatch import TraceExportResult


def export_trace(provider: str, config: Mapping[str, Any], trace: CanonicalTrace) -> TraceExportResult:
    base = endpoint(required(config, "endpoint"))
    license_key = quote(required(config, "license_key"), safe="")
    hostname = (urlsplit(base).hostname or "").removesuffix(".")
    is_sls = hostname == "log.aliyuncs.com" or hostname.endswith(".log.aliyuncs.com")
    suffix = "api/v1/traces" if is_sls else "api/otlp/traces"
    url = f"{base}/adapt_{license_key}/{suffix}"
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
