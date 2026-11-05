import httpx
import pytest
from dify_trace_langfuse.config import LangfuseConfig
from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import ExportTraceServiceRequest
from opentelemetry.proto.trace.v1.trace_pb2 import Span


class OtelSink:
    """Answers the provider's OTLP requests and keeps them for inspection."""

    def __init__(self) -> None:
        self.requests: list[httpx.Request] = []
        self.status_code = 200

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        return httpx.Response(self.status_code, json={"name": "otel-ingestion-job"})

    def spans(self) -> list[Span]:
        return [
            span
            for request in self.requests
            for resource_spans in ExportTraceServiceRequest.FromString(request.content).resource_spans
            for scope_spans in resource_spans.scope_spans
            for span in scope_spans.spans
        ]


@pytest.fixture
def otel_sink(monkeypatch: pytest.MonkeyPatch) -> OtelSink:
    """Routes the provider's HTTP client to a sink, so no test reaches Langfuse."""
    sink = OtelSink()
    client = httpx.Client
    monkeypatch.setattr(
        "dify_trace_langfuse.langfuse_trace.httpx.Client",
        lambda **kwargs: client(transport=httpx.MockTransport(sink), **kwargs),
    )
    return sink


@pytest.fixture
def langfuse_config():
    return LangfuseConfig(public_key="pk-123", secret_key="sk-123", host="https://cloud.langfuse.com")
