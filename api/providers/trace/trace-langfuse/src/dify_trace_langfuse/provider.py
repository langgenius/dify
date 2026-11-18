"""Langfuse destination over its OpenTelemetry endpoint.

Langfuse does not deduplicate re-sent spans, so a unit is retried only when
none of it was accepted.
"""

import base64
from datetime import timedelta
from typing import override

from dify_trace_sdk.errors import (
    EgressError,
    ExportOutcomeUnknownError,
    ExportRetryableError,
    VerificationError,
)
from dify_trace_sdk.exporting import export_endpoint, json_value
from dify_trace_sdk.model import Span, SpanKind, Trace
from dify_trace_sdk.otlp import encode_trace, post_otlp
from dify_trace_sdk.provider import ProviderCapabilities, SendResult, TraceProvider
from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import ExportTraceServiceRequest
from pydantic import JsonValue

from dify_trace_langfuse.config import LangfuseConfig

DESTINATION = "Langfuse"
SERVICE_NAME = "dify"
VERIFY_TIMEOUT_SECONDS = 10.0
MAX_REQUEST_BYTES = 3_000_000
INGESTION_VERSION_HEADER = {"x-langfuse-ingestion-version": "4"}


def _messages(value: JsonValue, *, role: str) -> JsonValue:
    """Preserve Langfuse's chat preview without rewriting multimodal content blocks."""
    if isinstance(value, str):
        return [{"role": role, "content": value}]
    if isinstance(value, list):
        return [
            {("content" if key == "text" else key): part for key, part in item.items()}
            if isinstance(item, dict) and "role" in item and "content" not in item
            else item
            for item in value
        ]
    return value


def _json(value: JsonValue) -> str | None:
    return None if value is None else json_value(value)


def _trace_attributes(trace: Trace) -> dict[str, object]:
    """Repeated on every span so Langfuse can filter observations by them."""
    return {
        "langfuse.trace.name": trace.root.name if trace.parent is None else None,
        "langfuse.user.id": trace.user_id,
        "langfuse.session.id": trace.session_id,
    }


def _trace_metadata(trace: Trace) -> dict[str, object]:
    if trace.parent is not None:
        return {}
    metadata = {
        **trace.root.attributes,
        "dify_trace_id": trace.trace_id,
        "external_trace_id": trace.external_trace_id,
    }
    return {f"langfuse.trace.metadata.{key}": value for key, value in metadata.items()}


def _generation_attributes(span: Span) -> dict[str, object]:
    attributes: dict[str, object] = {"langfuse.observation.model.name": span.model_name}
    if span.usage is not None:
        attributes["langfuse.observation.usage_details"] = json_value(
            {
                "input": span.usage.prompt_tokens,
                "output": span.usage.completion_tokens,
                "total": span.usage.total_tokens,
            }
        )
    if span.cost is not None and span.cost.currency.upper() == "USD":
        attributes["langfuse.observation.cost_details"] = json_value({"total": span.cost.amount})
    if span.time_to_first_token is not None:
        attributes["langfuse.observation.completion_start_time"] = (
            span.start_time + timedelta(seconds=span.time_to_first_token)
        ).isoformat()
    return attributes


def _span_attributes(span: Span) -> dict[str, object]:
    # Other span kinds match Langfuse's type names.
    attributes: dict[str, object] = {
        "langfuse.observation.type": "generation" if span.kind is SpanKind.LLM else span.kind.value,
        "langfuse.observation.input": _json(_messages(span.inputs, role="user")),
        "langfuse.observation.output": _json(_messages(span.outputs, role="assistant")),
        "langfuse.observation.metadata.dify_span_kind": span.kind.value,
        **{f"langfuse.observation.metadata.{key}": value for key, value in span.attributes.items()},
    }
    if span.kind is SpanKind.LLM:
        attributes.update(_generation_attributes(span))
    return attributes


def _export_request(trace: Trace) -> ExportTraceServiceRequest:
    trace_attributes = _trace_attributes(trace)
    trace_metadata = _trace_metadata(trace)
    return encode_trace(
        trace,
        resource={"service.name": SERVICE_NAME},
        attributes=lambda span: {
            **trace_attributes,
            **_span_attributes(span),
            **(trace_metadata if span.span_id == trace.root.span_id else {}),
        },
    )


def _split(request: ExportTraceServiceRequest) -> list[ExportTraceServiceRequest]:
    """An oversized span travels alone."""
    (resource_spans,) = request.resource_spans
    (scope_spans,) = resource_spans.scope_spans
    chunks: list[ExportTraceServiceRequest] = []
    size = 0
    for span in scope_spans.spans:
        span_size = span.ByteSize()
        if not chunks or size + span_size > MAX_REQUEST_BYTES:
            chunk = ExportTraceServiceRequest()
            chunk.resource_spans.add(resource=resource_spans.resource).scope_spans.add(scope=scope_spans.scope)
            chunks.append(chunk)
            size = 0
        chunks[-1].resource_spans[0].scope_spans[0].spans.append(span)
        size += span_size
    return chunks


class LangfuseProvider(TraceProvider[LangfuseConfig]):
    id = "langfuse"
    config_model = LangfuseConfig
    capabilities = ProviderCapabilities(native_cost=True, trace_url=True, span_url=True)

    @staticmethod
    def _authorization(config: LangfuseConfig) -> dict[str, str]:
        token = base64.b64encode(f"{config.public_key}:{config.secret_key}".encode()).decode()
        return {"Authorization": f"Basic {token}"}

    @override
    def verify(self, config: LangfuseConfig) -> LangfuseConfig:
        try:
            response = self.egress.request(
                "GET",
                f"{config.host.rstrip('/')}/api/public/projects",
                headers={**self._authorization(config), "Accept": "application/json"},
                content=None,
                timeout=VERIFY_TIMEOUT_SECONDS,
                sensitive_url=False,
            )
        except EgressError:
            raise VerificationError("connection_failed") from None
        if response.status_code in {401, 403}:
            raise VerificationError("authentication_failed")
        if not 200 <= response.status_code < 300:
            raise VerificationError("endpoint_unavailable")
        try:
            body = response.json()
            projects = body["data"] if isinstance(body, dict) else None
            project_id = projects[0]["id"] if isinstance(projects, list) and projects else None
        except (ValueError, KeyError, TypeError):
            raise VerificationError("malformed_response") from None
        if not isinstance(project_id, str) or not project_id:
            raise VerificationError("project_not_found")
        return config.model_copy(update={"project_key": project_id})

    @override
    def project_url(self, config: LangfuseConfig) -> str:
        host = config.host.rstrip("/")
        return f"{host}/project/{config.project_key}" if config.project_key else config.project_url or host

    @override
    def send(self, config: LangfuseConfig, trace: Trace) -> SendResult:
        url = f"{export_endpoint(config.host)}/api/public/otel/v1/traces"
        headers = {**self._authorization(config), **INGESTION_VERSION_HEADER}
        for index, request in enumerate(_split(_export_request(trace))):
            try:
                post_otlp(self.egress, url, request, destination=DESTINATION, headers=headers, sensitive_url=False)
            except ExportRetryableError:
                if index == 0:
                    raise
                raise ExportOutcomeUnknownError(f"{DESTINATION} accepted part of the trace") from None
        trace_url = (
            f"{self.project_url(config).rstrip('/')}/traces/{trace.trace_id}"
            if config.project_key or config.project_url
            else None
        )
        span_urls = (
            {span.span_id: f"{trace_url}?observation={span.span_id}" for span in trace.spans} if trace_url else {}
        )
        return SendResult(trace_id=trace.trace_id, trace_url=trace_url, span_urls=span_urls)
