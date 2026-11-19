"""Tencent APM over its OTLP/gRPC collector.

The collector authenticates a bearer token sent as gRPC metadata. Tencent APM
counts LLM traces by their entry span, so the root of every unit that starts a
trace carries ``gen_ai.is_entry``; a fragment joining an existing trace does not.
"""

from typing import override
from urllib.parse import urlsplit

import grpc  # type: ignore[import-untyped]
from dify_trace_sdk.errors import EgressError, VerificationError
from dify_trace_sdk.genai import GenAIDialect, genai_attributes
from dify_trace_sdk.model import SpanKind, Trace
from dify_trace_sdk.otlp import encode_trace, export_otlp_grpc
from dify_trace_sdk.provider import ProviderCapabilities, SendResult, TraceProvider
from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import ExportTraceServiceRequest
from opentelemetry.proto.collector.trace.v1.trace_service_pb2_grpc import TraceServiceStub

from dify_trace_tencent.config import SERVICE_NAME, TencentConfig

DEFAULT_GRPC_PORT = 4317
VERIFY_TIMEOUT_SECONDS = 10.0
_DESTINATION = "Tencent APM"
_CONSOLE_URL = "https://console.cloud.tencent.com/apm"
_DIALECT = GenAIDialect(
    kind_labels={
        **{kind: kind.value.upper() for kind in SpanKind},
        SpanKind.LLM: "GENERATION",
        SpanKind.CHAIN: "WORKFLOW",
    },
    input_key="gen_ai.entity.input",
    output_key="gen_ai.entity.output",
    mark_entry_span=True,
)


def _grpc_endpoint(config: TencentConfig) -> str:
    """The collector listens on the OTLP/gRPC port unless the endpoint names another one."""
    if urlsplit(config.endpoint).port is None:
        return f"{config.endpoint}:{DEFAULT_GRPC_PORT}"
    return config.endpoint


def _metadata(config: TencentConfig) -> dict[str, str]:
    return {"authorization": f"Bearer {config.token}"}


class TencentProvider(TraceProvider[TencentConfig]):
    id = "tencent"
    config_model = TencentConfig
    capabilities = ProviderCapabilities(native_cost=False, trace_url=False, span_url=False)

    @override
    def verify(self, config: TencentConfig) -> TencentConfig:
        """Exchange one zero-span Export with the collector.

        This shows the endpoint is an OTLP/gRPC collector, not that the token
        is valid: collectors may acknowledge empty requests without
        authenticating them, so only business traces establish ingestion.
        """
        if not SERVICE_NAME.fullmatch(config.service_name):
            raise VerificationError("invalid_service_name")
        try:
            channel = self.egress.grpc_channel(_grpc_endpoint(config))
        except EgressError:
            raise VerificationError("connection_failed") from None
        try:
            response = TraceServiceStub(channel).Export(
                ExportTraceServiceRequest(),
                metadata=tuple(_metadata(config).items()),
                timeout=VERIFY_TIMEOUT_SECONDS,
                wait_for_ready=False,
            )
        except (grpc.RpcError, ValueError):
            # gRPC raises ValueError for metadata it cannot send, quoting the token.
            raise VerificationError("connection_failed") from None
        finally:
            channel.close()
        if response.partial_success.rejected_spans or response.partial_success.error_message:
            raise VerificationError("unexpected_response")
        return config

    @override
    def project_url(self, config: TencentConfig) -> str | None:
        return _CONSOLE_URL

    @override
    def send(self, config: TencentConfig, trace: Trace) -> SendResult:
        request = encode_trace(
            trace,
            resource={"service.name": config.service_name},
            attributes=lambda span: genai_attributes(span, trace, _DIALECT),
        )
        export_otlp_grpc(
            self.egress, _grpc_endpoint(config), request, destination=_DESTINATION, metadata=_metadata(config)
        )
        return SendResult(trace_id=trace.trace_id, trace_url=None, span_urls={})
