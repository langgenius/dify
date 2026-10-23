"""Exercise anonymous Phoenix auth at the HTTP/1.1 and legacy SDK boundaries."""

from collections.abc import Iterator
from datetime import UTC, datetime, timedelta

import httpcore
import httpx
import pytest
import requests
from dify_trace_arize_phoenix.arize_phoenix_trace import setup_tracer
from dify_trace_arize_phoenix.config import PhoenixConfig
from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import ExportTraceServiceRequest

from core.helper import ssrf_proxy
from core.ops.unified_trace.entities import CanonicalSpan, CanonicalSpanKind, CanonicalSpanStatus, CanonicalTrace
from services.tracing.provider_dispatch import export_trace


@pytest.fixture
def trace() -> CanonicalTrace:
    start = datetime(2026, 10, 20, tzinfo=UTC)
    return CanonicalTrace(
        trace_id="1" * 32,
        session_id="phoenix-auth-session",
        root_span_id="2" * 16,
        spans=(
            CanonicalSpan(
                id="2" * 16,
                parent_id=None,
                name="Phoenix auth regression",
                kind=CanonicalSpanKind.AGENT,
                start_time=start,
                end_time=start + timedelta(seconds=1),
                status=CanonicalSpanStatus.OK,
            ),
        ),
    )


@pytest.fixture
def http11_wire(monkeypatch: pytest.MonkeyPatch) -> Iterator[list[bytes]]:
    """Keep real HTTPX/httpcore/h11 serialization, replacing only socket I/O."""
    chunks: list[bytes] = []

    def write(_stream: httpcore.MockStream, buffer: bytes, timeout: float | None = None) -> None:
        del timeout
        chunks.append(buffer)

    monkeypatch.setattr(httpcore.MockStream, "write", write)
    transport = httpx.HTTPTransport()
    transport.close()
    transport._pool = httpcore.ConnectionPool(
        network_backend=httpcore.MockBackend([b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"])
    )
    with httpx.Client(transport=transport, trust_env=False) as client:
        monkeypatch.setattr(ssrf_proxy, "_get_ssrf_client", lambda _verify: client)
        yield chunks


def test_managed_exports_serialize_optional_auth_without_cross_destination_credentials(
    monkeypatch: pytest.MonkeyPatch, trace: CanonicalTrace, http11_wire: list[bytes]
) -> None:
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_HEADERS", "authorization=Bearer%20ambient-general,api_key=ambient-general")
    monkeypatch.setenv(
        "OTEL_EXPORTER_OTLP_TRACES_HEADERS", "authorization=Bearer%20ambient-traces,api_key=ambient-traces"
    )

    for index, key in enumerate(("first-synthetic-key", "", None, "second-synthetic-key", None, "")):
        previous_chunks = len(http11_wire)
        result = export_trace(
            "phoenix", {"endpoint": "http://phoenix.test/proxy", "api_key": key, "project": f"project-{index}"}, trace
        )
        assert result.status == "accepted"
        assert result.trace_id == trace.trace_id
        head, separator, body = b"".join(http11_wire[previous_chunks:]).partition(b"\r\n\r\n")
        assert separator
        lines = head.split(b"\r\n")
        assert lines[0] == b"POST /proxy/v1/traces HTTP/1.1"
        header_values: list[tuple[bytes, bytes]] = []
        for line in lines[1:]:
            name, value = line.split(b": ", 1)
            header_values.append((name, value))
        headers = httpx.Headers(header_values)
        assert headers["Content-Type"] == "application/x-protobuf"
        if key:
            assert headers["api_key"] == key
            assert headers["authorization"] == f"Bearer {key}"
        else:
            assert "api_key" not in headers
            assert "authorization" not in headers
        payload = ExportTraceServiceRequest.FromString(body)
        resource = payload.resource_spans[0]
        assert {item.key: item.value.string_value for item in resource.resource.attributes}[
            "openinference.project.name"
        ] == f"project-{index}"
        assert resource.scope_spans[0].spans[0].trace_id.hex() == trace.trace_id


def test_legacy_sdk_prepares_anonymous_requests_without_ambient_or_previous_auth(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_HEADERS", "authorization=Bearer%20ambient-general,api_key=ambient-general")
    monkeypatch.setenv(
        "OTEL_EXPORTER_OTLP_TRACES_HEADERS", "authorization=Bearer%20ambient-traces,api_key=ambient-traces"
    )
    monkeypatch.delenv("OTEL_EXPORTER_OTLP_COMPRESSION", raising=False)
    monkeypatch.delenv("OTEL_EXPORTER_OTLP_TRACES_COMPRESSION", raising=False)
    prepared: list[requests.PreparedRequest] = []

    def send(_session: requests.Session, request: requests.PreparedRequest, **_kwargs: object) -> requests.Response:
        prepared.append(request)
        response = requests.Response()
        response.status_code = 200
        response._content = b""
        response.request = request
        return response

    monkeypatch.setattr(requests.Session, "send", send)
    for index, key in enumerate(("first-synthetic-key", "", None, "second-synthetic-key", None, "")):
        tracer, processor = setup_tracer(
            PhoenixConfig(endpoint="http://phoenix.test/proxy", api_key=key, project=f"project-{index}")
        )
        try:
            tracer.start_span("Legacy Phoenix auth regression").end()
        finally:
            processor.shutdown()
        assert len(prepared) == index + 1
        request = prepared[-1]
        assert request.method == "POST"
        assert request.url == "http://phoenix.test/proxy/v1/traces"
        assert request.headers["Content-Type"] == "application/x-protobuf"
        if key:
            assert request.headers["api_key"] == key
            assert request.headers["authorization"] == f"Bearer {key}"
        else:
            assert "api_key" not in request.headers
            assert "authorization" not in request.headers
        assert isinstance(request.body, bytes)
        payload = ExportTraceServiceRequest.FromString(request.body)
        assert {item.key: item.value.string_value for item in payload.resource_spans[0].resource.attributes}[
            "openinference.project.name"
        ] == f"project-{index}"
