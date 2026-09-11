"""Protocol fixtures for complete trees, fixed destinations and synchronous acceptance."""

from typing import Unpack

import httpx
import pytest
from opentelemetry.proto.collector.metrics.v1.metrics_service_pb2 import (
    ExportMetricsServiceRequest,
)
from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import (
    ExportTraceServiceRequest,
)

from core.ops.provider_export import (
    create_provider_client,
)
from core.ops.trace_data import (
    make_span_id,
)
from tests.unit_tests.core.ops.test_provider_export import RequestArguments, make_completed_trace


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
