"""Aliyun LLM application monitoring over OTLP/HTTP.

The license key travels in the collector URL path, so every request marks its
URL as sensitive. The collector acknowledges an export with the literal body
``"success"`` rather than an OTLP response; standard acknowledgments are
accepted too.
"""

from typing import override
from urllib.parse import quote, urlsplit

from dify_trace_sdk.egress import EgressResponse
from dify_trace_sdk.errors import EgressError, ExportRejectedError, VerificationError
from dify_trace_sdk.genai import GenAIDialect, genai_attributes
from dify_trace_sdk.model import SpanKind, Trace
from dify_trace_sdk.otlp import encode_trace, post_otlp, read_otlp_ack
from dify_trace_sdk.provider import ProviderCapabilities, SendResult, TraceProvider
from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import ExportTraceServiceRequest

from dify_trace_aliyun.config import AliyunConfig

VERIFY_TIMEOUT_SECONDS = 10.0
_DESTINATION = "Aliyun"
_CONSOLE_URL = "https://arms.console.aliyun.com/#/llm"
_DIALECT = GenAIDialect(
    kind_labels={kind: kind.value.upper() for kind in SpanKind},
    input_key="input.value",
    output_key="output.value",
    mark_entry_span=False,
)


def _ingestion_url(config: AliyunConfig) -> str:
    """The collector route, with the raw license key encoded exactly once as a path segment."""
    hostname = (urlsplit(config.endpoint).hostname or "").removesuffix(".")
    is_sls = hostname == "log.aliyuncs.com" or hostname.endswith(".log.aliyuncs.com")
    suffix = "api/v1/traces" if is_sls else "api/otlp/traces"
    # Aliyun's documented path-form key contains a literal '@'. RFC 3986 path
    # segments permit it, and the collector does not treat '%40' equivalently.
    return f"{config.endpoint}/adapt_{quote(config.license_key, safe='@')}/{suffix}"


def _is_masked(config: AliyunConfig) -> bool:
    """A displayed mask of a key passes validation but is not a credential to send."""
    return "*" in config.license_key


def _is_success_ack(response: EgressResponse) -> bool:
    """The observed acknowledgment of Aliyun's HTTP collector; never normalize other bodies into it."""
    return response.status_code == 200 and response.content == b'"success"'


class AliyunProvider(TraceProvider[AliyunConfig]):
    id = "aliyun"
    config_model = AliyunConfig
    capabilities = ProviderCapabilities(native_cost=False, trace_url=False, span_url=False)

    @override
    def verify(self, config: AliyunConfig) -> AliyunConfig:
        """Post one resource with zero spans and require the collector's literal acknowledgment.

        The collector distinguishes valid from invalid license keys for this
        request, whereas an empty OTLP acknowledgment proves nothing. Success
        does not establish that business spans are retained.
        """
        if _is_masked(config):
            raise VerificationError("invalid_license_key")
        probe = ExportTraceServiceRequest()
        resource = probe.resource_spans.add().resource
        resource.attributes.add(key="service.name").value.string_value = config.app_name
        try:
            response = self.egress.request(
                "POST",
                _ingestion_url(config),
                headers={"Content-Type": "application/x-protobuf", "Accept": "application/x-protobuf"},
                content=probe.SerializeToString(),
                timeout=VERIFY_TIMEOUT_SECONDS,
                sensitive_url=True,
            )
        except EgressError:
            raise VerificationError("verification_failed") from None
        if not _is_success_ack(response):
            raise VerificationError("verification_failed")
        return config

    @override
    def project_url(self, config: AliyunConfig) -> str | None:
        return _CONSOLE_URL

    @override
    def send(self, config: AliyunConfig, trace: Trace) -> SendResult:
        if _is_masked(config):
            raise ExportRejectedError("Aliyun tracing configuration is invalid")
        request = encode_trace(
            trace,
            resource={"service.name": config.app_name, "acs.arms.service.feature": "genai_app"},
            attributes=lambda span: genai_attributes(span, trace, _DIALECT),
        )
        response = post_otlp(
            self.egress, _ingestion_url(config), request, destination=_DESTINATION, headers={}, sensitive_url=True
        )
        if not _is_success_ack(response):
            read_otlp_ack(response, _DESTINATION)
        return SendResult(trace_id=trace.trace_id, trace_url=None, span_urls={})
