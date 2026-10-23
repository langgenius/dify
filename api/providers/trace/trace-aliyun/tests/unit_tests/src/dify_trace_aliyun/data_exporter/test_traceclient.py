import uuid
from datetime import datetime
from unittest.mock import patch

import pytest
from dify_trace_aliyun.data_exporter.traceclient import (
    INVALID_SPAN_ID,
    SpanBuilder,
    TraceClient,
    build_endpoint,
    convert_datetime_to_nanoseconds,
    convert_string_to_id,
    convert_to_span_id,
    convert_to_trace_id,
    create_link,
    generate_span_id,
)
from dify_trace_aliyun.entities.aliyun_trace_entity import SpanData
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import ReadableSpan
from opentelemetry.trace import SpanKind, Status, StatusCode


class TestTraceClient:
    def test_constructor_has_no_background_exporter(self) -> None:
        client = TraceClient(service_name="test-service", endpoint="https://collector.test")
        assert client.endpoint == "https://collector.test"
        assert not hasattr(client, "exporter")
        assert not hasattr(client, "worker_thread")
        assert not hasattr(client, "queue")

    def test_add_requires_dispatch(self) -> None:
        client = TraceClient(service_name="test-service", endpoint="https://collector.test")
        client.add_span(None)
        with pytest.raises(RuntimeError, match="active trace dispatch"):
            client.add_span(SpanData(name="span", trace_id=123, span_id=456, start_time=1000, end_time=2000))


class TestSpanBuilder:
    def test_build_span(self):
        resource = Resource({"service.name": "test"})
        builder = SpanBuilder(resource)

        span_data = SpanData(
            name="test-span",
            trace_id=123,
            span_id=456,
            parent_span_id=789,
            start_time=1000,
            end_time=2000,
            status=Status(StatusCode.OK),
            span_kind=SpanKind.INTERNAL,
            attributes={"attr1": "val1"},
            events=[],
            links=[],
        )

        span = builder.build_span(span_data)
        assert isinstance(span, ReadableSpan)
        assert span.name == "test-span"
        assert span.context is not None
        assert span.context.trace_id == 123
        assert span.context.span_id == 456
        assert span.parent is not None
        assert span.parent.span_id == 789
        assert span.resource == resource
        assert span.attributes == {"attr1": "val1"}

    def test_build_span_no_parent(self):
        resource = Resource({"service.name": "test"})
        builder = SpanBuilder(resource)

        span_data = SpanData(
            name="test-span",
            trace_id=123,
            span_id=456,
            parent_span_id=None,
            start_time=1000,
            end_time=2000,
            status=Status(StatusCode.OK),
            span_kind=SpanKind.INTERNAL,
        )

        span = builder.build_span(span_data)
        assert span.parent is None


def test_create_link():
    trace_id_str = "0123456789abcdef0123456789abcdef"
    link = create_link(trace_id_str)
    assert link.context.trace_id == int(trace_id_str, 16)
    assert link.context.span_id == INVALID_SPAN_ID

    with pytest.raises(ValueError, match="Invalid trace ID format"):
        create_link("invalid-hex")


def test_generate_span_id():
    # Test normal generation
    span_id = generate_span_id()
    assert isinstance(span_id, int)
    assert span_id != INVALID_SPAN_ID

    # Test retry loop
    with patch("dify_trace_aliyun.data_exporter.traceclient.random.getrandbits") as mock_rand:
        mock_rand.side_effect = [INVALID_SPAN_ID, 999]
        span_id = generate_span_id()
        assert span_id == 999
        assert mock_rand.call_count == 2


def test_convert_to_trace_id():
    uid = str(uuid.uuid4())
    trace_id = convert_to_trace_id(uid)
    assert trace_id == uuid.UUID(uid).int

    with pytest.raises(ValueError, match="UUID cannot be None"):
        convert_to_trace_id(None)

    with pytest.raises(ValueError, match="Invalid UUID input"):
        convert_to_trace_id("not-a-uuid")


def test_convert_string_to_id():
    assert convert_string_to_id("test") > 0
    # Test with None string
    with patch("dify_trace_aliyun.data_exporter.traceclient.generate_span_id") as mock_gen:
        mock_gen.return_value = 12345
        assert convert_string_to_id(None) == 12345


def test_convert_to_span_id():
    uid = str(uuid.uuid4())
    span_id = convert_to_span_id(uid, "test-type")
    assert isinstance(span_id, int)

    with pytest.raises(ValueError, match="UUID cannot be None"):
        convert_to_span_id(None, "test")

    with pytest.raises(ValueError, match="Invalid UUID input"):
        convert_to_span_id("not-a-uuid", "test")


def test_convert_datetime_to_nanoseconds():
    dt = datetime(2023, 1, 1, 12, 0, 0)
    ns = convert_datetime_to_nanoseconds(dt)
    assert ns == int(dt.timestamp() * 1e9)
    assert convert_datetime_to_nanoseconds(None) is None


def test_build_endpoint():
    license_key = "abc"

    # CMS 2.0 endpoint
    url1 = "https://log.aliyuncs.com"
    assert build_endpoint(url1, license_key) == "https://log.aliyuncs.com/adapt_abc/api/v1/traces"

    # XTrace endpoint
    url2 = "https://example.com"
    assert build_endpoint(url2, license_key) == "https://example.com/adapt_abc/api/otlp/traces"
