import pytest
from opentelemetry import trace as trace_api
from opentelemetry.sdk.trace import Event
from opentelemetry.trace import SpanKind, Status, StatusCode
from pydantic import ValidationError

from core.ops.aliyun_trace.entities.aliyun_trace_entity import SpanData, TraceMetadata


class TestTraceMetadata:
    def test_trace_metadata_init(self):
        links = [trace_api.Link(context=trace_api.SpanContext(0, 0, False))]
        metadata = TraceMetadata(
            trace_id=123, workflow_span_id=456, session_id="session_1", user_id="user_1", links=links
        )
        assert metadata.trace_id == 123
        assert metadata.workflow_span_id == 456
        assert metadata.session_id == "session_1"
        assert metadata.user_id == "user_1"
        assert metadata.links == links


class TestSpanData:
    def test_span_data_init_required_fields(self):
        span_data = SpanData(trace_id=123, span_id=456, name="test_span", start_time=1000, end_time=2000)
        assert span_data.trace_id == 123
        assert span_data.span_id == 456
        assert span_data.name == "test_span"
        assert span_data.start_time == 1000
        assert span_data.end_time == 2000

        # Check defaults
        assert span_data.parent_span_id is None
        assert span_data.attributes == {}
        assert span_data.events == []
        assert span_data.links == []
        assert span_data.status.status_code == StatusCode.UNSET
        assert span_data.span_kind == SpanKind.INTERNAL

    def test_span_data_with_optional_fields(self):
        event = Event(name="event_1", timestamp=1500)
        link = trace_api.Link(context=trace_api.SpanContext(0, 0, False))
        status = Status(StatusCode.OK)

        span_data = SpanData(
            trace_id=123,
            parent_span_id=111,
            span_id=456,
            name="test_span",
            attributes={"key": "value"},
            events=[event],
            links=[link],
            status=status,
            start_time=1000,
            end_time=2000,
            span_kind=SpanKind.SERVER,
        )

        assert span_data.parent_span_id == 111
        assert span_data.attributes == {"key": "value"}
        assert span_data.events == [event]
        assert span_data.links == [link]
        assert span_data.status.status_code == status.status_code
        assert span_data.span_kind == SpanKind.SERVER

    def test_span_data_missing_required_fields(self):
        with pytest.raises(ValidationError):
            SpanData(
                trace_id=123,
                # span_id missing
                name="test_span",
                start_time=1000,
                end_time=2000,
            )

    def test_span_data_arbitrary_types_allowed(self):
        # opentelemetry.trace.Status and Event are "arbitrary types" for Pydantic
        # This test ensures they are accepted thanks to model_config
        status = Status(StatusCode.ERROR, description="error occurred")
        event = Event(name="exception", timestamp=1234, attributes={"exception.type": "ValueError"})

        span_data = SpanData(
            trace_id=123, span_id=456, name="test_span", status=status, events=[event], start_time=1000, end_time=2000
        )

        assert span_data.status.status_code == status.status_code
        assert span_data.status.description == status.description
        assert span_data.events == [event]
