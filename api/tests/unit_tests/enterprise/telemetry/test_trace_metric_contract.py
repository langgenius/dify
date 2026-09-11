"""Protocol fixtures for complete trees, fixed destinations and synchronous acceptance."""

from datetime import timedelta
from typing import Unpack

import httpx
import pytest
from opentelemetry.proto.collector.metrics.v1.metrics_service_pb2 import (
    ExportMetricsServiceRequest,
)
from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import (
    ExportTraceServiceRequest,
)
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.metrics.export import Histogram as SdkHistogram
from opentelemetry.sdk.metrics.export import InMemoryMetricReader

from core.ops.provider_export import (
    create_provider_client,
)
from core.ops.trace_data import (
    make_span_id,
)
from enterprise.telemetry.enterprise_trace import EnterpriseTraceClient
from tests.unit_tests.core.ops.test_provider_export import RequestArguments, make_completed_trace


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
    create_provider_client(
        "enterprise",
        {
            "endpoint": "https://enterprise.example",
            "protocol": "http/protobuf",
            "include_content": False,
            "sampling_rate": 1,
        },
    ).export_trace(trace)
    metrics = ExportMetricsServiceRequest.FromString(requests[-1][1]).resource_metrics[0].scope_metrics[0].metrics
    totals = [metric for metric in metrics if metric.name == "dify.tokens.total"]
    assert len(totals) == 2
    assert {
        next(
            attribute.value.string_value
            for attribute in metric.sum.data_points[0].attributes
            if attribute.key == "operation_type"
        )
        for metric in totals
    } == {"workflow", "node_execution"}
    assert all(metric.sum.data_points[0].as_int == 8 for metric in totals)
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
