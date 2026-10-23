import json
from datetime import datetime
from typing import cast
from unittest.mock import MagicMock

import pytest
from dify_trace_arize_phoenix.config import PhoenixConfig
from dify_trace_arize_phoenix.unified_trace import UnifiedPhoenixAdapter
from openinference.semconv.trace import SpanAttributes
from opentelemetry.sdk.trace.export import SpanExportResult
from opentelemetry.trace import StatusCode
from opentelemetry.trace.propagation.tracecontext import TraceContextTextMapPropagator

from core.ops.exceptions import InvalidTraceParentContextError, RetryableTraceDispatchError
from core.ops.unified_trace.entities import CanonicalSpan, CanonicalSpanKind, CanonicalSpanStatus, CanonicalTrace
from core.ops.unified_trace.parent_context import ParentResolution, ProviderParentContext, destination_scope

VALID_TRACEPARENT = "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01"
PhoenixAdapterFixture = tuple[UnifiedPhoenixAdapter, MagicMock, list[MagicMock]]


def _inject_traceparent(carrier: dict[str, str], context: object) -> None:
    assert context is not None
    carrier["traceparent"] = VALID_TRACEPARENT


def span(**overrides: object) -> CanonicalSpan:
    values: dict[str, object] = {
        "id": "root",
        "parent_id": None,
        "name": "root",
        "kind": CanonicalSpanKind.CHAIN,
        "start_time": datetime(2025, 1, 1),
        "end_time": datetime(2025, 1, 1, 0, 0, 1),
        "inputs": {"input": "value"},
        "outputs": {"output": "value"},
        "status": CanonicalSpanStatus.OK,
        "metadata": {},
    }
    values.update(overrides)
    return CanonicalSpan.model_validate(values)


def trace(*spans: CanonicalSpan, session_id: str = "session-1") -> CanonicalTrace:
    values = spans or (span(),)
    return CanonicalTrace(
        trace_id="trace-1",
        session_id=session_id,
        root_span_id=values[0].id,
        spans=values,
    )


@pytest.fixture
def adapter(monkeypatch: pytest.MonkeyPatch) -> PhoenixAdapterFixture:
    tracer = MagicMock()
    otel_spans = [MagicMock() for _ in range(8)]
    tracer.start_span.side_effect = otel_spans
    exporter = MagicMock()
    exporter.export.return_value = SpanExportResult.SUCCESS
    monkeypatch.setattr(
        "dify_trace_arize_phoenix.unified_trace.setup_unified_tracer",
        lambda _config: (tracer, exporter),
    )
    value = UnifiedPhoenixAdapter(
        PhoenixConfig(api_key="secret", project="project-a", endpoint="https://phoenix.example")
    )
    value._propagator = MagicMock()
    return value, tracer, otel_spans


def test_emit_creates_parent_before_child_and_maps_session(adapter: PhoenixAdapterFixture) -> None:
    subject, tracer, _ = adapter
    root = span()
    child = span(id="child", parent_id="root", name="llm", kind=CanonicalSpanKind.LLM)

    subject.emit(trace(root, child, session_id="customer-session"), None, MagicMock())

    assert [call.kwargs["name"] for call in tracer.start_span.call_args_list] == ["root", "llm"]
    root_attributes = tracer.start_span.call_args_list[0].kwargs["attributes"]
    assert root_attributes[SpanAttributes.SESSION_ID] == "customer-session"
    assert root_attributes[SpanAttributes.OPENINFERENCE_SPAN_KIND] == "CHAIN"
    assert tracer.start_span.call_args_list[1].kwargs["context"] is not None


@pytest.mark.parametrize("kind", list(CanonicalSpanKind))
def test_emit_maps_every_canonical_kind(adapter: PhoenixAdapterFixture, kind: CanonicalSpanKind) -> None:
    expected = {
        CanonicalSpanKind.CHAIN: "CHAIN",
        CanonicalSpanKind.LLM: "LLM",
        CanonicalSpanKind.RETRIEVER: "RETRIEVER",
        CanonicalSpanKind.TOOL: "TOOL",
        CanonicalSpanKind.AGENT: "AGENT",
    }[kind]
    subject, tracer, _ = adapter

    subject.emit(trace(span(kind=kind)), None, MagicMock())

    attributes = tracer.start_span.call_args.kwargs["attributes"]
    assert attributes[SpanAttributes.OPENINFERENCE_SPAN_KIND] == expected
    metadata = json.loads(attributes[SpanAttributes.METADATA])
    assert metadata["dify.span.kind"] == kind.value


def test_emit_preserves_logical_links_and_overrides_reserved_metadata(adapter: PhoenixAdapterFixture) -> None:
    subject, tracer, _ = adapter
    linked_span = span(
        metadata={"dify.span.kind": "forged", "dify.span.links": ["forged"]},
        links=("message-a",),
    )

    subject.emit(trace(linked_span), None, MagicMock())

    attributes = tracer.start_span.call_args.kwargs["attributes"]
    metadata = json.loads(attributes[SpanAttributes.METADATA])
    assert metadata["dify.span.kind"] == "chain"
    assert metadata["dify.span.links"] == ["message-a"]


def test_emit_restores_w3c_parent_context(adapter: PhoenixAdapterFixture) -> None:
    subject, _, _ = adapter
    subject._propagator = MagicMock(wraps=TraceContextTextMapPropagator())
    provider_context = ProviderParentContext(
        provider="phoenix",
        scope=subject.scope,
        trace_id="outer-trace",
        parent_id="outer-tool",
        provider_context={"traceparent": VALID_TRACEPARENT},
    )

    subject.emit(trace(), ParentResolution.restored(provider_context), MagicMock())

    subject._propagator.extract.assert_called_once_with(carrier={"traceparent": VALID_TRACEPARENT})


def test_emit_rejects_restored_context_without_traceparent(adapter: PhoenixAdapterFixture) -> None:
    subject, _, _ = adapter
    provider_context = ProviderParentContext(
        provider="phoenix",
        scope=subject.scope,
        trace_id="outer-trace",
        parent_id="outer-tool",
        provider_context={},
    )

    with pytest.raises(InvalidTraceParentContextError):
        subject.emit(trace(), ParentResolution.restored(provider_context), MagicMock())


def test_emit_rejects_malformed_traceparent(adapter: PhoenixAdapterFixture) -> None:
    subject, _, _ = adapter
    subject._propagator = TraceContextTextMapPropagator()
    provider_context = ProviderParentContext(
        provider="phoenix",
        scope=subject.scope,
        trace_id="outer-trace",
        parent_id="outer-tool",
        provider_context={"traceparent": "malformed"},
    )

    with pytest.raises(InvalidTraceParentContextError):
        subject.emit(trace(), ParentResolution.restored(provider_context), MagicMock())


def test_emit_publishes_tool_context_after_span_export(adapter: PhoenixAdapterFixture) -> None:
    subject, tracer, otel_spans = adapter
    cast(MagicMock, subject._propagator.inject).side_effect = _inject_traceparent
    events: list[str] = []
    otel_spans[0].end.side_effect = lambda **_kwargs: events.append("end")
    publish = MagicMock(side_effect=lambda *_args: events.append("publish"))
    tool = span(id="tool-exec", kind=CanonicalSpanKind.TOOL, can_parent_workflow=True)

    subject.emit(trace(tool), None, publish)

    assert tracer.start_span.called
    node_execution_id, context = publish.call_args.args
    assert node_execution_id == "tool-exec"
    assert context.provider == "phoenix"
    assert context.provider_context == {"traceparent": VALID_TRACEPARENT}
    assert events == ["end", "publish"]


def test_emit_does_not_publish_parent_context_when_export_fails(adapter: PhoenixAdapterFixture) -> None:
    subject, _, _ = adapter
    cast(MagicMock, subject._exporter.export).return_value = SpanExportResult.FAILURE
    publish = MagicMock()
    tool = span(id="tool-exec", kind=CanonicalSpanKind.TOOL, can_parent_workflow=True)

    with pytest.raises(RetryableTraceDispatchError, match="Phoenix span export failed"):
        subject.emit(trace(tool), None, publish)

    publish.assert_not_called()


def test_emit_maps_exporter_exception_to_retryable_failure(adapter: PhoenixAdapterFixture) -> None:
    subject, _, _ = adapter
    cast(MagicMock, subject._exporter.export).side_effect = ConnectionError("network unavailable")
    publish = MagicMock()

    with pytest.raises(RetryableTraceDispatchError, match="Phoenix span export failed"):
        subject.emit(trace(), None, publish)

    publish.assert_not_called()


def test_emit_publishes_message_context(adapter: PhoenixAdapterFixture) -> None:
    subject, _, _ = adapter
    cast(MagicMock, subject._propagator.inject).side_effect = _inject_traceparent
    publish = MagicMock()
    message = span(id="message-1", name="message", publishes_parent_context=True)

    subject.emit(trace(message), None, publish)

    parent_id, context = publish.call_args.args
    assert parent_id == "message-1"
    assert context.provider_context == {"traceparent": VALID_TRACEPARENT}


def test_emit_records_error_status(adapter: PhoenixAdapterFixture) -> None:
    subject, _, otel_spans = adapter
    failed = span(status=CanonicalSpanStatus.ERROR, error="boom")

    subject.emit(trace(failed), None, MagicMock())

    status = otel_spans[0].set_status.call_args.args[0]
    assert status.status_code is StatusCode.ERROR
    otel_spans[0].record_exception.assert_called_once()


def test_retry_metadata_is_serialized_for_phoenix(adapter: PhoenixAdapterFixture) -> None:
    subject, tracer, _ = adapter
    retry_metadata = {
        "retry_count": 1,
        "retry_attempts": [
            {
                "retry_index": 1,
                "error": "HTTP 500",
                "elapsed_time": 1.2,
                "created_at": 1_700_000_000,
                "finished_at": 1_700_000_001,
            }
        ],
    }

    subject.emit(trace(span(metadata=retry_metadata)), None, MagicMock())

    attributes = tracer.start_span.call_args.kwargs["attributes"]
    assert json.loads(attributes[SpanAttributes.METADATA]) == {
        **retry_metadata,
        "dify.span.kind": "chain",
    }


def test_scope_does_not_include_api_key(adapter: PhoenixAdapterFixture) -> None:
    subject, _, _ = adapter

    assert subject.scope == destination_scope("phoenix", "https://phoenix.example", "project-a")
    assert "secret" not in subject.scope
