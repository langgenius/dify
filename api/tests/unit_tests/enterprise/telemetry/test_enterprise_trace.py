"""Enterprise exports consume captured spans without record lookups or shared SDK state."""

from datetime import UTC, datetime, timedelta
from uuid import uuid4

from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import ExportTraceServiceRequest

from core.ops.trace_data import CompletedTrace, TraceSource, TraceSpan
from enterprise.telemetry.enterprise_trace import EnterpriseTraceClient


def test_sampling_does_not_sample_metrics_or_include_hidden_content(monkeypatch, caplog):
    from logging import INFO

    source = TraceSource(tenant_id=str(uuid4()), operation_id=str(uuid4()), app_id=str(uuid4()))
    started_at = datetime(2026, 9, 9, tzinfo=UTC)
    span = TraceSpan(
        span_id=str(uuid4()),
        span_name="message",
        span_type="operation",
        started_at=started_at,
        ended_at=started_at + timedelta(seconds=2),
        inputs="private prompt",
        outputs="private completion",
        usage={"total_tokens": 5},
        attributes={"operation_type": "message", "prompts": "private prompt", "gen_ai.prompt": "private prompt"},
    )
    trace = CompletedTrace(source=source, trace_id=str(uuid4()), root_span_id=span.span_id, spans=(span,))
    client = EnterpriseTraceClient(
        {
            "endpoint": "https://collector.example",
            "protocol": "http/protobuf",
            "include_content": False,
            "sampling_rate": 0,
        }
    )
    sent_metrics = []
    monkeypatch.setattr(client.otlp, "send_metrics", sent_metrics.extend)

    def unexpected_trace(_trace_request):
        raise AssertionError("Message operations and sampled-out workflows do not export spans")

    monkeypatch.setattr(client.otlp, "send_traces", unexpected_trace)
    with caplog.at_level(INFO, logger="dify.telemetry"):
        client.export_trace(trace)
    assert {metric.name for metric in sent_metrics} == {
        "dify.tokens.total",
        "dify.requests.total",
        "dify.message.duration",
    }
    log_attributes = caplog.records[-1].attributes
    assert "private prompt" not in str(log_attributes)
    assert "private completion" not in str(log_attributes)
    assert log_attributes["dify.event.name"] == "dify.message.run"
    assert log_attributes["dify.tenant_id"] == source.tenant_id


def test_nested_workflow_spans_preserve_immediate_parents_and_explicit_tenant(monkeypatch):
    source = TraceSource(tenant_id=str(uuid4()), operation_id=str(uuid4()), app_id=str(uuid4()))
    root_id, child_id, leaf_id = (str(uuid4()) for _ in range(3))
    started_at = datetime(2026, 9, 9, tzinfo=UTC)
    spans = tuple(
        TraceSpan(
            span_id=span_id,
            parent_span_id=parent_id,
            span_name=span_name,
            span_type=span_type,
            node_execution_id=str(uuid4()) if parent_id else None,
            started_at=started_at,
            ended_at=started_at + timedelta(seconds=1),
        )
        for span_id, parent_id, span_name, span_type in (
            (root_id, None, "Workflow", "workflow"),
            (child_id, root_id, "Container", "tool"),
            (leaf_id, child_id, "Model", "llm"),
        )
    )
    trace = CompletedTrace(source=source, trace_id=str(uuid4()), root_span_id=root_id, spans=spans)
    client = EnterpriseTraceClient(
        {"endpoint": "https://collector.example", "protocol": "http/protobuf", "sampling_rate": 1}
    )
    requests: list[ExportTraceServiceRequest] = []
    monkeypatch.setattr(client.otlp, "send_traces", requests.append)
    monkeypatch.setattr(client.otlp, "send_metrics", lambda _metrics: None)
    client.export_trace(trace)
    exported = requests[0].resource_spans[0].scope_spans[0].spans
    assert len(exported) == 3
    assert exported[2].parent_span_id == exported[1].span_id
    for span in exported:
        assert (
            next(attr.value.string_value for attr in span.attributes if attr.key == "dify.tenant_id")
            == source.tenant_id
        )
