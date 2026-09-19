"""Protocol fixtures for complete trees, fixed destinations and synchronous acceptance."""

import logging
from collections.abc import Sequence
from datetime import UTC, datetime, timedelta
from typing import Unpack
from unittest.mock import Mock
from uuid import uuid4

import httpx
import pytest
from opentelemetry.proto.collector.metrics.v1.metrics_service_pb2 import (
    ExportMetricsServiceRequest,
)
from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import (
    ExportTraceServiceRequest,
)
from opentelemetry.proto.metrics.v1.metrics_pb2 import HistogramDataPoint
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.metrics.export import Histogram as SdkHistogram
from opentelemetry.sdk.metrics.export import InMemoryMetricReader

from core.ops.provider_export import (
    create_provider_client,
    export_trace,
)
from core.ops.trace_data import (
    CompletedTrace,
    QueuedTrace,
    TraceProviderSettings,
    TraceSource,
    make_span_id,
)
from core.ops.workflow_trace import WorkflowTraceRecorder
from enterprise.telemetry.enterprise_trace import EnterpriseTraceClient
from graphon.engine_events import GraphRunSucceededEvent, NodeRunSucceededEvent
from graphon.model_runtime.entities.llm_entities import LLMUsage
from graphon.node_events import NodeRunResult
from tests.unit_tests.core.ops.test_provider_export import RequestArguments, make_completed_trace
from tests.unit_tests.core.ops.test_trace_export_state import make_export_state
from tests.unit_tests.core.ops.test_workflow_trace_limits import workflow_node


@pytest.mark.parametrize(
    "operation_type", ["workflow", "node_execution", "draft_node_execution", "message", "tool", "app_prompt"]
)
def test_histogram_distributions_match_the_previous_sdk_instruments(operation_type: str) -> None:
    trace = make_completed_trace()
    original = trace.spans[0]
    assert original.started_at is not None
    span = original.model_copy(
        update={"ended_at": original.started_at + timedelta(seconds=5), "usage": {"time_to_first_token": 10001}}
    )
    client = EnterpriseTraceClient({"endpoint": "https://collector.example"})
    metrics = [metric for metric in client._metrics(trace, span, operation_type) if metric.HasField("histogram")]
    reader = InMemoryMetricReader()
    provider = MeterProvider(metric_readers=[reader])
    try:
        meter = provider.get_meter("previous-enterprise-exporter")
        for metric in metrics:
            meter.create_histogram(metric.name, unit=metric.unit).record(metric.histogram.data_points[0].sum)
        data = reader.get_metrics_data()
        assert data is not None
        previous_metrics = data.resource_metrics[0].scope_metrics[0].metrics
        assert len(metrics) == len(previous_metrics) == (2 if operation_type == "message" else 1)
        for metric, previous_metric in zip(metrics, previous_metrics, strict=True):
            assert isinstance(previous_metric.data, SdkHistogram)
            expected = previous_metric.data.data_points[0]
            point = metric.histogram.data_points[0]
            assert tuple(point.explicit_bounds) == expected.explicit_bounds
            assert tuple(point.bucket_counts) == expected.bucket_counts
            assert len(point.explicit_bounds) == 15
            assert len(point.bucket_counts) == 16
            assert point.count == expected.count
            assert point.sum == expected.sum
    finally:
        provider.shutdown()


def test_enterprise_metrics_keep_root_and_model_usage_distinct(monkeypatch: pytest.MonkeyPatch) -> None:
    requests: list[tuple[str, bytes]] = []

    def request(_method: str, url: str, **kwargs: Unpack[RequestArguments]) -> httpx.Response:
        requests.append((url, kwargs["content"]))
        return httpx.Response(200, content=b"")

    monkeypatch.setattr("core.ops.provider_export.ssrf_proxy.make_request", request)
    trace = make_completed_trace()
    attempt = trace.spans[-1].model_copy(
        update={
            "span_id": make_span_id(trace.source.tenant_id, trace.source.operation_id, "attempt"),
            "parent_span_id": trace.spans[-1].span_id,
            "attributes": {**trace.spans[-1].attributes, "metrics_from_parent": True},
        }
    )
    trace = trace.model_copy(update={"spans": (*trace.spans, attempt)})
    client = create_provider_client(
        "enterprise",
        {
            "endpoint": "https://enterprise.example",
            "protocol": "http/protobuf",
            "include_content": False,
            "sampling_rate": 1,
        },
    )
    client.export_state = make_export_state(
        trace,
        TraceProviderSettings(
            tenant_id=trace.source.tenant_id,
            app_id=trace.source.app_id,
            destination_type="enterprise",
            provider_name="enterprise",
        ),
    )
    log = Mock()
    monkeypatch.setattr(client.logger, "info", log)
    client.export_trace(trace)
    assert [call.kwargs["extra"]["attributes"]["dify.event.name"] for call in log.call_args_list] == [
        "dify.workflow.run",
        "dify.tool.execution",
        "dify.node.execution",
        "dify.node.execution",
    ]
    metrics = ExportMetricsServiceRequest.FromString(requests[-1][1]).resource_metrics[0].scope_metrics[0].metrics
    totals = [point for metric in metrics if metric.name == "dify.tokens.total" for point in metric.sum.data_points]
    assert len(totals) == 2
    assert {
        next(attribute.value.string_value for attribute in point.attributes if attribute.key == "operation_type")
        for point in totals
    } == {"workflow", "node_execution"}
    assert all(point.as_int == 8 for point in totals)
    spans = ExportTraceServiceRequest.FromString(requests[0][1]).resource_spans[0].scope_spans[0].spans
    assert len(spans) == 4
    assert spans[-1].parent_span_id == spans[-2].span_id
    for span in spans:
        inputs = next(attribute.value.string_value for attribute in span.attributes if attribute.key == "input.value")
        assert inputs.startswith("ref:")


def test_enterprise_resources_and_counter_units_keep_the_existing_instrument_contract(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("enterprise.telemetry.enterprise_trace.socket.gethostname", lambda: "ops-worker")
    client = EnterpriseTraceClient({"endpoint": "https://collector.example", "service_name": "dify"})
    assert {field.key: field.value.string_value for field in client.otlp.resource.attributes} == {
        "service.name": "dify",
        "host.name": "ops-worker",
    }
    trace = make_completed_trace()
    root = trace.spans[0].model_copy(
        update={"status": "error", "usage": {"prompt_tokens": 5, "completion_tokens": 3, "total_tokens": 8}}
    )
    retrieval = root.model_copy(update={"outputs": {"documents": [{"metadata": {"dataset_id": "dataset"}}]}})
    metrics = client._metrics(trace, root, "workflow") + client._metrics(trace, retrieval, "dataset_retrieval")
    assert {metric.name: metric.unit for metric in metrics if metric.HasField("sum")} == {
        "dify.tokens.input": "{token}",
        "dify.tokens.output": "{token}",
        "dify.tokens.total": "{token}",
        "dify.requests.total": "{request}",
        "dify.errors.total": "{error}",
        "dify.dataset.retrievals.total": "{retrieval}",
    }


@pytest.mark.parametrize("same_app", [False, True])
@pytest.mark.parametrize("sampling_rate", [0, 1])
def test_child_workflow_views_preserve_spans_without_recounting_execution_metrics(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture, same_app: bool, sampling_rate: int
) -> None:
    source = TraceSource(tenant_id=str(uuid4()), app_id=str(uuid4()), operation_id=str(uuid4()), actor_id=str(uuid4()))
    child_source = source.model_copy(update={"app_id": source.app_id if same_app else str(uuid4())})
    parent_settings = TraceProviderSettings(
        tenant_id=source.tenant_id, app_id=source.app_id, provider_name="enterprise", destination_type="enterprise"
    )
    child_settings = parent_settings.model_copy(update={"app_id": child_source.app_id})
    queued_traces: list[QueuedTrace] = []

    def submit_trace(trace: CompletedTrace, settings: Sequence[TraceProviderSettings] = (parent_settings,)) -> bool:
        queued_traces.extend(QueuedTrace.from_trace(trace, destination) for destination in settings)
        return True

    recorder = WorkflowTraceRecorder(
        source=source,
        workflow_id="workflow",
        workflow_version="1",
        inputs={},
        submit_completed_trace=submit_trace,
        provider_settings=(parent_settings,),
        load_provider_settings=lambda _tenant_id, _app_id: (child_settings,),
    )
    tool = workflow_node(source, node_type="tool")
    with recorder.node_run_context(tool):
        pass
    invocation_id = str(uuid4())
    assert child_source.app_id is not None
    recorder.register_workflow_source(
        tenant_id=source.tenant_id,
        app_id=child_source.app_id,
        workflow_id="child-workflow",
        workflow_version="1",
        invocation_id=invocation_id,
        parent_execution_id=tool.execution_id,
    )
    model_node = workflow_node(child_source, node_type="llm", workflow_id="child-workflow", invocation_id=invocation_id)
    started_at = datetime.now(UTC)
    usage = LLMUsage.empty_usage().model_copy(update={"prompt_tokens": 3, "completion_tokens": 5, "total_tokens": 8})
    with recorder.node_run_context(model_node, parent_execution_id=tool.execution_id):
        recorder.record_workflow_event(
            NodeRunSucceededEvent(
                id=model_node.execution_id,
                node_id=model_node.id,
                node_type="llm",
                start_at=started_at,
                finished_at=started_at + timedelta(seconds=2),
                node_run_result=NodeRunResult(llm_usage=usage),
            )
        )
    recorder.record_workflow_event(
        NodeRunSucceededEvent(
            id=tool.execution_id,
            node_id=tool.id,
            node_type="tool",
            start_at=started_at,
            finished_at=started_at + timedelta(seconds=2),
            node_run_result=NodeRunResult(llm_usage=usage),
        )
    )
    recorder.record_workflow_event(GraphRunSucceededEvent())
    recorder.finish_workflow_trace()
    assert len(queued_traces) == 2
    requests: list[tuple[str, bytes]] = []

    def request(_method: str, url: str, **kwargs: Unpack[RequestArguments]) -> httpx.Response:
        requests.append((url, kwargs["content"]))
        return httpx.Response(200, content=b"")

    monkeypatch.setattr("core.ops.provider_export.ssrf_proxy.make_request", request)
    with caplog.at_level(logging.INFO, logger="dify.telemetry"):
        for queued_trace in queued_traces:
            trace = CompletedTrace.model_validate_json(queued_trace.trace_json)
            receipt = export_trace(
                trace,
                queued_trace.provider_settings,
                {"endpoint": "https://enterprise.example", "protocol": "http/protobuf", "sampling_rate": sampling_rate},
                export_state=make_export_state(trace, queued_trace.provider_settings),
            )
            assert set(receipt.spans) == {span.span_id for span in trace.spans}
    trace_requests = [body for url, body in requests if url.endswith("/traces")]
    assert len(trace_requests) == 2 * sampling_rate
    assert (
        sum(
            len(ExportTraceServiceRequest.FromString(body).resource_spans[0].scope_spans[0].spans)
            for body in trace_requests
        )
        == 5 * sampling_rate
    )
    assert len([record for record in caplog.records if record.name == "dify.telemetry"]) == 5
    metric_requests = [body for url, body in requests if url.endswith("/metrics")]
    assert len(metric_requests) == 1
    metrics = ExportMetricsServiceRequest.FromString(metric_requests[0]).resource_metrics[0].scope_metrics[0].metrics
    measurements = []
    for metric in metrics:
        is_histogram = metric.HasField("histogram")
        points = metric.histogram.data_points if is_histogram else metric.sum.data_points
        for point in points:
            labels = {attribute.key: attribute.value.string_value for attribute in point.attributes}
            if labels.get("node_type") == "llm":
                assert labels["tenant_id"] == source.tenant_id
                assert labels["app_id"] == child_source.app_id
                if isinstance(point, HistogramDataPoint):
                    assert point.count == 1
                    measurements.append((metric.name, point.sum))
                else:
                    measurements.append((metric.name, point.as_int))
    assert sorted(measurements) == [
        ("dify.node.duration", 2),
        ("dify.requests.total", 1),
        ("dify.tokens.input", 3),
        ("dify.tokens.output", 5),
        ("dify.tokens.total", 8),
    ]
