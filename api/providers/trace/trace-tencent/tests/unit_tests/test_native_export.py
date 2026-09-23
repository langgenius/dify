"""Tencent keeps its existing metric units and dimensions across trace capture changes."""

from datetime import UTC, datetime, timedelta
from unittest.mock import Mock
from uuid import uuid4

import pytest
from dify_trace_tencent.tencent_trace import create_trace_client
from opentelemetry.proto.collector.metrics.v1.metrics_service_pb2 import ExportMetricsServiceRequest
from opentelemetry.proto.metrics.v1.metrics_pb2 import AggregationTemporality
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.metrics.export import Histogram as SdkHistogram
from opentelemetry.sdk.metrics.export import InMemoryMetricReader

from core.ops.basic_chat_trace import record_basic_chat_result
from core.ops.message_trace import MessageTraceRecorder
from core.ops.trace_data import CompletedTrace, TraceProviderSettings, TraceSource
from core.ops.workflow_trace import WorkflowTraceRecorder
from graphon.engine_events import (
    GraphRunSucceededEvent,
    NodeRunFailedEvent,
    NodeRunRetryEvent,
    NodeRunStartedEvent,
    NodeRunSucceededEvent,
)
from graphon.model_runtime.entities.llm_entities import LLMUsage
from graphon.node_events import NodeRunResult
from tests.unit_tests.core.ops.test_provider_export import make_completed_trace
from tests.unit_tests.core.ops.test_trace_export_state import make_export_state
from tests.unit_tests.core.ops.test_workflow_trace_limits import workflow_node

# Pytest importlib mode resolves these hyphenated provider packages.
from .test_export_contract import make_provider_config  # pyrefly: ignore[missing-import]


def test_fresh_clients_preserve_cumulative_histograms_across_operations(monkeypatch: pytest.MonkeyPatch) -> None:
    first_trace, second_trace = make_completed_trace(), make_completed_trace()
    second_trace = second_trace.model_copy(
        update={
            "source": second_trace.source.model_copy(
                update={"tenant_id": first_trace.source.tenant_id, "app_id": first_trace.source.app_id}
            )
        }
    )
    first_trace = first_trace.model_copy(
        update={
            "spans": (
                *first_trace.spans[:-1],
                first_trace.spans[-1].model_copy(update={"usage": {"prompt_tokens": 5}}),
            )
        }
    )
    second_trace = second_trace.model_copy(
        update={
            "spans": (
                *second_trace.spans[:-1],
                second_trace.spans[-1].model_copy(update={"usage": {"prompt_tokens": 10001}}),
            )
        }
    )
    settings = TraceProviderSettings(
        tenant_id=first_trace.source.tenant_id,
        app_id=first_trace.source.app_id,
        provider_name="tencent",
        config_id=str(uuid4()),
    )
    first_state = make_export_state(first_trace, settings)
    exports: list[ExportMetricsServiceRequest] = []

    def receive(signal: str, serialized: bytes, **kwargs: object) -> bytes:
        if signal == "metrics":
            exports.append(ExportMetricsServiceRequest.FromString(serialized))
        return b""

    for trace, state in (
        (first_trace, first_state),
        (second_trace, make_export_state(second_trace, settings, first_state.repository)),
    ):
        client = create_trace_client(
            {
                **make_provider_config(),
                "_runtime_settings": {
                    "metrics_protocol": "grpc",
                    "metrics_verify": True,
                    "trace_tls": {},
                    "metrics_tls": {},
                },
            }
        )
        client.export_state = state
        monkeypatch.setattr(client, "_send_grpc", receive)
        client.export_trace(trace)

    histograms = [
        next(
            metric.histogram
            for metric in request.resource_metrics[0].scope_metrics[0].metrics
            if metric.name == "gen_ai.client.token.usage"
        )
        for request in exports
    ]
    assert len(histograms) == 2
    assert all(
        histogram.aggregation_temporality == AggregationTemporality.AGGREGATION_TEMPORALITY_CUMULATIVE
        for histogram in histograms
    )
    first, second = (histogram.data_points[0] for histogram in histograms)
    assert (first.count, first.sum, first.min, first.max) == (1, 5, 5, 5)
    assert (second.count, second.sum, second.min, second.max) == (2, 10006, 5, 10001)
    assert second.explicit_bounds == first.explicit_bounds
    assert second.bucket_counts[1] == second.bucket_counts[-1] == 1
    assert sum(second.bucket_counts) == second.count
    assert 0 < first.start_time_unix_nano == second.start_time_unix_nano
    assert first.time_unix_nano < second.time_unix_nano
    assert first.attributes == second.attributes
    assert exports[0].resource_metrics[0].resource == exports[1].resource_metrics[0].resource


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
    metrics = create_trace_client(make_provider_config()).build_metrics(trace)
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
    client = create_trace_client(make_provider_config())
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
    metrics = create_trace_client(make_provider_config()).build_metrics(trace)
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


@pytest.mark.parametrize("node_type", ["llm", "question-classifier", "parameter-extractor"])
@pytest.mark.parametrize("retry", [False, True])
def test_workflow_recorder_metrics_count_the_final_model_result_once(node_type: str, retry: bool) -> None:
    source = TraceSource(tenant_id=str(uuid4()), app_id=str(uuid4()), operation_id=str(uuid4()))
    submitted: list[CompletedTrace] = []
    recorder = WorkflowTraceRecorder(
        source=source,
        workflow_id="workflow",
        workflow_version="1",
        inputs={},
        submit_completed_trace=lambda trace: submitted.append(trace) is None,
    )
    node = workflow_node(source, node_type=node_type)
    started = datetime(2026, 9, 11, tzinfo=UTC)
    usage = LLMUsage.empty_usage().model_copy(
        update={
            "prompt_tokens": 3,
            "completion_tokens": 5,
            "total_tokens": 8,
            "latency": 1.25,
            "time_to_first_token": 0.25,
            "time_to_generate": 1.0,
        }
    )
    with recorder.node_run_context(node):
        recorder.on_event(
            NodeRunStartedEvent(
                id=node.execution_id, node_id=node.id, node_type=node_type, node_title=node.title, start_at=started
            )
        )
        if retry:
            failed_result = NodeRunResult(
                llm_usage=usage.model_copy(update={"prompt_tokens": 100, "completion_tokens": 200, "latency": 0.75})
            )
            recorder.on_node_run_end(
                node,
                None,
                NodeRunFailedEvent(
                    id=node.execution_id,
                    node_id=node.id,
                    node_type=node_type,
                    start_at=started,
                    finished_at=started + timedelta(seconds=1),
                    error="temporary failure",
                    node_run_result=failed_result,
                ),
            )
            recorder.on_event(
                NodeRunRetryEvent(
                    id=node.execution_id,
                    node_id=node.id,
                    node_type=node_type,
                    node_title=node.title,
                    start_at=started,
                    retry_index=1,
                    error="temporary failure",
                    node_run_result=failed_result,
                )
            )
        recorder.on_event(
            NodeRunSucceededEvent(
                id=node.execution_id,
                node_id=node.id,
                node_type=node_type,
                start_at=started + timedelta(seconds=2) if retry else started,
                finished_at=started + timedelta(seconds=5),
                node_run_result=NodeRunResult(
                    llm_usage=usage,
                    process_data={"model_name": "model", "model_provider": "provider", "model_mode": "completion"},
                ),
            )
        )
    recorder.on_event(GraphRunSucceededEvent())
    assert recorder.finish_workflow_trace()
    trace = CompletedTrace.model_validate_json(submitted[0].model_dump_json())
    root, model, *attempts = trace.spans
    assert root.status == model.status == "ok"
    assert model.span_type == ("node" if retry else "llm")
    assert model.started_at == started
    assert model.ended_at == started + timedelta(seconds=5)
    if retry:
        assert not model.usage
        assert model.attributes["aggregate_usage"] == usage.model_dump(mode="json")
        assert [attempt.status for attempt in attempts] == ["error", "ok"]
        assert all(attempt.attributes["metrics_from_parent"] for attempt in attempts)

    metrics = create_trace_client(make_provider_config()).build_metrics(trace)
    assert len(metrics) == 6
    assert [(metric.name, metric.histogram.data_points[0].sum) for metric in metrics[1:]] == [
        ("gen_ai.client.operation.duration", 1.25),
        ("gen_ai.client.token.usage", 3),
        ("gen_ai.client.token.usage", 5),
        ("gen_ai.server.time_to_first_token", 0.25),
        ("gen_ai.streaming.time_to_generate", 1),
    ]
    assert {item.key: item.value.string_value for item in metrics[1].histogram.data_points[0].attributes} == {
        "gen_ai.operation.name": "completion",
        "gen_ai.system": "provider",
        "gen_ai.response.model": "model",
        "stream": "true",
    }


@pytest.mark.parametrize("latency", [None, "unknown", -1, True])
def test_missing_provider_latency_does_not_become_span_wall_time(latency: object) -> None:
    trace = make_completed_trace()
    model = trace.spans[-1].model_copy(update={"usage": {"latency": latency, "completion_tokens": 3}})
    trace = trace.model_copy(update={"spans": (*trace.spans[:-1], model)})
    metrics = create_trace_client(make_provider_config()).build_metrics(trace)
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
    metrics = create_trace_client(make_provider_config()).build_metrics(trace)
    assert [metric.histogram.data_points[0].sum for metric in metrics] == [2, 3, 0.25, 0.5]
