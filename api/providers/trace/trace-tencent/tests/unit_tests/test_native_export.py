"""Tencent keeps its existing metric units and dimensions across trace capture changes."""

from datetime import UTC, datetime, timedelta
from unittest.mock import Mock
from uuid import uuid4

import pytest
from dify_trace_tencent.tencent_trace import create_trace_client
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.metrics.export import Histogram as SdkHistogram
from opentelemetry.sdk.metrics.export import InMemoryMetricReader

from core.ops.basic_chat_trace import record_basic_chat_result
from core.ops.message_trace import MessageTraceRecorder
from core.ops.trace_data import CompletedTrace, TraceProviderSettings, TraceSource
from tests.unit_tests.core.ops.test_provider_export import make_completed_trace, provider_config


def test_histogram_distributions_match_the_previous_sdk_instruments() -> None:
    trace = make_completed_trace()
    model = trace.spans[-1].model_copy(
        update={
            "usage": {
                "prompt_tokens": 5,
                "completion_tokens": 10001,
                "latency": 10,
                "time_to_first_token": 0.25,
                "time_to_generate": 25,
            }
        }
    )
    trace = trace.model_copy(update={"spans": (*trace.spans[:-1], model)})
    metrics = create_trace_client(provider_config("tencent")).build_metrics(trace)
    reader = InMemoryMetricReader()
    provider = MeterProvider(metric_readers=[reader])
    try:
        meter = provider.get_meter("previous-tencent-exporter")
        for index, metric in enumerate(metrics):
            meter.create_histogram(f"comparison.{index}", unit=metric.unit).record(metric.histogram.data_points[0].sum)
        data = reader.get_metrics_data()
        assert data is not None
        previous_metrics = data.resource_metrics[0].scope_metrics[0].metrics
        assert len(metrics) == len(previous_metrics) == 6
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


def test_workflow_metrics_use_model_usage_timings_and_legacy_dimensions() -> None:
    trace = make_completed_trace()
    model = trace.spans[-1].model_copy(
        update={
            "attributes": {"model_name": "model", "model_provider": "provider", "model_mode": "completion"},
            "usage": {
                "prompt_tokens": 3,
                "completion_tokens": 5,
                "latency": 1.25,
                "time_to_first_token": 0.25,
                "time_to_generate": 1.0,
            },
        }
    )
    trace = trace.model_copy(update={"spans": (*trace.spans[:-1], model)})
    client = create_trace_client(provider_config("tencent"))
    metrics = client.build_metrics(trace)
    duration = next(metric for metric in metrics if metric.name == "gen_ai.client.operation.duration")
    assert duration.histogram.data_points[0].sum == 1.25
    assert {item.key: item.value.string_value for item in duration.histogram.data_points[0].attributes} == {
        "gen_ai.operation.name": "completion",
        "gen_ai.system": "provider",
        "gen_ai.response.model": "model",
        "stream": "true",
    }
    tokens = [metric for metric in metrics if metric.name == "gen_ai.client.token.usage"]
    assert [metric.histogram.data_points[0].sum for metric in tokens] == [3, 5]
    assert {item.key: item.value.string_value for item in tokens[0].histogram.data_points[0].attributes} == {
        "gen_ai.operation.name": "completion",
        "gen_ai.system": "provider",
        "gen_ai.request.model": "model",
        "gen_ai.response.model": "model",
        "gen_ai.token.type": "input",
        "server.address": "provider",
    }
    timings = {
        metric.name: metric.histogram.data_points[0]
        for metric in metrics
        if metric.name in {"gen_ai.server.time_to_first_token", "gen_ai.streaming.time_to_generate"}
    }
    assert timings["gen_ai.server.time_to_first_token"].sum == 0.25
    assert timings["gen_ai.streaming.time_to_generate"].sum == 1
    assert all(
        next(item.value.string_value for item in point.attributes if item.key == "stream") == "true"
        for point in timings.values()
    )
    attributes = {item.key: item.value for item in client.build_span(trace, model).attributes}
    assert attributes["gen_ai.span.kind"].string_value == "GENERATION"
    assert attributes["gen_ai.usage.input_tokens"].int_value == 3
    assert attributes["gen_ai.server.time_to_first_token"].double_value == 0.25


def test_basic_chat_streaming_metrics_count_the_captured_message_once() -> None:
    source = TraceSource(
        tenant_id=str(uuid4()),
        app_id=str(uuid4()),
        operation_id=str(uuid4()),
        message_id=str(uuid4()),
        conversation_id=str(uuid4()),
    )
    settings = TraceProviderSettings(
        tenant_id=source.tenant_id, app_id=source.app_id, provider_name="tencent", config_id=str(uuid4())
    )
    queue = Mock()
    queue.submit_trace.return_value = True
    recorder = MessageTraceRecorder(source, queue, (settings,))
    started = datetime(2026, 9, 11, tzinfo=UTC)
    record_basic_chat_result(
        recorder,
        {
            "message_id": source.message_id,
            "conversation_id": source.conversation_id,
            "inputs": [{"role": "user", "text": "hello"}],
            "outputs": "answer",
            "model_name": "model",
            "model_provider": "provider",
            "prompt_tokens": 3,
            "completion_tokens": 5,
            "started_at": started,
            "ended_at": started + timedelta(seconds=5),
            "metadata": {"usage": {"latency": 2, "time_to_first_token": 0.5, "time_to_generate": 1.5}},
        },
    )
    trace = CompletedTrace.model_validate_json(queue.submit_trace.call_args.args[0].trace_json)
    assert len(trace.spans) == 2
    metrics = create_trace_client(provider_config("tencent")).build_metrics(trace)
    assert {
        metric.name: metric.histogram.data_points[0].sum
        for metric in metrics
        if metric.name != "gen_ai.client.token.usage"
    } == {
        "gen_ai.trace.duration": 5,
        "gen_ai.client.operation.duration": 2,
        "gen_ai.server.time_to_first_token": 0.5,
        "gen_ai.streaming.time_to_generate": 1.5,
    }
    assert len([metric for metric in metrics if metric.name == "gen_ai.client.token.usage"]) == 2


@pytest.mark.parametrize("latency", [None, "unknown", -1, True])
def test_missing_provider_latency_does_not_become_span_wall_time(latency: object) -> None:
    trace = make_completed_trace()
    model = trace.spans[-1].model_copy(update={"usage": {"latency": latency, "completion_tokens": 3}})
    trace = trace.model_copy(update={"spans": (*trace.spans[:-1], model)})
    metrics = create_trace_client(provider_config("tencent")).build_metrics(trace)
    assert {metric.name for metric in metrics} == {"gen_ai.trace.duration", "gen_ai.client.token.usage"}


def test_unknown_span_times_keep_measured_usage_and_streaming_values() -> None:
    trace = make_completed_trace()
    model = trace.spans[-1].model_copy(
        update={
            "started_at": None,
            "ended_at": None,
            "usage": {
                "prompt_tokens": "unknown",
                "completion_tokens": 3,
                "time_to_first_token": 0.25,
                "time_to_generate": 0.5,
            },
        }
    )
    trace = trace.model_copy(update={"spans": (*trace.spans[:-1], model)})
    metrics = create_trace_client(provider_config("tencent")).build_metrics(trace)
    assert [metric.histogram.data_points[0].sum for metric in metrics] == [2, 3, 0.25, 0.5]
