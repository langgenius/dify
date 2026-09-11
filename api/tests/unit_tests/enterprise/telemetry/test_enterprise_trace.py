"""Enterprise exports consume captured spans without record lookups or shared SDK state."""

import json
import logging
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from typing import Unpack
from unittest.mock import Mock
from uuid import uuid4

import httpx
import pytest
from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import ExportTraceServiceRequest
from opentelemetry.proto.metrics.v1.metrics_pb2 import Metric

from core.moderation.base import ModerationAction, ModerationInputsResult
from core.ops.message_trace import MessageTraceRecorder
from core.ops.provider_export import TraceExportError, export_trace
from core.ops.trace_data import CompletedTrace, TraceProviderSettings, TraceSource, TraceSpan
from core.ops.trace_export_state import TraceExportState
from core.telemetry.events import DraftNodeExecutionTraceEvent, TelemetryContext
from enterprise.telemetry.enterprise_trace import EnterpriseTraceClient
from enterprise.telemetry.operation_trace import record_enterprise_operation
from models.workflow import WorkflowType
from tests.unit_tests.core.ops.test_message_trace import RecordingQueue
from tests.unit_tests.core.ops.test_provider_export import RequestArguments, make_completed_trace
from tests.unit_tests.core.ops.test_trace_export_state import make_export_state


@pytest.mark.parametrize("include_content", [False, True])
@pytest.mark.parametrize("pipeline_run", [False, True])
def test_draft_node_identity_and_content_survive_capture(
    monkeypatch: pytest.MonkeyPatch, include_content: bool, pipeline_run: bool
) -> None:
    tenant_id, owner_id, workflow_id, execution_id = (str(uuid4()) for _ in range(4))
    source = TraceSource(
        tenant_id=tenant_id,
        operation_id=str(uuid4()),
        app_id=None if pipeline_run else owner_id,
        pipeline_id=owner_id if pipeline_run else None,
    )
    queue = RecordingQueue()
    settings = TraceProviderSettings(tenant_id=tenant_id, destination_type="enterprise", provider_name="enterprise")
    recorder = MessageTraceRecorder(source, queue, (settings,))
    session = Mock()
    session.scalar.side_effect = [
        SimpleNamespace(type=WorkflowType.RAG_PIPELINE if pipeline_run else WorkflowType.WORKFLOW),
        owner_id,
    ]
    session_context = Mock()
    session_context.__enter__ = Mock(return_value=session)
    session_context.__exit__ = Mock(return_value=False)
    monkeypatch.setattr("enterprise.telemetry.operation_trace.Session", Mock(return_value=session_context))
    monkeypatch.setattr("extensions.ext_database.db", SimpleNamespace(engine=Mock()))
    create_recorder = Mock(return_value=recorder)
    monkeypatch.setattr("enterprise.telemetry.operation_trace.create_message_trace", create_recorder)
    process_data = {"prompts": [{"role": "user", "text": "private prompt"}]}
    structure = {
        "index": 0,
        "predecessor_node_id": "previous-node",
        "iteration_id": "iteration",
        "iteration_index": 0,
        "loop_id": "loop",
        "loop_index": 0,
        "parallel_id": "parallel",
    }
    record_enterprise_operation(
        DraftNodeExecutionTraceEvent(
            context=TelemetryContext(tenant_id=tenant_id, app_id=owner_id),
            payload={
                "node_execution_data": {
                    "tenant_id": tenant_id,
                    "app_id": owner_id,
                    "workflow_id": workflow_id,
                    "node_execution_id": execution_id,
                    "node_id": "model-node",
                    "node_type": "llm",
                    "status": "succeeded",
                    "node_inputs": {"query": "private input"},
                    "node_outputs": {"answer": "private output"},
                    "process_data": process_data,
                    **structure,
                }
            },
        )
    )
    assert session.scalar.call_count == 2
    create_recorder.assert_called_once_with(
        tenant_id=tenant_id,
        app_id=None if pipeline_run else owner_id,
        pipeline_id=owner_id if pipeline_run else None,
        user_id=None,
    )
    trace = CompletedTrace.model_validate_json(queue.items[0].trace_json)
    span = trace.spans[0]
    assert span.source_app_id == source.app_id
    assert span.source_pipeline_id == source.pipeline_id
    client = EnterpriseTraceClient({"endpoint": "https://collector.example", "include_content": include_content})
    attributes = client._attributes(trace, span, client._operation_type(span))

    assert attributes["dify.workflow.id"] == workflow_id
    assert attributes["dify.node.execution_id"] == execution_id
    assert attributes["dify.node.id"] == "model-node"
    assert attributes["dify.node.status"] == "succeeded"
    for field, value in structure.items():
        assert attributes[f"dify.node.{field}"] == value
    reference = f"ref:node_execution_id={execution_id}"
    assert attributes["dify.node.process_data"] == (json.dumps(process_data) if include_content else reference)
    assert attributes["dify.node.inputs"] == (json.dumps({"query": "private input"}) if include_content else reference)
    assert attributes["dify.node.outputs"] == (
        json.dumps({"answer": "private output"}) if include_content else reference
    )
    if not include_content:
        assert "private" not in str(attributes)


@pytest.mark.parametrize("include_content", [False, True])
@pytest.mark.parametrize("flagged", [False, True])
def test_moderation_decisions_survive_capture_and_content_policy(include_content: bool, flagged: bool) -> None:
    source = TraceSource(
        tenant_id=str(uuid4()), operation_id=str(uuid4()), app_id=str(uuid4()), message_id=str(uuid4())
    )
    queue = RecordingQueue()
    settings = TraceProviderSettings(
        tenant_id=source.tenant_id, destination_type="enterprise", provider_name="enterprise"
    )
    recorder = MessageTraceRecorder(source, queue, (settings,))
    recorder.record_operation(
        "moderation",
        span_type="tool",
        inputs={"inputs": {"topic": "private topic"}, "query": "original question"},
        outputs=ModerationInputsResult(
            flagged=flagged,
            action=ModerationAction.DIRECT_OUTPUT,
            query="moderated question",
            preset_response="blocked",
        ),
        attributes={"operation_type": "moderation", "moderation_type": "keywords"},
        independent=True,
    )
    trace = CompletedTrace.model_validate_json(queue.items[0].trace_json)
    captured = trace.spans[0]
    client = EnterpriseTraceClient({"endpoint": "https://collector.example", "include_content": include_content})

    attributes = client._attributes(trace, captured, client._operation_type(captured))
    recorder.close()

    assert attributes["dify.moderation.flagged"] is flagged
    assert attributes["dify.moderation.action"] == "direct_output"
    assert attributes["dify.moderation.type"] == "keywords"
    reference = f"ref:message_id={source.message_id}"
    assert attributes["dify.moderation.query"] == ("moderated question" if include_content else reference)
    assert attributes["dify.moderation.preset_response"] == ("blocked" if include_content else reference)
    if not include_content:
        assert "original question" not in str(attributes)
        assert "moderated question" not in str(attributes)
        assert "private topic" not in str(attributes)


def test_sampling_does_not_sample_metrics_or_include_hidden_content(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
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
    sent_metrics: list[Metric] = []
    monkeypatch.setattr(client.otlp, "send_metrics", sent_metrics.extend)

    def unexpected_trace(_trace_request: ExportTraceServiceRequest) -> None:
        raise AssertionError("Message operations and sampled-out workflows do not export spans")

    monkeypatch.setattr(client.otlp, "send_traces", unexpected_trace)
    with caplog.at_level(INFO, logger="dify.telemetry"):
        client.export_trace(trace)
    assert {metric.name for metric in sent_metrics} == {
        "dify.tokens.total",
        "dify.requests.total",
        "dify.message.duration",
    }
    log_attributes = caplog.records[-1].__dict__["attributes"]
    assert "private prompt" not in str(log_attributes)
    assert "private completion" not in str(log_attributes)
    assert log_attributes["dify.event.name"] == "dify.message.run"
    assert log_attributes["dify.tenant_id"] == source.tenant_id


def test_nested_workflow_spans_preserve_immediate_parents_and_explicit_tenant(monkeypatch: pytest.MonkeyPatch) -> None:
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


@pytest.mark.parametrize("failed_signal", ["traces", "metrics"])
@pytest.mark.parametrize("retry_status", [200, 400])
def test_business_logs_survive_transport_failure_without_repeating_on_retry(
    failed_signal: str,
    retry_status: int,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    trace = make_completed_trace()
    settings = TraceProviderSettings(
        tenant_id=trace.source.tenant_id,
        app_id=trace.source.app_id,
        destination_type="enterprise",
        provider_name="enterprise",
    )
    state = make_export_state(trace, settings)
    config = {"endpoint": "https://collector.example", "protocol": "http/protobuf"}
    signal_status = 503

    def request(_method: str, url: str, **_kwargs: Unpack[RequestArguments]) -> httpx.Response:
        return httpx.Response(signal_status if url.endswith(f"/{failed_signal}") else 200, content=b"")

    monkeypatch.setattr("core.ops.provider_export.ssrf_proxy.make_request", request)
    with caplog.at_level(logging.INFO, logger="dify.telemetry"):
        with pytest.raises(TraceExportError, match="provider_http_503"):
            export_trace(trace, settings, config, export_state=state)
        assert len(caplog.records) == len(trace.spans)
        assert state.has_completed_signal("business_logs")
        assert state.repository.finish_attempt(state.delivery, "pending", retry_delay_seconds=0)
        delivery = state.repository.claim_delivery(state.delivery.tenant_id, state.delivery.id)
        assert delivery is not None
        signal_status = retry_status
        retry_state = TraceExportState(state.repository, delivery)
        if retry_status == 200:
            export_trace(trace, settings, config, export_state=retry_state)
        else:
            with pytest.raises(TraceExportError, match="provider_http_400"):
                export_trace(trace, settings, config, export_state=retry_state)
        assert retry_state.has_completed_signal("business_logs")
    assert len(caplog.records) == len(trace.spans)
    assert all(record.__dict__["tenant_id"] == trace.source.tenant_id for record in caplog.records)
