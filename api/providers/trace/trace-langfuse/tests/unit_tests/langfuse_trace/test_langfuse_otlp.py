"""OTLP requests the Langfuse provider sends for traces, spans, and generations."""

import base64
import json
from datetime import UTC, datetime

import pytest
from dify_trace_langfuse.entities.langfuse_trace_entity import (
    GenerationUsage,
    LangfuseGeneration,
    LangfuseSpan,
    LangfuseTrace,
    LevelEnum,
    UnitEnum,
)
from dify_trace_langfuse.langfuse_trace import LangFuseDataTrace
from opentelemetry.proto.common.v1.common_pb2 import AnyValue
from opentelemetry.proto.trace.v1.trace_pb2 import Span, Status


def _value(value: AnyValue) -> object:
    match value.WhichOneof("value"):
        case "string_value":
            return value.string_value
        case "int_value":
            return value.int_value
        case "double_value":
            return value.double_value
        case "bool_value":
            return value.bool_value
        case other:
            raise AssertionError(f"unexpected attribute value type {other}")


def _attributes(span: Span) -> dict[str, object]:
    return {item.key: _value(item.value) for item in span.attributes}


@pytest.fixture
def trace_instance(langfuse_config, otel_sink):
    return LangFuseDataTrace(langfuse_config)


MESSAGE_ID = "7b3c6c0e-38a1-4b52-9a7e-3ad8f3a1c001"
MESSAGE_TRACE_ID = "7b3c6c0e38a14b529a7e3ad8f3a1c001"


def test_add_trace_sends_the_trace_as_a_root_span(trace_instance, otel_sink):
    trace_instance.add_trace(
        LangfuseTrace(
            id=MESSAGE_ID,
            name="message",
            user_id="end-user-1",
            session_id="conversation-1",
            input="What is Dify?",
            output="A platform.",
            metadata={"app_id": "app-1", "total_tokens": 20},
            tags=["message", "chat"],
            version="1.0",
            start_time=datetime(2026, 10, 1, 8, 0, 0),
            end_time=datetime(2026, 10, 1, 8, 0, 2),
        )
    )

    (request,) = otel_sink.requests
    assert str(request.url) == "https://cloud.langfuse.com/api/public/otel/v1/traces"
    assert request.headers["authorization"] == "Basic " + base64.b64encode(b"pk-123:sk-123").decode()
    assert request.headers["content-type"] == "application/x-protobuf"
    assert request.headers["x-langfuse-ingestion-version"] == "4"
    (root,) = otel_sink.spans()
    assert root.trace_id.hex() == MESSAGE_TRACE_ID
    assert root.parent_span_id == b""
    assert root.start_time_unix_nano == int(datetime(2026, 10, 1, 8, 0, 0, tzinfo=UTC).timestamp() * 1e9)
    assert root.end_time_unix_nano - root.start_time_unix_nano == 2_000_000_000
    attributes = _attributes(root)
    assert attributes["langfuse.trace.name"] == "message"
    assert attributes["langfuse.user.id"] == "end-user-1"
    assert attributes["langfuse.session.id"] == "conversation-1"
    assert json.loads(str(attributes["langfuse.trace.tags"])) == ["message", "chat"]
    assert attributes["langfuse.version"] == "1.0"
    assert attributes["langfuse.observation.type"] == "span"
    assert json.loads(str(attributes["langfuse.observation.input"])) == [{"role": "user", "content": "What is Dify?"}]
    assert attributes["langfuse.trace.metadata.app_id"] == "app-1"
    assert attributes["langfuse.trace.metadata.total_tokens"] == 20


def test_observations_without_a_parent_sit_under_the_trace_root(trace_instance, otel_sink):
    trace_instance.add_trace(LangfuseTrace(id=MESSAGE_ID, name="message"))
    trace_instance.add_span(LangfuseSpan(name="moderation", trace_id=MESSAGE_ID))
    trace_instance.add_generation(LangfuseGeneration(name="llm", trace_id=MESSAGE_ID))

    root, moderation, llm = otel_sink.spans()
    assert {span.trace_id.hex() for span in (root, moderation, llm)} == {MESSAGE_TRACE_ID}
    assert moderation.parent_span_id == root.span_id
    assert llm.parent_span_id == root.span_id
    assert len({root.span_id, moderation.span_id, llm.span_id}) == 3


def test_explicit_parents_and_ids_are_stable(trace_instance, otel_sink):
    for _ in range(2):
        trace_instance.add_span(LangfuseSpan(id="run-1", name="workflow", trace_id=MESSAGE_ID))
        trace_instance.add_span(
            LangfuseSpan(id="node-1", name="code", trace_id=MESSAGE_ID, parent_observation_id="run-1")
        )

    workflow, node, workflow_again, node_again = otel_sink.spans()
    assert node.parent_span_id == workflow.span_id
    assert (workflow.span_id, node.span_id) == (workflow_again.span_id, node_again.span_id)


@pytest.mark.parametrize(
    ("trace_key", "expected"),
    [
        (MESSAGE_ID, MESSAGE_TRACE_ID),
        (MESSAGE_TRACE_ID.upper(), MESSAGE_TRACE_ID),
        ("caller-trace-1", None),
    ],
)
def test_trace_ids_follow_the_otel_format(trace_instance, otel_sink, trace_key: str, expected: str | None):
    trace_instance.add_trace(LangfuseTrace(id=trace_key, name="message"))

    (root,) = otel_sink.spans()
    assert len(root.trace_id) == 16
    if expected is not None:
        assert root.trace_id.hex() == expected


def test_generation_carries_model_usage_cost_and_completion_start(trace_instance, otel_sink):
    trace_instance.add_generation(
        LangfuseGeneration(
            id="node-llm",
            name="llm",
            trace_id=MESSAGE_ID,
            model="gpt-4o",
            model_parameters={"temperature": 0.1},
            start_time=datetime(2026, 10, 1, 8, 0, 0),
            completion_start_time=datetime(2026, 10, 1, 8, 0, 0, 250000),
            end_time=datetime(2026, 10, 1, 8, 0, 2),
            input=[{"role": "user", "text": "hi"}],
            output="hello",
            usage=GenerationUsage(input=12, output=8, total=20, unit=UnitEnum.TOKENS, totalCost=0.0004),
            metadata={"node_type": "llm"},
            level=LevelEnum.DEFAULT,
            status_message="",
        )
    )

    (generation,) = otel_sink.spans()
    attributes = _attributes(generation)
    assert attributes["langfuse.observation.type"] == "generation"
    assert attributes["langfuse.observation.model.name"] == "gpt-4o"
    assert json.loads(str(attributes["langfuse.observation.model.parameters"])) == {"temperature": 0.1}
    assert json.loads(str(attributes["langfuse.observation.usage_details"])) == {"input": 12, "output": 8, "total": 20}
    assert json.loads(str(attributes["langfuse.observation.cost_details"])) == {"total": 0.0004}
    assert attributes["langfuse.observation.completion_start_time"] == "2026-10-01T08:00:00.250000+00:00"
    assert json.loads(str(attributes["langfuse.observation.input"])) == [{"role": "user", "content": "hi"}]
    assert attributes["langfuse.observation.metadata.node_type"] == "llm"
    assert generation.status.code == Status.STATUS_CODE_OK


def test_generation_without_usage_sends_no_usage_or_cost(trace_instance, otel_sink):
    trace_instance.add_generation(LangfuseGeneration(name="llm", trace_id=MESSAGE_ID))

    (generation,) = otel_sink.spans()
    attributes = _attributes(generation)
    assert "langfuse.observation.usage_details" not in attributes
    assert "langfuse.observation.cost_details" not in attributes
    assert "langfuse.observation.model.name" not in attributes


def test_error_level_marks_the_span_as_failed(trace_instance, otel_sink):
    trace_instance.add_span(
        LangfuseSpan(name="tool", trace_id=MESSAGE_ID, level=LevelEnum.ERROR, status_message="Tool failed")
    )

    (span,) = otel_sink.spans()
    attributes = _attributes(span)
    assert span.status.code == Status.STATUS_CODE_ERROR
    assert attributes["langfuse.observation.level"] == "ERROR"
    assert attributes["langfuse.observation.status_message"] == "Tool failed"


def test_missing_times_fall_back_to_the_send_time(trace_instance, otel_sink):
    before = int(datetime.now(UTC).timestamp() * 1e9)
    trace_instance.add_span(LangfuseSpan(name="moderation", trace_id=MESSAGE_ID, start_time=None))

    (span,) = otel_sink.spans()
    assert span.start_time_unix_nano >= before
    assert span.end_time_unix_nano == span.start_time_unix_nano


@pytest.mark.parametrize(
    ("send", "message"),
    [
        (lambda trace: trace.add_trace(LangfuseTrace(id="t1", name="trace")), "LangFuse Failed to create trace"),
        (lambda trace: trace.add_span(LangfuseSpan(name="span", trace_id="t1")), "LangFuse Failed to create span"),
        (
            lambda trace: trace.add_generation(LangfuseGeneration(name="gen", trace_id="t1")),
            "LangFuse Failed to create generation",
        ),
    ],
)
@pytest.mark.parametrize("status_code", [400, 401, 404, 500])
def test_rejected_requests_raise(trace_instance, otel_sink, send, message: str, status_code: int):
    otel_sink.status_code = status_code
    with pytest.raises(ValueError, match=message):
        send(trace_instance)


def test_closed_client_raises(trace_instance):
    trace_instance.close()
    with pytest.raises(ValueError, match="LangFuse Failed to create span"):
        trace_instance.add_span(LangfuseSpan(name="span", trace_id="t1"))
