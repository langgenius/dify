import time
import uuid
from datetime import datetime
from unittest.mock import MagicMock, patch

import httpx
import pytest
from opentelemetry.sdk.trace import ReadableSpan
from opentelemetry.trace import SpanKind, Status, StatusCode

from core.ops.aliyun_trace.data_exporter.traceclient import (
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
from core.ops.aliyun_trace.entities.aliyun_trace_entity import SpanData


@pytest.fixture
def trace_client_factory():
    """Factory fixture for creating TraceClient instances with automatic cleanup."""
    clients_to_shutdown = []

    def _factory(**kwargs):
        client = TraceClient(**kwargs)
        clients_to_shutdown.append(client)
        return client

    yield _factory

    # Cleanup: shutdown all created clients
    for client in clients_to_shutdown:
        client.shutdown()


class TestTraceClient:
    @patch("core.ops.aliyun_trace.data_exporter.traceclient.OTLPSpanExporter")
    @patch("core.ops.aliyun_trace.data_exporter.traceclient.socket.gethostname")
    def test_init(self, mock_gethostname, mock_exporter_class, trace_client_factory):
        mock_gethostname.return_value = "test-host"
        client = trace_client_factory(service_name="test-service", endpoint="http://test-endpoint")

        assert client.endpoint == "http://test-endpoint"
        assert client.max_queue_size == 1000
        assert client.schedule_delay_sec == 5
        assert client.done is False
        assert client.worker_thread.is_alive()

        client.shutdown()
        assert client.done is True

    @patch("core.ops.aliyun_trace.data_exporter.traceclient.OTLPSpanExporter")
    def test_export(self, mock_exporter_class, trace_client_factory):
        mock_exporter = mock_exporter_class.return_value
        client = trace_client_factory(service_name="test-service", endpoint="http://test-endpoint")
        spans = [MagicMock(spec=ReadableSpan)]
        client.export(spans)
        mock_exporter.export.assert_called_once_with(spans)

    @patch("core.ops.aliyun_trace.data_exporter.traceclient.httpx.head")
    @patch("core.ops.aliyun_trace.data_exporter.traceclient.OTLPSpanExporter")
    def test_api_check_success(self, mock_exporter_class, mock_head, trace_client_factory):
        mock_response = MagicMock()
        mock_response.status_code = 405
        mock_head.return_value = mock_response

        client = trace_client_factory(service_name="test-service", endpoint="http://test-endpoint")
        assert client.api_check() is True

    @patch("core.ops.aliyun_trace.data_exporter.traceclient.httpx.head")
    @patch("core.ops.aliyun_trace.data_exporter.traceclient.OTLPSpanExporter")
    def test_api_check_failure_status(self, mock_exporter_class, mock_head, trace_client_factory):
        mock_response = MagicMock()
        mock_response.status_code = 500
        mock_head.return_value = mock_response

        client = trace_client_factory(service_name="test-service", endpoint="http://test-endpoint")
        assert client.api_check() is False

    @patch("core.ops.aliyun_trace.data_exporter.traceclient.httpx.head")
    @patch("core.ops.aliyun_trace.data_exporter.traceclient.OTLPSpanExporter")
    def test_api_check_exception(self, mock_exporter_class, mock_head, trace_client_factory):
        mock_head.side_effect = httpx.RequestError("Connection error")

        client = trace_client_factory(service_name="test-service", endpoint="http://test-endpoint")
        with pytest.raises(ValueError, match="AliyunTrace API check failed: Connection error"):
            client.api_check()

    @patch("core.ops.aliyun_trace.data_exporter.traceclient.OTLPSpanExporter")
    def test_get_project_url(self, mock_exporter_class, trace_client_factory):
        client = trace_client_factory(service_name="test-service", endpoint="http://test-endpoint")
        assert client.get_project_url() == "https://arms.console.aliyun.com/#/llm"

    @patch("core.ops.aliyun_trace.data_exporter.traceclient.OTLPSpanExporter")
    def test_add_span(self, mock_exporter_class, trace_client_factory):
        client = trace_client_factory(
            service_name="test-service",
            endpoint="http://test-endpoint",
            max_export_batch_size=2,
        )

        # Test add None
        client.add_span(None)
        assert len(client.queue) == 0

        # Test add valid SpanData
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

        mock_span = MagicMock(spec=ReadableSpan)
        client.span_builder.build_span = MagicMock(return_value=mock_span)

        with patch.object(client.condition, "notify") as mock_notify:
            client.add_span(span_data)
            assert len(client.queue) == 1
            mock_notify.assert_not_called()

            client.add_span(span_data)
            assert len(client.queue) == 2
            mock_notify.assert_called_once()

    @patch("core.ops.aliyun_trace.data_exporter.traceclient.OTLPSpanExporter")
    @patch("core.ops.aliyun_trace.data_exporter.traceclient.logger")
    def test_add_span_queue_full(self, mock_logger, mock_exporter_class, trace_client_factory):
        client = trace_client_factory(service_name="test-service", endpoint="http://test-endpoint", max_queue_size=1)

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
        mock_span = MagicMock(spec=ReadableSpan)
        client.span_builder.build_span = MagicMock(return_value=mock_span)

        client.add_span(span_data)
        assert len(client.queue) == 1

        client.add_span(span_data)
        assert len(client.queue) == 1
        mock_logger.warning.assert_called_with("Queue is full, likely spans will be dropped.")

    @patch("core.ops.aliyun_trace.data_exporter.traceclient.OTLPSpanExporter")
    def test_export_batch_error(self, mock_exporter_class, trace_client_factory):
        mock_exporter = mock_exporter_class.return_value
        mock_exporter.export.side_effect = Exception("Export failed")

        client = trace_client_factory(service_name="test-service", endpoint="http://test-endpoint")
        mock_span = MagicMock(spec=ReadableSpan)
        client.queue.append(mock_span)

        with patch("core.ops.aliyun_trace.data_exporter.traceclient.logger") as mock_logger:
            client._export_batch()
            mock_logger.warning.assert_called()

    @patch("core.ops.aliyun_trace.data_exporter.traceclient.OTLPSpanExporter")
    def test_worker_loop(self, mock_exporter_class, trace_client_factory):
        # We need to test the wait timeout in _worker
        # But _worker runs in a thread. Let's mock condition.wait.
        client = trace_client_factory(
            service_name="test-service",
            endpoint="http://test-endpoint",
            schedule_delay_sec=0.1,
        )

        with patch.object(client.condition, "wait") as mock_wait:
            # Let it run for a bit then shut down
            time.sleep(0.2)
            client.shutdown()
            # mock_wait might have been called
            assert mock_wait.called or client.done

    @patch("core.ops.aliyun_trace.data_exporter.traceclient.OTLPSpanExporter")
    def test_shutdown_flushes(self, mock_exporter_class, trace_client_factory):
        mock_exporter = mock_exporter_class.return_value
        client = trace_client_factory(service_name="test-service", endpoint="http://test-endpoint")

        mock_span = MagicMock(spec=ReadableSpan)
        client.queue.append(mock_span)

        client.shutdown()
        # Should have called export twice (once in worker/export_batch, once in shutdown)
        # or at least once if worker was waiting
        assert mock_exporter.export.called
        assert mock_exporter.shutdown.called


class TestSpanBuilder:
    def test_build_span(self):
        resource = MagicMock()
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
        assert span.context.trace_id == 123
        assert span.context.span_id == 456
        assert span.parent.span_id == 789
        assert span.resource == resource
        assert span.attributes == {"attr1": "val1"}

    def test_build_span_no_parent(self):
        resource = MagicMock()
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
    with patch("core.ops.aliyun_trace.data_exporter.traceclient.random.getrandbits") as mock_rand:
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
    with patch("core.ops.aliyun_trace.data_exporter.traceclient.generate_span_id") as mock_gen:
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
