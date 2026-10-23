"""Exercise Aliyun's observed HTTP ACK through both real protobuf owners."""

import logging
from collections.abc import Mapping
from datetime import UTC, datetime, timedelta
from typing import Literal, TypedDict, Unpack

import httpx
import pytest
from dify_trace_aliyun.data_exporter.traceclient import TraceClient
from dify_trace_aliyun.entities.aliyun_trace_entity import SpanData
from opentelemetry.context import _SUPPRESS_INSTRUMENTATION_KEY, get_value
from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import (
    ExportTraceServiceRequest,
    ExportTraceServiceResponse,
)

from core.helper import ssrf_proxy
from core.ops.exceptions import RetryableTraceDispatchError
from core.ops.unified_trace.entities import CanonicalSpan, CanonicalSpanKind, CanonicalSpanStatus, CanonicalTrace
from services.tracing.otlp_export import export_http, is_aliyun_http_success_ack
from services.tracing.provider_dispatch import TraceExportRejectedError, TraceExportUncertainError, export_trace

ENDPOINT = "https://collector.test/adapt_synthetic-license/api/otlp/traces"
START = datetime(2026, 10, 19, tzinfo=UTC)
TRACE_ID = "1" * 32
SPAN_ID = "2" * 16

type Owner = Literal["managed", "legacy"]


class RequestOptions(TypedDict, total=False):
    content: bytes
    headers: Mapping[str, str]
    max_retries: int
    timeout: float
    follow_redirects: bool


def boundary(
    monkeypatch: pytest.MonkeyPatch, status: int, content: bytes, content_type: str
) -> list[ExportTraceServiceRequest]:
    received: list[ExportTraceServiceRequest] = []

    def send(method: str, url: str, **options: Unpack[RequestOptions]) -> httpx.Response:
        assert method == "POST"
        assert url == ENDPOINT
        assert options["max_retries"] == 0
        assert options["follow_redirects"] is False
        assert options["headers"] == {"Content-Type": "application/x-protobuf", "Accept": "application/x-protobuf"}
        assert get_value(_SUPPRESS_INSTRUMENTATION_KEY) is True
        received.append(ExportTraceServiceRequest.FromString(options["content"]))
        headers = {"Content-Type": content_type} if content_type else {}
        return httpx.Response(status, content=content, headers=headers)

    monkeypatch.setattr(ssrf_proxy, "make_request", send)
    return received


def dispatch(owner: Owner) -> None:
    if owner == "managed":
        trace = CanonicalTrace(
            trace_id=TRACE_ID,
            root_span_id=SPAN_ID,
            session_id="synthetic-conversation",
            spans=(
                CanonicalSpan(
                    id=SPAN_ID,
                    parent_id=None,
                    name="synthetic root",
                    kind=CanonicalSpanKind.AGENT,
                    start_time=START,
                    end_time=START + timedelta(seconds=1),
                    status=CanonicalSpanStatus.OK,
                ),
            ),
        )
        result = export_trace(
            "aliyun",
            {"endpoint": "https://collector.test", "license_key": "synthetic-license", "app_name": "synthetic"},
            trace,
        )
        assert result.status == "accepted"
    else:
        client = TraceClient("synthetic", ENDPOINT)
        with client.batch():
            client.add_span(
                SpanData(
                    trace_id=int(TRACE_ID, 16),
                    span_id=int(SPAN_ID, 16),
                    name="synthetic root",
                    start_time=int(START.timestamp()) * 1_000_000_000,
                    end_time=int((START + timedelta(seconds=1)).timestamp()) * 1_000_000_000,
                )
            )
        assert client._dispatch_spans.get() is None


def assert_one_batch(received: list[ExportTraceServiceRequest]) -> None:
    assert len(received) == 1
    spans = received[0].resource_spans[0].scope_spans[0].spans
    assert len(spans) == 1
    assert spans[0].trace_id.hex() == TRACE_ID
    assert spans[0].span_id.hex() == SPAN_ID


@pytest.mark.parametrize("owner", ["managed", "legacy"])
@pytest.mark.parametrize("content_type", ["", "application/json", "application/x-protobuf"])
def test_exact_observed_ack_accepts_one_batch_without_changing_its_ids(
    monkeypatch: pytest.MonkeyPatch, owner: Owner, content_type: str
) -> None:
    received = boundary(monkeypatch, 200, b'"success"', content_type)
    dispatch(owner)
    assert_one_batch(received)


@pytest.mark.parametrize("owner", ["managed", "legacy"])
@pytest.mark.parametrize(
    ("content", "content_type"),
    [
        (b"success", ""),
        (b'"SUCCESS"', ""),
        (b' "success"', "application/json"),
        (b'"success"\n', "application/json"),
        (b'{"success":true}', "application/json"),
        (b'{"message":"success"}', "application/json"),
        (b"true", "application/json"),
        (b"not protobuf", ""),
    ],
)
def test_other_ack_bodies_are_uncertain_and_not_replayed(
    monkeypatch: pytest.MonkeyPatch, owner: Owner, content: bytes, content_type: str
) -> None:
    received = boundary(monkeypatch, 200, content, content_type)
    with pytest.raises(TraceExportUncertainError, match="unreadable ingestion acknowledgment") as error:
        dispatch(owner)
    assert error.value.acceptance_unknown is True
    assert_one_batch(received)


@pytest.mark.parametrize("owner", ["managed", "legacy"])
@pytest.mark.parametrize("status", [201, 202, 204])
def test_literal_ack_does_not_accept_another_success_status(
    monkeypatch: pytest.MonkeyPatch, owner: Owner, status: int
) -> None:
    received = boundary(monkeypatch, status, b'"success"', "")
    assert is_aliyun_http_success_ack(status, b'"success"') is False
    with pytest.raises(TraceExportUncertainError) as error:
        dispatch(owner)
    assert error.value.acceptance_unknown is True
    assert_one_batch(received)


@pytest.mark.parametrize("owner", ["managed", "legacy"])
@pytest.mark.parametrize("status", [403, 429, 503])
def test_literal_ack_does_not_override_http_rejection_or_known_retry(
    monkeypatch: pytest.MonkeyPatch, owner: Owner, status: int
) -> None:
    received = boundary(monkeypatch, status, b'"success"', "")
    expected = TraceExportRejectedError if status == 403 else RetryableTraceDispatchError
    with pytest.raises(expected) as error:
        dispatch(owner)
    if isinstance(error.value, RetryableTraceDispatchError):
        assert error.value.acceptance_unknown is False
    assert_one_batch(received)


@pytest.mark.parametrize("owner", ["managed", "legacy"])
@pytest.mark.parametrize("encoding", ["protobuf", "json"])
@pytest.mark.parametrize("rejected_spans", [0, 1])
def test_standard_otlp_ack_and_partial_success_remain_validated(
    monkeypatch: pytest.MonkeyPatch, owner: Owner, encoding: str, rejected_spans: int
) -> None:
    if encoding == "protobuf":
        response = ExportTraceServiceResponse()
        response.partial_success.rejected_spans = rejected_spans
        response.partial_success.error_message = "synthetic warning"
        content = response.SerializeToString()
        content_type = "application/x-protobuf"
    else:
        content = b'{"partialSuccess":{"rejectedSpans":"%d","errorMessage":"synthetic warning"}}' % rejected_spans
        content_type = "application/json"
    received = boundary(monkeypatch, 200, content, content_type)
    if rejected_spans:
        with pytest.raises(TraceExportUncertainError, match="partially accepted") as error:
            dispatch(owner)
        assert error.value.acceptance_unknown is True
    else:
        dispatch(owner)
    assert_one_batch(received)


@pytest.mark.parametrize("owner", ["managed", "legacy"])
def test_damaged_compressed_ack_is_uncertain_after_real_http_submission(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture, owner: Owner
) -> None:
    received: list[ExportTraceServiceRequest] = []
    previous_suppression = get_value(_SUPPRESS_INSTRUMENTATION_KEY)

    def send(wire: httpx.Request) -> httpx.Response:
        assert wire.method == "POST"
        assert str(wire.url) == ENDPOINT
        assert get_value(_SUPPRESS_INSTRUMENTATION_KEY) is True
        received.append(ExportTraceServiceRequest.FromString(wire.content))
        # Reading a malformed compressed response raises DecodingError, which
        # is a RequestError but not a TransportError. Submission already ran.
        return httpx.Response(
            200,
            headers={"Content-Encoding": "gzip"},
            stream=httpx.ByteStream(b"invalid gzip acknowledgment"),
            request=wire,
        )

    with httpx.Client(transport=httpx.MockTransport(send)) as client:

        def get_client(ssl_verify_enabled: bool) -> httpx.Client:
            assert isinstance(ssl_verify_enabled, bool)
            return client

        monkeypatch.setattr(ssrf_proxy, "_get_ssrf_client", get_client)
        with caplog.at_level(logging.INFO, logger="httpx"):
            with pytest.raises(TraceExportUncertainError) as error:
                dispatch(owner)
    assert error.value.acceptance_unknown is True
    assert error.value.__cause__ is None
    assert error.value.__context__ is None
    assert "synthetic-license" not in str(error.value) + caplog.text
    assert get_value(_SUPPRESS_INSTRUMENTATION_KEY) == previous_suppression
    assert_one_batch(received)


@pytest.mark.parametrize("provider", ["langfuse", "phoenix", "tencent"])
@pytest.mark.parametrize("content_type", ["", "application/json"])
def test_literal_success_ack_does_not_expand_other_providers(
    monkeypatch: pytest.MonkeyPatch, provider: str, content_type: str
) -> None:
    received = boundary(monkeypatch, 200, b'"success"', content_type)
    with pytest.raises(TraceExportUncertainError, match="unreadable ingestion acknowledgment") as error:
        export_http(provider, ENDPOINT, {}, ExportTraceServiceRequest())
    assert error.value.acceptance_unknown is True
    assert len(received) == 1
