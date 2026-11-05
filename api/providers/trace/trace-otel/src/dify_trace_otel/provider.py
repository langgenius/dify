"""Generic OTLP/HTTP export through Dify's injected egress, with no exporter state.

The canonical tree already owns IDs, parents and timing. The provider only maps
attributes and sends one completed unit; retry decisions belong to the pipeline.
"""

from typing import override

from dify_trace_sdk.errors import EgressError, TraceProviderError, VerificationError
from dify_trace_sdk.genai import GenAIDialect, genai_attributes
from dify_trace_sdk.model import Span, SpanKind, Trace
from dify_trace_sdk.otlp import encode_trace, post_otlp, read_otlp_ack
from dify_trace_sdk.provider import ProviderCapabilities, SendResult, TraceProvider
from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import ExportTraceServiceRequest
from opentelemetry.proto.common.v1.common_pb2 import AnyValue

from dify_trace_otel.config import OTelConfig

_DESTINATION = "OpenTelemetry"
_DIALECT = GenAIDialect(kind_labels={}, input_key="input.value", output_key="output.value", mark_entry_span=False)


def _attributes(span: Span, trace: Trace) -> dict[str, object]:
    """Map validated spans to searchable GenAI/Dify attributes without counting wrapper usage."""
    attributes = genai_attributes(span, trace, _DIALECT)
    attributes.update(
        {
            "dify.span.kind": span.kind.value,
            "dify.span.start_time": span.start_time.isoformat(timespec="milliseconds").replace("+00:00", "Z"),
            "dify.span.end_time": span.end_time.isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        }
    )
    if span.kind is SpanKind.LLM and span.cost is not None:
        attributes["dify.cost.amount"] = span.cost.amount
        attributes["dify.cost.currency"] = span.cost.currency
    tool_info = span.attributes.get("tool_info")
    if span.kind is SpanKind.TOOL and isinstance(tool_info, dict):
        for key in ("provider_type", "provider_id", "plugin_unique_identifier"):
            value = tool_info.get(key)
            if isinstance(value, str) and value:
                attributes[f"dify.tool.{key}"] = value
    return attributes


def _scalar(value: object) -> AnyValue:
    """Encode a scalar already checked by OTelConfig, preserving its OTLP primitive type."""
    if isinstance(value, bool):
        return AnyValue(bool_value=value)
    if isinstance(value, int):
        return AnyValue(int_value=value)
    if isinstance(value, float):
        return AnyValue(double_value=value)
    if isinstance(value, str):
        return AnyValue(string_value=value)
    raise ValueError("Invalid OTLP resource scalar")


class OTelProvider(TraceProvider[OTelConfig]):
    id = "otel"
    config_model = OTelConfig
    capabilities = ProviderCapabilities(native_cost=False, trace_url=False, span_url=False)

    @override
    def verify(self, config: OTelConfig) -> OTelConfig:
        """Require a zero-span OTLP acknowledgement; creates no trace or backend resource.

        An empty export checks protocol access. Actual business-trace acceptance
        still needs an end-to-end check, since some collectors bypass auth here.
        Failures expose fixed VerificationError codes only.
        """
        try:
            response = self.egress.request(
                "POST",
                config.endpoint,
                headers={
                    "Content-Type": "application/x-protobuf",
                    "Accept": "application/x-protobuf",
                    **config.parsed_headers(),
                },
                content=ExportTraceServiceRequest().SerializeToString(),
                timeout=10.0,
                sensitive_url=True,
            )
        except EgressError:
            raise VerificationError("connection_failed") from None
        if response.status_code != 200:
            code = {401: "authentication_failed", 403: "permission_denied"}.get(
                response.status_code, "endpoint_unavailable"
            )
            raise VerificationError(code)
        try:
            read_otlp_ack(response, _DESTINATION)
        except TraceProviderError:
            raise VerificationError("unexpected_response") from None
        return config

    @override
    def project_url(self, config: OTelConfig) -> str | None:
        """A generic ingestion endpoint has no discoverable UI; return no link without I/O."""
        return None

    @override
    def send(self, config: OTelConfig, trace: Trace) -> SendResult:
        """Send one validated tree; return only after acknowledgement, classifying failures via SDK."""
        resource = config.parsed_resource_attributes()
        request = encode_trace(
            trace,
            resource={
                "service.name": config.service_name,
                **{k: v for k, v in resource.items() if not isinstance(v, list)},
            },
            attributes=lambda span: _attributes(span, trace),
        )
        # The shared encoder serializes complex values as JSON. Resource arrays
        # are OTLP primitives and must retain their array type instead.
        for key, value in resource.items():
            if isinstance(value, list):
                target = request.resource_spans[0].resource.attributes.add(key=key)
                target.value.array_value.SetInParent()
                target.value.array_value.values.extend(_scalar(item) for item in value)
        response = post_otlp(
            self.egress,
            config.endpoint,
            request,
            destination=_DESTINATION,
            headers=config.parsed_headers(),
            sensitive_url=True,
        )
        read_otlp_ack(response, _DESTINATION)
        return SendResult(trace_id=trace.trace_id, trace_url=None, span_urls={})
