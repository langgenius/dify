"""Keep native SDK sampling with each operation while exporting its independent metrics."""

import json
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import Mock
from uuid import UUID, uuid4

import pytest
from dify_trace_tencent.config import TencentConfig
from dify_trace_tencent.tencent_trace import create_trace_client
from opentelemetry.context import Context
from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import ExportTraceServiceRequest
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.trace import NonRecordingSpan, SpanContext, TraceFlags, set_span_in_context, use_span
from pydantic import JsonValue

from core.ops.otlp_trace import otlp_trace_id
from core.ops.provider_config import provider_config_identity, resolve_provider_config
from core.ops.provider_export import export_span_id, span_id_bytes
from core.ops.trace_data import CompletedTrace, ExportedParentSpans, TraceProviderSettings
from tests.unit_tests.core.ops.test_provider_export import (
    isolate_deployment_settings,  # noqa: F401
    make_completed_trace,
)
from tests.unit_tests.core.ops.test_trace_export_state import make_export_state

# Pytest importlib mode resolves these hyphenated provider packages.
from . import test_disabled  # pyrefly: ignore[missing-module-attribute]
from .test_export_contract import make_provider_config  # pyrefly: ignore[missing-import]

export_requests = test_disabled.export_requests

SAMPLER_NAMES = (
    "always_on",
    "always_off",
    "traceidratio",
    "parentbased_always_on",
    "parentbased_always_off",
    "parentbased_traceidratio",
)


def export_captured_trace(
    trace: CompletedTrace, config: dict[str, JsonValue], parent: dict[str, JsonValue] | None = None
) -> ExportedParentSpans:
    client = create_trace_client(config)
    client.export_state = make_export_state(
        trace,
        TraceProviderSettings(
            tenant_id=trace.source.tenant_id,
            app_id=trace.source.app_id,
            provider_name="tencent",
            config_id=str(uuid4()),
        ),
    )
    return client.export_trace(trace, parent)


@pytest.mark.parametrize("sampler_name", SAMPLER_NAMES)
@pytest.mark.parametrize("parent_sampled", [None, False, True])
@pytest.mark.parametrize("external_trace_id", ["1" * 32, "f" * 32])
def test_trace_sampling_matches_native_provider_and_preserves_metrics(
    sampler_name: str,
    parent_sampled: bool | None,
    external_trace_id: str,
    monkeypatch: pytest.MonkeyPatch,
    export_requests: list[tuple[str, dict[str, str], bytes]],
) -> None:
    monkeypatch.setenv("OTEL_TRACES_SAMPLER", sampler_name)
    monkeypatch.setenv("OTEL_TRACES_SAMPLER_ARG", "0.5")
    trace = make_completed_trace()
    trace = trace.model_copy(
        update={"source": trace.source.model_copy(update={"external_trace_id": external_trace_id})}
    )
    trace_id = UUID(otlp_trace_id(trace)).int
    parent: dict[str, JsonValue] | None = None
    native_parent = Context()
    if parent_sampled is not None:
        parent = {"trace_id": str(UUID(int=trace_id)), "span_id": "2" * 16, "sampled": parent_sampled}
        native_parent = set_span_in_context(
            NonRecordingSpan(SpanContext(trace_id, int("2" * 16, 16), True, TraceFlags(int(parent_sampled)))),
            native_parent,
        )
    native = TracerProvider(shutdown_on_exit=False)
    monkeypatch.setattr(native.id_generator, "generate_trace_id", lambda: trace_id)
    try:
        native_root = native.get_tracer("native-tencent").start_span("operation", context=native_parent)
        native_child = native.get_tracer("native-tencent").start_span(
            "child", context=set_span_in_context(native_root, Context())
        )
        sampled = native_root.is_recording()
        assert native_child.is_recording() is sampled
        native_child.end()
        native_root.end()
    finally:
        native.shutdown()
    config = resolve_provider_config("tencent", make_provider_config())

    receipt = export_captured_trace(trace, config, parent)

    assert [signal for signal, _, _ in export_requests] == (
        ["grpc/trace", "grpc/metrics"] if sampled else ["grpc/metrics"]
    )
    assert all(span["sampled"] is sampled for span in receipt.spans.values())
    assert all(
        span["trace_id"] == otlp_trace_id(trace, parent) and span["span_id"] == export_span_id(trace, span_id)
        for span_id, span in receipt.spans.items()
    )
    if sampled:
        request = ExportTraceServiceRequest.FromString(export_requests[0][2])
        spans = request.resource_spans[0].scope_spans[0].spans
        assert len(spans) == len(trace.spans)
        assert all(span.flags & 1 for span in spans)
        if parent is not None:
            assert spans[0].parent_span_id == span_id_bytes(str(parent["span_id"]))


@pytest.mark.parametrize("sampler_name", [None, *SAMPLER_NAMES, "ALWAYS_OFF", " always_off ", "unknown", ""])
@pytest.mark.parametrize("ratio", [None, "0", "0.5", "1", "invalid"])
def test_captured_sampler_matches_native_parsing_and_survives_worker_environment_changes(
    sampler_name: str | None, ratio: str | None, monkeypatch: pytest.MonkeyPatch
) -> None:
    if sampler_name is not None:
        monkeypatch.setenv("OTEL_TRACES_SAMPLER", sampler_name)
    if ratio is not None:
        monkeypatch.setenv("OTEL_TRACES_SAMPLER_ARG", ratio)
    native = TracerProvider(shutdown_on_exit=False)
    try:
        expected_description = native.sampler.get_description()
    finally:
        native.shutdown()
    config = resolve_provider_config("tencent", make_provider_config())
    assert json.loads(json.dumps(config, allow_nan=False)) == config
    identity = provider_config_identity("tencent", config)
    monkeypatch.setenv(
        "OTEL_TRACES_SAMPLER", "always_on" if expected_description == "AlwaysOffSampler" else "always_off"
    )
    changed = resolve_provider_config("tencent", make_provider_config())
    assert provider_config_identity("tencent", changed) != identity
    monkeypatch.setattr(TencentConfig, "load_runtime_settings", Mock(side_effect=AssertionError("snapshot reread")))

    client = create_trace_client(config)

    assert client.sampler.get_description() == expected_description
    assert provider_config_identity("tencent", config) == identity


@pytest.mark.parametrize("sampler_name", ["traceidratio", "parentbased_traceidratio"])
@pytest.mark.parametrize("ratio", ["-0.1", "1.1", "nan", "inf", "-inf"])
def test_invalid_ratio_preserves_native_error(sampler_name: str, ratio: str, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OTEL_TRACES_SAMPLER", sampler_name)
    monkeypatch.setenv("OTEL_TRACES_SAMPLER_ARG", ratio)
    with pytest.raises(ValueError) as native_error:
        TracerProvider(shutdown_on_exit=False)
    with pytest.raises(ValueError, match=str(native_error.value).replace("[", r"\[").replace("]", r"\]")):
        resolve_provider_config("tencent", make_provider_config())


@pytest.mark.parametrize("sampler_name", ["traceidratio", "parentbased_traceidratio"])
def test_ratio_changes_configuration_identity_and_keeps_native_boundary(
    sampler_name: str,
    monkeypatch: pytest.MonkeyPatch,
    export_requests: list[tuple[str, dict[str, str], bytes]],
) -> None:
    monkeypatch.setenv("OTEL_TRACES_SAMPLER", sampler_name)
    monkeypatch.setenv("OTEL_TRACES_SAMPLER_ARG", "0.5")
    config = resolve_provider_config("tencent", make_provider_config())
    monkeypatch.setenv("OTEL_TRACES_SAMPLER_ARG", "0.25")
    changed = resolve_provider_config("tencent", make_provider_config())
    assert provider_config_identity("tencent", config) != provider_config_identity("tencent", changed)
    for low_bits, sampled in ((2**63 - 1, True), (2**63, False)):
        trace = make_completed_trace()
        trace = trace.model_copy(
            update={"source": trace.source.model_copy(update={"external_trace_id": str(UUID(int=low_bits))})}
        )
        receipt = export_captured_trace(trace, config)
        assert all(span["sampled"] is sampled for span in receipt.spans.values())
    assert [signal for signal, _, _ in export_requests] == ["grpc/trace", "grpc/metrics", "grpc/metrics"]


@pytest.mark.parametrize("protocol", ["grpc", "http/protobuf"])
def test_unsampled_retry_exports_metrics_once(
    protocol: str,
    monkeypatch: pytest.MonkeyPatch,
    export_requests: list[tuple[str, dict[str, str], bytes]],
) -> None:
    monkeypatch.setenv("OTEL_TRACES_SAMPLER", "always_off")
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_PROTOCOL", protocol)
    trace = make_completed_trace()
    client = create_trace_client(resolve_provider_config("tencent", make_provider_config()))
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
    assert client.export_trace(trace) == receipt

    assert all(span["sampled"] is False for span in receipt.spans.values())
    assert client.export_state.has_completed_signal("metrics")
    assert [signal for signal, _, _ in export_requests] == ["grpc/metrics" if protocol == "grpc" else "http/metrics"]


@pytest.mark.parametrize("sampler_name", SAMPLER_NAMES)
def test_sampler_keeps_native_empty_credential_probe(
    sampler_name: str,
    monkeypatch: pytest.MonkeyPatch,
    export_requests: list[tuple[str, dict[str, str], bytes]],
) -> None:
    monkeypatch.setenv("OTEL_TRACES_SAMPLER", sampler_name)
    monkeypatch.setenv("OTEL_TRACES_SAMPLER_ARG", "0")
    client = create_trace_client(make_provider_config())

    assert client.verify_credentials()
    assert client.get_project_url() == "https://console.cloud.tencent.com/apm"
    assert len(export_requests) == 1
    assert export_requests[0][0] == "grpc/trace"
    assert not ExportTraceServiceRequest.FromString(export_requests[0][2]).resource_spans


def test_parent_receipt_keeps_drop_for_late_children_and_default_for_older_receipts(
    monkeypatch: pytest.MonkeyPatch,
    export_requests: list[tuple[str, dict[str, str], bytes]],
) -> None:
    monkeypatch.setenv("OTEL_TRACES_SAMPLER", "always_off")
    trace = make_completed_trace()
    receipt = export_captured_trace(trace, resolve_provider_config("tencent", make_provider_config()))
    parent = json.loads(json.dumps(receipt.spans[trace.root_span_id]))
    monkeypatch.setenv("OTEL_TRACES_SAMPLER", "parentbased_always_on")
    config = resolve_provider_config("tencent", make_provider_config())
    child = make_completed_trace()
    export_requests.clear()

    for _ in range(2):
        receipt = export_captured_trace(child, config, parent)
        assert all(
            span["sampled"] is False and span["trace_id"] == parent["trace_id"] for span in receipt.spans.values()
        )
    assert [signal for signal, _, _ in export_requests] == ["grpc/metrics", "grpc/metrics"]
    parent.pop("sampled")
    export_requests.clear()
    receipt = export_captured_trace(child, config, parent)
    assert all(span["sampled"] is True for span in receipt.spans.values())
    assert [signal for signal, _, _ in export_requests] == ["grpc/trace", "grpc/metrics"]


def test_concurrent_tenants_keep_captured_sampling_and_credentials(
    monkeypatch: pytest.MonkeyPatch,
    export_requests: list[tuple[str, dict[str, str], bytes]],
) -> None:
    operations: list[tuple[CompletedTrace, dict[str, JsonValue]]] = []
    for sampler_name in ("always_off", "always_on"):
        trace = make_completed_trace()
        trace = trace.model_copy(update={"source": trace.source.model_copy(update={"actor_id": str(uuid4())})})
        monkeypatch.setenv("OTEL_TRACES_SAMPLER", sampler_name)
        config = resolve_provider_config("tencent", make_provider_config(trace.source.tenant_id))
        assert json.loads(json.dumps(config)) == config
        operations.append((trace, config))
    monkeypatch.setenv("OTEL_TRACES_SAMPLER", "always_off")
    monkeypatch.setattr(TencentConfig, "load_runtime_settings", Mock(side_effect=AssertionError("snapshot reread")))

    with ThreadPoolExecutor(max_workers=2) as executor:
        receipts = list(executor.map(lambda operation: export_captured_trace(*operation), operations))

    assert all(span["sampled"] is False for span in receipts[0].spans.values())
    assert all(span["sampled"] is True for span in receipts[1].spans.values())
    assert sorted(signal for signal, _, _ in export_requests) == ["grpc/metrics", "grpc/metrics", "grpc/trace"]
    enabled_trace = operations[1][0]
    trace_exports = [(headers, data) for signal, headers, data in export_requests if signal == "grpc/trace"]
    assert trace_exports[0][0]["authorization"] == f"Bearer {enabled_trace.source.tenant_id}"
    request = ExportTraceServiceRequest.FromString(trace_exports[0][1])
    assert {
        attribute.value.string_value
        for span in request.resource_spans[0].scope_spans[0].spans
        for attribute in span.attributes
        if attribute.key == "dify.tenant_id"
    } == {enabled_trace.source.tenant_id}


def test_older_snapshot_ignores_worker_sampler_and_ambient_parent(
    monkeypatch: pytest.MonkeyPatch,
    export_requests: list[tuple[str, dict[str, str], bytes]],
) -> None:
    config = resolve_provider_config("tencent", make_provider_config())
    config["_runtime_settings"].pop("sampling", None)
    monkeypatch.setenv("OTEL_TRACES_SAMPLER", "always_off")
    ambient_parent = NonRecordingSpan(SpanContext(1, 2, False, TraceFlags(0)))

    with use_span(ambient_parent):
        receipt = export_captured_trace(make_completed_trace(), config)

    assert all(span["sampled"] is True for span in receipt.spans.values())
    assert [signal for signal, _, _ in export_requests] == ["grpc/trace", "grpc/metrics"]
