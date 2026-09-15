"""Keep the native SDK disable switch with the operation that captured its settings."""

import json
from concurrent.futures import ThreadPoolExecutor
from typing import Unpack
from unittest.mock import Mock
from uuid import uuid4

import httpx
import pytest
from dify_trace_tencent.config import TencentConfig
from dify_trace_tencent.tencent_trace import create_trace_client
from opentelemetry.metrics import NoOpMeter
from opentelemetry.proto.collector.metrics.v1.metrics_service_pb2 import ExportMetricsServiceRequest
from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import ExportTraceServiceRequest
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.trace import TracerProvider
from pydantic import JsonValue

from core.ops.otlp_trace import OtlpTraceClient, otlp_trace_id
from core.ops.provider_config import provider_config_identity, resolve_provider_config
from core.ops.provider_export import TraceProviderHttpClient, export_span_id
from core.ops.trace_data import CompletedTrace, ExportedParentSpans, TraceProviderSettings
from tests.unit_tests.core.ops.test_provider_export import (
    RequestArguments,
    isolate_deployment_settings,  # noqa: F401
    make_completed_trace,
)
from tests.unit_tests.core.ops.test_trace_export_state import make_export_state

# Pytest importlib mode resolves these hyphenated provider packages.
from .test_export_contract import make_provider_config  # pyrefly: ignore[missing-import]


@pytest.fixture
def export_requests(monkeypatch: pytest.MonkeyPatch) -> list[tuple[str, dict[str, str], bytes]]:
    requests: list[tuple[str, dict[str, str], bytes]] = []

    def grpc_request(
        client: OtlpTraceClient, signal: str, serialized: bytes, *, http_client: TraceProviderHttpClient | None = None
    ) -> bytes:
        transport = http_client if http_client is not None else client.http
        requests.append(("grpc/" + signal, dict(transport.headers), serialized))
        return b""

    def http_request(method: str, url: str, **kwargs: Unpack[RequestArguments]) -> httpx.Response:
        assert method == "POST"
        requests.append(("http/metrics", dict(kwargs.get("headers", {})), kwargs.get("content", b"")))
        return httpx.Response(200, content=b"")

    monkeypatch.setattr(OtlpTraceClient, "_send_grpc", grpc_request)
    monkeypatch.setattr("core.ops.provider_export.ssrf_proxy.make_request", http_request)
    return requests


@pytest.mark.parametrize(
    ("setting", "disabled"),
    [
        (None, False),
        ("", False),
        ("true", True),
        ("TRUE", True),
        (" true ", True),
        ("\tTrUe\n", True),
        ("false", False),
        ("yes", False),
        ("1", False),
        ("on", False),
        ("0", False),
        ("off", False),
        ("enabled", False),
    ],
)
def test_disable_setting_matches_native_trace_and_metric_providers(
    setting: str | None, disabled: bool, monkeypatch: pytest.MonkeyPatch
) -> None:
    if setting is not None:
        monkeypatch.setenv("OTEL_SDK_DISABLED", setting)
    tracer_provider = TracerProvider(shutdown_on_exit=False)
    meter_provider = MeterProvider(shutdown_on_exit=False)
    try:
        span = tracer_provider.get_tracer("native-tencent").start_span("operation")
        assert span.is_recording() is not disabled
        span.end()
        assert isinstance(meter_provider.get_meter("native-tencent"), NoOpMeter) is disabled
        assert TencentConfig.load_runtime_settings(make_provider_config())["disabled"] is disabled
    finally:
        tracer_provider.shutdown()
        meter_provider.shutdown()


@pytest.mark.parametrize("protocol", ["grpc", "http/protobuf"])
@pytest.mark.parametrize("disabled", [False, True])
def test_captured_switch_controls_both_signals_after_worker_environment_changes(
    protocol: str,
    disabled: bool,
    monkeypatch: pytest.MonkeyPatch,
    export_requests: list[tuple[str, dict[str, str], bytes]],
) -> None:
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_PROTOCOL", protocol)
    monkeypatch.setenv("OTEL_SDK_DISABLED", str(disabled))
    config = make_provider_config()
    captured = json.loads(json.dumps(resolve_provider_config("tencent", config)))
    monkeypatch.setenv("OTEL_SDK_DISABLED", str(not disabled))
    changed = resolve_provider_config("tencent", config)
    assert provider_config_identity("tencent", changed) != provider_config_identity("tencent", captured)
    monkeypatch.setattr(TencentConfig, "load_runtime_settings", Mock(side_effect=AssertionError("snapshot reread")))
    trace = make_completed_trace()
    settings = TraceProviderSettings(
        tenant_id=trace.source.tenant_id,
        app_id=trace.source.app_id,
        provider_name="tencent",
        config_id=str(uuid4()),
    )
    state = make_export_state(trace, settings)
    client = create_trace_client(captured)
    client.export_state = state
    if disabled:
        client.http.deadline = 0

    receipt = client.export_trace(trace)

    assert set(receipt.spans) == {span.span_id for span in trace.spans}
    assert all(
        parent["trace_id"] == otlp_trace_id(trace) and parent["span_id"] == export_span_id(trace, span_id)
        for span_id, parent in receipt.spans.items()
    )
    if disabled:
        assert not export_requests
        assert not state.has_completed_signal("metrics")
        assert client.export_trace(trace) == receipt
        assert all(parent["disabled"] is True for parent in receipt.spans.values())
    else:
        assert [signal for signal, _, _ in export_requests] == [
            "grpc/trace",
            "grpc/metrics" if protocol == "grpc" else "http/metrics",
        ]
        trace_request = ExportTraceServiceRequest.FromString(export_requests[0][2])
        assert len(trace_request.resource_spans[0].scope_spans[0].spans) == len(trace.spans)
        metric_request = ExportMetricsServiceRequest.FromString(export_requests[1][2])
        assert metric_request.resource_metrics[0].scope_metrics[0].metrics
        assert state.has_completed_signal("metrics")
        assert all("disabled" not in parent for parent in receipt.spans.values())


def test_enabled_late_children_keep_disabled_parent_receipts(
    monkeypatch: pytest.MonkeyPatch,
    export_requests: list[tuple[str, dict[str, str], bytes]],
) -> None:
    monkeypatch.setenv("OTEL_SDK_DISABLED", "true")
    config = make_provider_config()
    parent_trace = make_completed_trace()
    parent = create_trace_client(config).export_trace(parent_trace).spans[parent_trace.root_span_id]
    monkeypatch.setenv("OTEL_SDK_DISABLED", "false")
    captured = json.loads(json.dumps(resolve_provider_config("tencent", config)))
    monkeypatch.setattr(TencentConfig, "load_runtime_settings", Mock(side_effect=AssertionError("snapshot reread")))
    child_trace = make_completed_trace()
    for _ in range(2):
        client = create_trace_client(captured)
        client.http.deadline = 0
        receipt = client.export_trace(child_trace, json.loads(json.dumps(parent)))
        assert all(
            span["disabled"] is True and span["trace_id"] == parent["trace_id"] for span in receipt.spans.values()
        )
        assert client.export_trace(child_trace, parent) == receipt
    assert not export_requests


@pytest.mark.parametrize("disabled", [False, True])
def test_disable_switch_keeps_credential_verification_and_console_url(
    disabled: bool,
    monkeypatch: pytest.MonkeyPatch,
    export_requests: list[tuple[str, dict[str, str], bytes]],
) -> None:
    monkeypatch.setenv("OTEL_SDK_DISABLED", str(disabled))
    client = create_trace_client(make_provider_config())

    assert client.verify_credentials()
    assert client.get_project_url() == "https://console.cloud.tencent.com/apm"
    assert len(export_requests) == 1
    assert export_requests[0][0] == "grpc/trace"
    assert not ExportTraceServiceRequest.FromString(export_requests[0][2]).resource_spans


def test_concurrent_tenants_use_their_own_captured_switch_and_credentials(
    monkeypatch: pytest.MonkeyPatch,
    export_requests: list[tuple[str, dict[str, str], bytes]],
) -> None:
    operations: list[tuple[CompletedTrace, dict[str, JsonValue], bool]] = []
    for disabled in (True, False):
        trace = make_completed_trace()
        trace = trace.model_copy(update={"source": trace.source.model_copy(update={"actor_id": str(uuid4())})})
        monkeypatch.setenv("OTEL_SDK_DISABLED", str(disabled))
        captured = json.loads(
            json.dumps(resolve_provider_config("tencent", make_provider_config(trace.source.tenant_id)))
        )
        operations.append((trace, captured, disabled))
    monkeypatch.setenv("OTEL_SDK_DISABLED", "true")
    monkeypatch.setattr(TencentConfig, "load_runtime_settings", Mock(side_effect=AssertionError("snapshot reread")))

    def export(operation: tuple[CompletedTrace, dict[str, JsonValue], bool]) -> ExportedParentSpans:
        trace, captured, _ = operation
        client = create_trace_client(captured)
        client.export_state = make_export_state(
            trace,
            TraceProviderSettings(
                tenant_id=trace.source.tenant_id,
                app_id=trace.source.app_id,
                provider_name="tencent",
                config_id=str(uuid4()),
            ),
        )
        return client.export_trace(trace)

    with ThreadPoolExecutor(max_workers=2) as executor:
        receipts = list(executor.map(export, operations))

    assert all(parent.get("disabled") is True for parent in receipts[0].spans.values())
    assert all("disabled" not in parent for parent in receipts[1].spans.values())
    enabled_trace = operations[1][0]
    assert [signal for signal, _, _ in export_requests] == ["grpc/trace", "grpc/metrics"]
    assert all(
        headers["authorization"] == f"Bearer {enabled_trace.source.tenant_id}" for _, headers, _ in export_requests
    )
    request = ExportTraceServiceRequest.FromString(export_requests[0][2])
    assert {
        attribute.value.string_value
        for span in request.resource_spans[0].scope_spans[0].spans
        for attribute in span.attributes
        if attribute.key == "dify.tenant_id"
    } == {enabled_trace.source.tenant_id}


def test_older_snapshot_does_not_inherit_workers_disable_switch(
    monkeypatch: pytest.MonkeyPatch,
    export_requests: list[tuple[str, dict[str, str], bytes]],
) -> None:
    captured = resolve_provider_config("tencent", make_provider_config())
    captured["_runtime_settings"].pop("disabled")
    monkeypatch.setenv("OTEL_SDK_DISABLED", "true")
    client = create_trace_client(captured)
    trace = make_completed_trace()
    client.export_state = make_export_state(
        trace,
        TraceProviderSettings(
            tenant_id=trace.source.tenant_id,
            app_id=trace.source.app_id,
            provider_name="tencent",
            config_id=str(uuid4()),
        ),
    )

    receipt = client.export_trace(trace)

    assert all("disabled" not in parent for parent in receipt.spans.values())
    assert [signal for signal, _, _ in export_requests] == ["grpc/trace", "grpc/metrics"]
