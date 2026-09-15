"""Explicit native SpanLimits apply to MLflow's serialized span attribute values."""

import json
from concurrent.futures import ThreadPoolExecutor

import httpx
import pytest
from dify_trace_mlflow.mlflow_trace import MLflowTraceClient
from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import ExportTraceServiceRequest
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import Span, SpanLimits, TracerProvider
from opentelemetry.sdk.trace.sampling import TraceIdRatioBased

from core.ops.provider_config import resolve_provider_config

from .test_export_contract import make_provider_config  # pyrefly: ignore[missing-import]
from .test_native_export import make_trace, read_attribute_value  # pyrefly: ignore[missing-import]


@pytest.mark.parametrize("provider", ["mlflow", "databricks"])
@pytest.mark.parametrize(
    "environment",
    [
        {"OTEL_SPAN_ATTRIBUTE_VALUE_LENGTH_LIMIT": "3"},
        {"OTEL_ATTRIBUTE_VALUE_LENGTH_LIMIT": "100", "OTEL_SPAN_ATTRIBUTE_VALUE_LENGTH_LIMIT": "0"},
        {"OTEL_SPAN_ATTRIBUTE_COUNT_LIMIT": "0"},
        {"OTEL_ATTRIBUTE_COUNT_LIMIT": "1", "OTEL_SPAN_ATTRIBUTE_COUNT_LIMIT": "3"},
        {"OTEL_ATTRIBUTE_COUNT_LIMIT": "3", "OTEL_SPAN_ATTRIBUTE_COUNT_LIMIT": " "},
        {"OTEL_ATTRIBUTE_COUNT_LIMIT": " "},
        {"OTEL_ATTRIBUTE_VALUE_LENGTH_LIMIT": "3", "OTEL_SPAN_ATTRIBUTE_VALUE_LENGTH_LIMIT": " "},
    ],
)
def test_captured_limits_match_native_serialized_attributes(
    provider: str, environment: dict[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    config = make_provider_config(provider)
    trace = make_trace()
    model_span = trace.spans[1].model_copy(
        update={
            "attributes": {**trace.spans[1].attributes, **{f"custom-{index}": "long value" for index in range(160)}}
        }
    )
    trace = trace.model_copy(update={"spans": (trace.spans[0], model_span)})
    baseline = MLflowTraceClient(provider, {**config, "_runtime_settings": {}})
    native_attributes = {
        key: json.dumps(json.loads(value), ensure_ascii=False)
        for key, value in baseline._attributes(trace, trace.spans[1], "tr-123").items()
    }
    for name, value in environment.items():
        monkeypatch.setenv(name, value)
    # Unconfigured dimensions keep the complete captured Dify record.
    count_configured = any(name.endswith("COUNT_LIMIT") for name in environment)
    limits = SpanLimits(max_span_attributes=None if count_configured else SpanLimits.UNSET)
    tracer_provider = TracerProvider(
        resource=Resource({}), span_limits=limits, sampler=TraceIdRatioBased(1.0), shutdown_on_exit=False
    )
    with tracer_provider.get_tracer("native-mlflow-attribute-contract").start_as_current_span("model") as native:
        assert isinstance(native, Span)
        for key, value in native_attributes.items():
            native.set_attribute(key, value)
    expected = dict(native.attributes or {})
    tracer_provider.shutdown()
    captured = resolve_provider_config(provider, config)
    monkeypatch.setenv("OTEL_SPAN_ATTRIBUTE_COUNT_LIMIT", "999")
    monkeypatch.setenv("OTEL_SPAN_ATTRIBUTE_VALUE_LENGTH_LIMIT", "999")
    actual = MLflowTraceClient(provider, captured)._attributes(trace, trace.spans[1], "tr-123")
    assert actual == expected


@pytest.mark.parametrize("provider", ["mlflow", "databricks"])
@pytest.mark.parametrize("invalid", ["-1", "unlimited", "abc"])
def test_invalid_explicit_limit_is_rejected_before_delivery(
    provider: str, invalid: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("OTEL_SPAN_ATTRIBUTE_COUNT_LIMIT", invalid)
    with pytest.raises(ValueError):
        resolve_provider_config(provider, make_provider_config(provider))


@pytest.mark.parametrize("route", ["otlp", "mlflow-v3", "mlflow-v2", "databricks"])
def test_explicit_limits_reach_every_native_upload_without_truncating_routing(
    route: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    provider = "databricks" if route == "databricks" else "mlflow"
    monkeypatch.setenv("OTEL_SPAN_ATTRIBUTE_VALUE_LENGTH_LIMIT", "8")
    trace = make_trace()
    source_before = trace.model_dump_json()
    request_id = "tr-" + trace.trace_id.replace("-", "")
    client = MLflowTraceClient(provider, make_provider_config(provider))
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
        protobuf = ExportTraceServiceRequest.FromString(sent[-1].content)
        exported = protobuf.resource_spans[0].scope_spans[0].spans
        attributes = {item.key: read_attribute_value(item.value) for item in exported[1].attributes}
        assert attributes["model_name"] == "gpt-4o"
        assert attributes["mlflow.spanInputs"] == '{"messag'
        assert sent[-1].headers["x-mlflow-experiment-id"] == "1"
    else:
        attributes = json.loads(sent[-1].content)["spans"][1]["attributes"]
        assert attributes["model_name"] == '"gpt-4o"'
        assert attributes["mlflow.spanInputs"] == '{"messag'
        assert sent[-1].url.host == "storage.example"
    assert trace.model_dump_json() == source_before
    created = [json.loads(request.content) for request in sent if request.url.path == "/api/3.0/mlflow/traces"]
    assert created[0]["trace"]["trace_info"]["trace_id"] == request_id
    assert created[0]["trace"]["trace_info"]["trace_metadata"]["dify.tenant_id"] == trace.source.tenant_id
    assert created[0]["trace"]["trace_info"]["request_preview"] == '{"query"'
    if route != "otlp":
        assert all("mlflow.trace.tokenUsage" not in item["trace"]["trace_info"]["trace_metadata"] for item in created)


def test_captured_limits_are_distinct_for_concurrent_tenants_and_absent_limits_preserve_data(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    snapshots = []
    traces = []
    for tenant, limit in (("tenant-a", "3"), ("tenant-b", "5")):
        monkeypatch.setenv("OTEL_SPAN_ATTRIBUTE_COUNT_LIMIT", limit)
        trace = make_trace()
        trace = trace.model_copy(update={"source": trace.source.model_copy(update={"tenant_id": tenant})})
        snapshots.append(resolve_provider_config("mlflow", make_provider_config("mlflow", tenant)))
        traces.append(trace)
    assert snapshots[0]["_runtime_settings"] != snapshots[1]["_runtime_settings"]
    monkeypatch.setenv("OTEL_SPAN_ATTRIBUTE_COUNT_LIMIT", "999")

    def project(index: int) -> dict[str, str]:
        return MLflowTraceClient("mlflow", snapshots[index])._attributes(
            traces[index], traces[index].spans[1], "tr-123"
        )

    with ThreadPoolExecutor(max_workers=2) as executor:
        bounded = list(executor.map(project, range(2)))
    assert [len(attributes) for attributes in bounded] == [3, 5]
    monkeypatch.delenv("OTEL_SPAN_ATTRIBUTE_COUNT_LIMIT")
    captured = resolve_provider_config("mlflow", make_provider_config("mlflow"))
    monkeypatch.setenv("OTEL_SPAN_ATTRIBUTE_COUNT_LIMIT", "0")
    client = MLflowTraceClient("mlflow", captured)
    trace = make_trace()
    root = trace.spans[0].model_copy(update={"attributes": {f"key-{index}": "unabridged" for index in range(150)}})
    assert len(client._attributes(trace, root, "tr-123")) > 150
