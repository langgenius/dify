"""Stable-ID OpenInference mapping for Phoenix HTTP and Arize gRPC ingestion."""

from collections.abc import Mapping
from typing import Any

from core.ops.unified_trace.entities import CanonicalSpan, CanonicalSpanKind, CanonicalTrace
from services.tracing.otlp_export import build_request, export_grpc, export_http
from services.tracing.provider_common import endpoint, json_value, token_usage
from services.tracing.provider_dispatch import TraceExportResult


def export_trace(provider: str, config: Mapping[str, Any], trace: CanonicalTrace) -> TraceExportResult:
    url = endpoint(
        config.get("endpoint", "https://otlp.arize.com" if provider == "arize" else "https://app.phoenix.arize.com")
    )
    api_key = str(config.get("api_key") or "")
    project = str(config.get("project") or "default")

    def attributes(span: CanonicalSpan) -> dict[str, object]:
        result: dict[str, object] = {
            "openinference.span.kind": span.kind.value.upper(),
            "input.value": json_value(span.inputs),
            "input.mime_type": "application/json",
            "output.value": json_value(span.outputs),
            "output.mime_type": "application/json",
            "metadata": json_value(span.metadata),
            "session.id": trace.session_id,
            "dify.span.id": span.id,
        }
        if span.kind is CanonicalSpanKind.LLM:
            model = span.metadata.get("model") or span.metadata.get("model_name")
            if model:
                result["llm.model_name"] = str(model)
            if span.metadata.get("model_provider"):
                result["llm.provider"] = str(span.metadata["model_provider"])
            names = {"input": "prompt", "output": "completion", "total": "total"}
            result.update({f"llm.token_count.{names[key]}": value for key, value in token_usage(span).items()})
        elif span.kind is CanonicalSpanKind.TOOL:
            result["tool.name"] = span.name
            result["tool.parameters"] = json_value(span.inputs)
        return result

    payload = build_request(
        trace,
        {"service.name": "dify-application", "openinference.project.name": project, "model_id": project},
        attributes,
    )
    headers = {"api_key": api_key, "authorization": f"Bearer {api_key}"}
    if provider == "arize":
        headers["space_id"] = str(config.get("space_id") or "")
        export_grpc(provider, url, headers, payload)
    else:
        export_http(provider, f"{url}/v1/traces", headers, payload)
    return TraceExportResult(trace_id=trace.trace_id)
