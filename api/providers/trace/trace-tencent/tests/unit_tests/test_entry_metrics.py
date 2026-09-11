"""Delivery roots retain Tencent's entry flags and operation duration series."""

from datetime import UTC, datetime, timedelta
from unittest.mock import Mock
from uuid import uuid4

import pytest
from dify_trace_tencent.tencent_trace import create_trace_client
from opentelemetry.proto.collector.metrics.v1.metrics_service_pb2 import ExportMetricsServiceRequest
from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import ExportTraceServiceRequest
from opentelemetry.proto.metrics.v1.metrics_pb2 import AggregationTemporality

from core.ops.message_trace import MessageTraceRecorder
from core.ops.trace_data import CompletedTrace, ExportedParentSpans, TraceProviderSettings, TraceSource
from graphon.engine_events import GraphRunSucceededEvent, NodeRunSucceededEvent
from tests.unit_tests.core.ops.test_message_trace import RecordingQueue, message_fields
from tests.unit_tests.core.ops.test_trace_export_state import make_export_state
from tests.unit_tests.core.ops.test_workflow_trace_limits import workflow_node

from .test_export_contract import make_provider_config  # pyrefly: ignore[missing-import]


@pytest.mark.parametrize(
    ("operation", "span_type"),
    [("search", "tool"), ("dataset_retrieval", "retrieval"), ("suggested_question", "llm"), ("generate_name", "llm")],
)
def test_late_operations_do_not_add_message_duration_samples(
    operation: str, span_type: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    source = TraceSource(tenant_id=str(uuid4()), app_id=str(uuid4()), operation_id=str(uuid4()), actor_id="user")
    settings = TraceProviderSettings(
        tenant_id=source.tenant_id, app_id=source.app_id, provider_name="tencent", config_id=str(uuid4())
    )
    queue = RecordingQueue()
    recorder = MessageTraceRecorder(source, queue, (settings,))
    recorder.bind_message(str(uuid4()), str(uuid4()))
    started = datetime(2026, 9, 12, tzinfo=UTC)
    recorder.finish_message_trace(
        {**message_fields(recorder), "started_at": started, "ended_at": started + timedelta(seconds=5)}
    )
    recorder.record_operation(
        operation,
        span_type=span_type,
        inputs="query",
        outputs="answer",
        timer={"start": started + timedelta(seconds=5), "end": started + timedelta(seconds=7)},
    )
    message, late = [CompletedTrace.model_validate_json(delivery.trace_json) for delivery in queue.items]
    assert late.parent is not None
    assert late.parent.export_id == queue.items[0].export_id
    state = make_export_state(message, settings)
    send = Mock(return_value=b"")
    receipt = None
    for trace in (message, late):
        client = create_trace_client(make_provider_config())
        client.export_state = state if trace is message else make_export_state(trace, settings, state.repository)
        monkeypatch.setattr(client, "_send", send)
        original_trace_json = trace.model_dump_json()
        exported = client.export_trace(trace, receipt)
        assert trace.model_dump_json() == original_trace_json
        receipt = exported.spans[trace.root_span_id]

    traces = [
        ExportTraceServiceRequest.FromString(call.args[1]) for call in send.call_args_list if call.args[0] == "trace"
    ]
    message_span, late_span = [request.resource_spans[0].scope_spans[0].spans[0] for request in traces]
    assert late_span.parent_span_id == message_span.span_id
    assert late_span.trace_id == message_span.trace_id
    assert {item.key: item.value.string_value for item in message_span.attributes}["gen_ai.is_entry"] == "true"
    assert {item.key: item.value.string_value for item in late_span.attributes}["gen_ai.is_entry"] == "false"
    metrics = [
        ExportMetricsServiceRequest.FromString(call.args[1])
        for call in send.call_args_list
        if call.args[0] == "metrics"
    ]
    assert len(metrics) == 1
    duration = next(
        metric.histogram
        for metric in metrics[0].resource_metrics[0].scope_metrics[0].metrics
        if metric.name == "gen_ai.trace.duration"
    )
    assert duration.aggregation_temporality == AggregationTemporality.AGGREGATION_TEMPORALITY_CUMULATIVE
    assert (duration.data_points[0].count, duration.data_points[0].sum) == (1, 5)


@pytest.mark.parametrize("has_message", [False, True])
def test_workflow_duration_survives_message_parent_and_independent_child_destination(
    has_message: bool, monkeypatch: pytest.MonkeyPatch
) -> None:
    started = datetime(2026, 9, 12, tzinfo=UTC)
    clock = Mock(wraps=datetime)
    clock.now.return_value = started
    monkeypatch.setattr("core.ops.workflow_trace.datetime", clock)
    source = TraceSource(tenant_id=str(uuid4()), app_id=str(uuid4()), operation_id=str(uuid4()), actor_id="user")
    settings = TraceProviderSettings(
        tenant_id=source.tenant_id, app_id=source.app_id, provider_name="tencent", config_id=str(uuid4())
    )
    child_app_id = str(uuid4())
    child_settings = settings.model_copy(update={"app_id": child_app_id, "config_id": str(uuid4())})
    queue = RecordingQueue()
    recorder = MessageTraceRecorder(source, queue, (settings,), load_provider_settings=lambda *_: (child_settings,))
    if has_message:
        recorder.bind_message(str(uuid4()), str(uuid4()))
    workflow = recorder.create_workflow_trace(
        workflow_id="workflow", workflow_version="1", workflow_run_id=str(uuid4()), inputs={}
    )
    if has_message:
        recorder.finish_message_trace(
            {**message_fields(recorder), "started_at": started, "ended_at": started + timedelta(seconds=5)}
        )
    node = workflow_node(source, node_type="tool")
    with workflow.node_run_context(node):
        workflow.register_workflow_source(
            tenant_id=source.tenant_id,
            app_id=child_app_id,
            workflow_id=str(uuid4()),
            workflow_version="1",
            invocation_id=str(uuid4()),
            parent_execution_id=node.execution_id,
        )
        workflow.on_event(
            NodeRunSucceededEvent(
                id=node.execution_id,
                node_id=node.id,
                node_type="tool",
                start_at=started,
                finished_at=started + timedelta(seconds=2),
            )
        )
    clock.now.return_value = started + timedelta(seconds=3)
    workflow.on_event(GraphRunSucceededEvent())
    assert workflow.finish_workflow_trace()
    assert len(queue.items) == (3 if has_message else 2)
    assert {delivery.provider_settings.app_id for delivery in queue.items} == {source.app_id, child_app_id}
    receipts: dict[str, ExportedParentSpans] = {}
    for delivery in queue.items:
        trace = CompletedTrace.model_validate_json(delivery.trace_json)
        root = trace.spans[0]
        client = create_trace_client(make_provider_config())
        client.export_state = make_export_state(trace, delivery.provider_settings)
        send = Mock(return_value=b"")
        monkeypatch.setattr(client, "_send", send)
        parent = receipts[trace.parent.export_id].spans[trace.parent.span_id] if trace.parent else None
        original_trace_json = trace.model_dump_json()
        receipts[delivery.export_id] = client.export_trace(trace, parent)
        assert trace.model_dump_json() == original_trace_json
        requests = {call.args[0]: call.args[1] for call in send.call_args_list}
        spans = ExportTraceServiceRequest.FromString(requests["trace"]).resource_spans[0].scope_spans[0].spans
        metrics = (
            ExportMetricsServiceRequest.FromString(requests["metrics"]).resource_metrics[0].scope_metrics[0].metrics
        )
        duration = next(metric.histogram for metric in metrics if metric.name == "gen_ai.trace.duration")
        assert duration.aggregation_temporality == AggregationTemporality.AGGREGATION_TEMPORALITY_CUMULATIVE
        assert duration.data_points[0].count == 1
        expected_seconds = (
            5 if root.attributes.get("operation_type") == "message" else 2 if trace.source.app_id == child_app_id else 3
        )
        assert duration.data_points[0].sum == expected_seconds
        entry = {item.key: item.value.string_value for item in spans[0].attributes}["gen_ai.is_entry"]
        if root.span_type == "workflow" and trace.source.app_id == source.app_id and has_message:
            assert trace.parent is not None
            assert spans[0].parent_span_id
            assert entry == "false"
        else:
            assert trace.parent is None
            assert not spans[0].parent_span_id
            assert entry == "true"
        if root.span_type == "workflow":
            labels = {item.key: item.value.string_value for item in duration.data_points[0].attributes}
            assert labels == {
                "conversation_mode": "workflow",
                "workflow_status": "succeeded",
                "has_conversation": "true" if trace.source.conversation_id else "false",
            }
            assert all(
                {item.key: item.value.string_value for item in span.attributes}["gen_ai.is_entry"] == "false"
                for span in spans[1:]
            )
