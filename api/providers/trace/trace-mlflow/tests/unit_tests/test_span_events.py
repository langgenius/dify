"""MLflow error events and explicit event limits survive every native upload path."""

import json
from concurrent.futures import ThreadPoolExecutor
from typing import Any
from uuid import uuid4

import httpx
import pytest
from dify_trace_mlflow.mlflow_trace import MLflowTraceClient
from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import ExportTraceServiceRequest
from opentelemetry.sdk.trace import Span, SpanLimits, TracerProvider
from opentelemetry.sdk.trace.sampling import ALWAYS_ON

from core.ops.provider_config import resolve_provider_config
from core.ops.provider_export import timestamp_ns

from .test_export_contract import make_provider_config  # pyrefly: ignore[missing-import]
from .test_native_export import make_trace, read_attribute_value  # pyrefly: ignore[missing-import]


@pytest.mark.parametrize("route", ["otlp", "mlflow-v3", "mlflow-v2", "databricks"])
@pytest.mark.parametrize("bounded", [False, True])
def test_error_events_reach_every_upload(route: str, bounded: bool, monkeypatch: pytest.MonkeyPatch) -> None:
    provider = "databricks" if route == "databricks" else "mlflow"
    trace = make_trace()
    root, child = trace.spans
    cases = [
        ("failed-node", "llm", "error", {"node_execution_id": str(uuid4())}, {"node_status": "failed"}),
        ("handled-node", "tool", "handled_error", {"node_execution_id": str(uuid4())}, {"node_status": "exception"}),
        ("message", "operation", "error", {}, {"operation_type": "message"}),
        ("tool", "tool", "error", {}, {"operation_type": "tool"}),
        ("suggested_question", "operation", "error", {}, {"operation_type": "suggested_question"}),
        ("retrieval", "retrieval", "error", {}, {"operation_type": "dataset_retrieval"}),
        ("moderation", "moderation", "error", {}, {"operation_type": "moderation"}),
        ("successful-node", "llm", "ok", {"node_execution_id": str(uuid4())}, {"node_status": "succeeded"}),
        ("incomplete", "workflow", "incomplete", {}, {}),
        ("handled-workflow", "workflow", "handled_error", {}, {}),
        ("cancelled", "workflow", "cancelled", {}, {}),
    ]
    trace = trace.model_copy(
        update={
            "spans": (
                root.model_copy(
                    update={
                        "status": "error",
                        "error": "workflow failed",
                        "events": ({"name": "pause", "timestamp": root.started_at.isoformat(), "resumable": True},),
                    }
                ),
                *(
                    child.model_copy(
                        update={
                            "span_id": str(uuid4()),
                            "span_name": name,
                            "span_type": span_type,
                            "status": status,
                            "error": "operation failed" if status in {"error", "handled_error", "cancelled"} else None,
                            "attributes": attributes,
                            **fields,
                        }
                    )
                    for name, span_type, status, fields, attributes in cases
                ),
            )
        }
    )
    original = trace.model_dump_json()
    if bounded:
        monkeypatch.setenv("OTEL_SPAN_EVENT_COUNT_LIMIT", "1")
        monkeypatch.setenv("OTEL_EVENT_ATTRIBUTE_COUNT_LIMIT", "2")
        monkeypatch.setenv("OTEL_ATTRIBUTE_VALUE_LENGTH_LIMIT", "12")
    config = resolve_provider_config(provider, make_provider_config(provider))
    monkeypatch.setenv("OTEL_SPAN_EVENT_COUNT_LIMIT", "0")
    client = MLflowTraceClient(provider, config)
    request_id = "tr-" + trace.trace_id.replace("-", "")
    sent: list[httpx.Request] = []

    def respond(request: httpx.Request) -> httpx.Response:
        sent.append(request)
        path = request.url.path
        if "credentials-for-data-upload" in path:
            return httpx.Response(200, json={"credential_info": {"signed_uri": "https://storage.example/trace"}})
        if path == "/v1/traces":
            return httpx.Response(200 if route == "otlp" else 501, content=b"")
        if request.method == "GET":
            return httpx.Response(200, json={"traces": []}) if path == "/api/2.0/mlflow/traces" else httpx.Response(404)
        if path == "/api/3.0/mlflow/traces":
            if route == "mlflow-v2":
                return httpx.Response(404)
            return httpx.Response(
                200,
                json={
                    "trace": {
                        "trace_info": {
                            "trace_id": request_id,
                            "tags": {"mlflow.artifactLocation": "https://storage.example/trace"},
                        }
                    }
                },
            )
        if path == "/api/2.0/mlflow/traces":
            body = json.loads(request.content)
            return httpx.Response(
                200,
                json={
                    "trace_info": {
                        "request_id": request_id,
                        "experiment_id": "1",
                        "request_metadata": body["request_metadata"],
                        "tags": [
                            *body["tags"],
                            {"key": "mlflow.artifactLocation", "value": "https://storage.example/trace"},
                        ],
                    }
                },
            )
        return httpx.Response(200, json={})

    monkeypatch.setattr(
        "core.ops.provider_export.ssrf_proxy.create_http_client",
        lambda **kwargs: httpx.Client(transport=httpx.MockTransport(respond), trust_env=False),
    )
    client.export_trace(trace)
    if route == "otlp":
        spans = ExportTraceServiceRequest.FromString(sent[-1].content).resource_spans[0].scope_spans[0].spans
        events: dict[str, list[dict[str, Any]]] = {
            span.name: [
                {
                    "name": event.name,
                    "time_unix_nano": event.time_unix_nano,
                    "attributes": {entry.key: read_attribute_value(entry.value) for entry in event.attributes},
                }
                for event in span.events
            ]
            for span in spans
        }
        assert all(span.dropped_events_count == 0 for span in spans)
        assert all(event.dropped_attributes_count == 0 for span in spans for event in span.events)
    else:
        events = {span["name"]: span["events"] for span in json.loads(sent[-1].content)["spans"]}
    for name, event_name, message in [
        ("Workflow", "exception", "workflow failed"),
        ("failed-node", "exception", "Node failed with status: failed"),
        ("handled-node", "exception", "Node failed with status: exception"),
        ("message", "error", "operation failed"),
        ("tool", "error", "operation failed"),
        ("suggested_question", "error", "operation failed"),
        ("cancelled", "exception", "operation failed"),
    ]:
        event = events[name][-1]
        assert event == {
            "name": event_name,
            "time_unix_nano": timestamp_ns(root.ended_at if name == "Workflow" else child.ended_at),
            "attributes": {"exception.type": "Error", "exception.stacktrace": message[:12]}
            if bounded
            else {"exception.message": message, "exception.type": "Error", "exception.stacktrace": message},
        }
    for name in ("retrieval", "moderation", "successful-node", "incomplete", "handled-workflow"):
        assert events[name] == []
    assert len(events["Workflow"]) == (1 if bounded else 2)
    if not bounded:
        assert events["Workflow"][0]["attributes"]["resumable"] is True
    assert trace.model_dump_json() == original


@pytest.mark.parametrize("provider", ["mlflow", "databricks"])
@pytest.mark.parametrize(
    "environment",
    [
        {"OTEL_SPAN_EVENT_COUNT_LIMIT": "0"},
        {"OTEL_SPAN_EVENT_COUNT_LIMIT": "2"},
        {"OTEL_SPAN_EVENT_COUNT_LIMIT": " "},
        {"OTEL_EVENT_ATTRIBUTE_COUNT_LIMIT": "0"},
        {"OTEL_ATTRIBUTE_COUNT_LIMIT": "1", "OTEL_EVENT_ATTRIBUTE_COUNT_LIMIT": "3"},
        {"OTEL_ATTRIBUTE_COUNT_LIMIT": "2", "OTEL_EVENT_ATTRIBUTE_COUNT_LIMIT": " "},
        {"OTEL_ATTRIBUTE_COUNT_LIMIT": " "},
        {"OTEL_ATTRIBUTE_VALUE_LENGTH_LIMIT": "3", "OTEL_SPAN_ATTRIBUTE_VALUE_LENGTH_LIMIT": "0"},
        {"OTEL_ATTRIBUTE_VALUE_LENGTH_LIMIT": "0"},
        {"OTEL_ATTRIBUTE_VALUE_LENGTH_LIMIT": " "},
    ],
)
def test_captured_event_limits_match_native_sdk(
    provider: str, environment: dict[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    trace = make_trace()
    root = trace.spans[0].model_copy(
        update={
            "events": tuple(
                {"name": f"event-{index}", "detail": "long value", "count": index, "values": ["longer", "second"]}
                for index in range(150)
            )
        }
    )
    config = make_provider_config(provider)
    original = root.model_dump_json()
    baseline = MLflowTraceClient(provider, {**config, "_runtime_settings": {}})._build_otlp_span(trace, root)
    for name, value in environment.items():
        monkeypatch.setenv(name, value)
    limits = SpanLimits(max_events=None if "OTEL_SPAN_EVENT_COUNT_LIMIT" in environment else SpanLimits.UNSET)
    tracer_provider = TracerProvider(span_limits=limits, sampler=ALWAYS_ON, shutdown_on_exit=False)
    with tracer_provider.get_tracer("native-mlflow-event-contract").start_as_current_span("workflow") as native:
        assert isinstance(native, Span)
        for event in baseline.events:
            native.add_event(
                event.name,
                {entry.key: read_attribute_value(entry.value) for entry in event.attributes},
                timestamp=event.time_unix_nano,
            )
    expected = [(event.name, event.timestamp, dict(event.attributes or {})) for event in native.events]
    tracer_provider.shutdown()
    captured = resolve_provider_config(provider, config)
    monkeypatch.setenv("OTEL_SPAN_EVENT_COUNT_LIMIT", "0")
    monkeypatch.setenv("OTEL_EVENT_ATTRIBUTE_COUNT_LIMIT", "0")
    monkeypatch.setenv("OTEL_ATTRIBUTE_VALUE_LENGTH_LIMIT", "0")
    actual = MLflowTraceClient(provider, captured)._build_otlp_span(trace, root)
    assert [
        (event.name, event.time_unix_nano, {entry.key: read_attribute_value(entry.value) for entry in event.attributes})
        for event in actual.events
    ] == [
        (
            name,
            timestamp,
            {key: list(value) if isinstance(value, tuple) else value for key, value in attributes.items()},
        )
        for name, timestamp, attributes in expected
    ]
    assert root.model_dump_json() == original


@pytest.mark.parametrize("provider", ["mlflow", "databricks"])
@pytest.mark.parametrize("name", ["OTEL_SPAN_EVENT_COUNT_LIMIT", "OTEL_EVENT_ATTRIBUTE_COUNT_LIMIT"])
@pytest.mark.parametrize("value", ["-1", "invalid"])
def test_invalid_event_limit_rejects_configuration(
    provider: str, name: str, value: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv(name, value)
    with pytest.raises(ValueError):
        resolve_provider_config(provider, make_provider_config(provider))


def test_concurrent_tenants_keep_captured_event_limits(monkeypatch: pytest.MonkeyPatch) -> None:
    snapshots: list[dict[str, Any]] = []
    traces = [make_trace(), make_trace()]
    for index, count in enumerate(("0", "1")):
        monkeypatch.setenv("OTEL_SPAN_EVENT_COUNT_LIMIT", count)
        snapshots.append(resolve_provider_config("mlflow", make_provider_config("mlflow", f"tenant-{index}")))
    monkeypatch.setenv("OTEL_SPAN_EVENT_COUNT_LIMIT", "99")

    def export_events(index: int) -> int:
        root = traces[index].spans[0].model_copy(update={"error": "failed", "status": "error"})
        return len(MLflowTraceClient("mlflow", snapshots[index])._build_otlp_span(traces[index], root).events)

    with ThreadPoolExecutor(max_workers=2) as executor:
        assert list(executor.map(export_events, range(2))) == [0, 1]
    assert snapshots[0]["_runtime_settings"]["event_limits"] != snapshots[1]["_runtime_settings"]["event_limits"]
