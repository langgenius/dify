"""Tencent APM Agent spans over its existing authenticated OTLP/gRPC protocol."""

from collections.abc import Mapping
from typing import Any

from core.ops.unified_trace.entities import CanonicalTrace
from services.tracing.genai_attributes import attributes
from services.tracing.otlp_export import build_request, export_grpc
from services.tracing.provider_common import endpoint, required
from services.tracing.provider_dispatch import TraceExportResult


def export_trace(provider: str, config: Mapping[str, Any], trace: CanonicalTrace) -> TraceExportResult:
    url = endpoint(required(config, "endpoint"))
    payload = build_request(
        trace, {"service.name": required(config, "service_name")}, lambda span: attributes(span, trace, provider)
    )
    export_grpc(provider, url, {"authorization": f"Bearer {required(config, 'token')}"}, payload)
    return TraceExportResult(trace_id=trace.trace_id)
