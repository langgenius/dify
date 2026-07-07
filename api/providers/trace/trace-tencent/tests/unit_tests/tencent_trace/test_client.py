"""Tests for the TencentTraceClient helpers that drive tracing and metrics."""

from __future__ import annotations

import sys
import types
from types import SimpleNamespace
from typing import Any, TypedDict, cast
from unittest.mock import MagicMock

import pytest
from dify_trace_tencent import client as client_module
from dify_trace_tencent.client import TencentTraceClient, _get_opentelemetry_sdk_version
from dify_trace_tencent.entities.tencent_trace_entity import SpanData
from opentelemetry.sdk.trace import Event
from opentelemetry.trace import SpanContext, Status, StatusCode, TraceFlags

metric_reader_instances: list[DummyMetricReader] = []
meter_provider_instances: list[DummyMeterProvider] = []


class DummyHistogram:
    """Placeholder histogram type used by the stubbed metric stack."""


class AggregationTemporality:
    DELTA = "delta"


class DummyMeter:
    def __init__(self) -> None:
        self.created: list[tuple[dict[str, object], MagicMock]] = []

    def create_histogram(self, **kwargs: object) -> MagicMock:
        hist = MagicMock(name=f"hist-{kwargs.get('name')}")
        self.created.append((kwargs, hist))
        return hist


class DummyMeterProvider:
    def __init__(self, resource: object, metric_readers: list[object]) -> None:
        self.resource = resource
        self.metric_readers = metric_readers
        self.meter = DummyMeter()
        self.shutdown = MagicMock(name="meter_provider_shutdown")
        meter_provider_instances.append(self)

    def get_meter(self, name: str, version: str) -> DummyMeter:
        return self.meter


class DummyMetricReader:
    def __init__(self, exporter: object, export_interval_millis: int) -> None:
        self.exporter = exporter
        self.export_interval_millis = export_interval_millis
        self.shutdown = MagicMock(name="metric_reader_shutdown")
        metric_reader_instances.append(self)


class DummyGrpcMetricExporter:
    def __init__(self, **kwargs: object) -> None:
        self.kwargs = kwargs


class DummyHttpMetricExporter:
    def __init__(self, **kwargs: object) -> None:
        self.kwargs = kwargs


class DummyJsonMetricExporter:
    def __init__(self, **kwargs: object) -> None:
        self.kwargs = kwargs


class DummyJsonMetricExporterNoTemporality:
    """Exporter that rejects preferred_temporality to exercise fallback."""

    def __init__(self, **kwargs: object) -> None:
        if "preferred_temporality" in kwargs:
            raise RuntimeError("unsupported preferred_temporality")
        self.kwargs = kwargs


class PatchedCoreComponents(TypedDict):
    span_exporter: MagicMock
    span_processor: MagicMock
    tracer: MagicMock
    span: MagicMock
    tracer_provider: MagicMock
    logger: MagicMock
    trace_api: Any


def _add_stub_modules(monkeypatch: pytest.MonkeyPatch) -> None:
    """Drop fake metric modules into sys.modules so the client imports resolve."""

    metrics_module = cast(Any, types.ModuleType("opentelemetry.sdk.metrics"))
    metrics_module.Histogram = DummyHistogram
    metrics_module.MeterProvider = DummyMeterProvider
    monkeypatch.setitem(sys.modules, "opentelemetry.sdk.metrics", metrics_module)

    metrics_export_module = cast(Any, types.ModuleType("opentelemetry.sdk.metrics.export"))
    metrics_export_module.AggregationTemporality = AggregationTemporality
    metrics_export_module.PeriodicExportingMetricReader = DummyMetricReader
    monkeypatch.setitem(sys.modules, "opentelemetry.sdk.metrics.export", metrics_export_module)

    grpc_module = cast(Any, types.ModuleType("opentelemetry.exporter.otlp.proto.grpc.metric_exporter"))
    grpc_module.OTLPMetricExporter = DummyGrpcMetricExporter
    monkeypatch.setitem(sys.modules, "opentelemetry.exporter.otlp.proto.grpc.metric_exporter", grpc_module)

    http_module = cast(Any, types.ModuleType("opentelemetry.exporter.otlp.proto.http.metric_exporter"))
    http_module.OTLPMetricExporter = DummyHttpMetricExporter
    monkeypatch.setitem(sys.modules, "opentelemetry.exporter.otlp.proto.http.metric_exporter", http_module)

    http_json_module = cast(Any, types.ModuleType("opentelemetry.exporter.otlp.http.json.metric_exporter"))
    http_json_module.OTLPMetricExporter = DummyJsonMetricExporter
    monkeypatch.setitem(sys.modules, "opentelemetry.exporter.otlp.http.json.metric_exporter", http_json_module)

    legacy_json_module = cast(Any, types.ModuleType("opentelemetry.exporter.otlp.json.metric_exporter"))
    legacy_json_module.OTLPMetricExporter = DummyJsonMetricExporter
    monkeypatch.setitem(sys.modules, "opentelemetry.exporter.otlp.json.metric_exporter", legacy_json_module)


@pytest.fixture(autouse=True)
def stub_metric_modules(monkeypatch: pytest.MonkeyPatch) -> None:
    metric_reader_instances.clear()
    meter_provider_instances.clear()
    _add_stub_modules(monkeypatch)


@pytest.fixture(autouse=True)
def patch_core_components(monkeypatch: pytest.MonkeyPatch) -> PatchedCoreComponents:
    span_exporter = MagicMock(name="span_exporter")
    monkeypatch.setattr(client_module, "OTLPSpanExporter", MagicMock(return_value=span_exporter))

    span_processor = MagicMock(name="span_processor")
    monkeypatch.setattr(client_module, "BatchSpanProcessor", MagicMock(return_value=span_processor))

    tracer = MagicMock(name="tracer")
    span = MagicMock(name="span")
    tracer.start_span.return_value = span

    tracer_provider = MagicMock(name="tracer_provider")
    tracer_provider.get_tracer.return_value = tracer
    tracer_provider.shutdown = MagicMock(name="tracer_provider_shutdown")
    monkeypatch.setattr(client_module, "TracerProvider", MagicMock(return_value=tracer_provider))

    resource = MagicMock(name="resource")
    monkeypatch.setattr(client_module, "Resource", MagicMock(return_value=resource))

    logger_mock = MagicMock(name="tencent_logger")
    monkeypatch.setattr(client_module, "logger", logger_mock)

    trace_api_stub = SimpleNamespace(
        set_span_in_context=MagicMock(name="set_span_in_context", return_value="trace-context"),
        NonRecordingSpan=MagicMock(name="non_recording_span", side_effect=lambda ctx: f"non-{ctx}"),
    )
    monkeypatch.setattr(client_module, "trace_api", trace_api_stub)

    fake_config = SimpleNamespace(
        project=SimpleNamespace(version="test"),
        COMMIT_SHA="sha",
        DEPLOY_ENV="dev",
        EDITION="cloud",
    )
    monkeypatch.setattr(client_module, "dify_config", fake_config)

    monkeypatch.setattr(client_module.socket, "gethostname", lambda: "fake-host")
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_PROTOCOL", "")

    return {
        "span_exporter": span_exporter,
        "span_processor": span_processor,
        "tracer": tracer,
        "span": span,
        "tracer_provider": tracer_provider,
        "logger": logger_mock,
        "trace_api": trace_api_stub,
    }


def _make_span_context(trace_id: int = 1, span_id: int = 2) -> SpanContext:
    return SpanContext(
        trace_id=trace_id,
        span_id=span_id,
        is_remote=False,
        trace_flags=TraceFlags(TraceFlags.SAMPLED),
    )


def _build_client() -> TencentTraceClient:
    return TencentTraceClient(
        service_name="service",
        endpoint="https://trace.example.com:4317",
        token="token",
    )


def test_get_opentelemetry_sdk_version_reads_install(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(client_module, "version", lambda pkg: "2.0.0")
    assert _get_opentelemetry_sdk_version() == "2.0.0"


def test_get_opentelemetry_sdk_version_falls_back(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(client_module, "version", MagicMock(side_effect=RuntimeError("boom")))
    assert _get_opentelemetry_sdk_version() == "1.27.0"


@pytest.mark.parametrize(
    ("endpoint", "expected"),
    [
        (
            "https://example.com:9090",
            ("example.com:9090", False, "example.com", 9090),
        ),
        (
            "http://localhost",
            ("localhost:4317", True, "localhost", 4317),
        ),
        (
            "example.com:bad",
            ("example.com:4317", False, "example.com", 4317),
        ),
    ],
)
def test_resolve_grpc_target_parsable_variants(endpoint: str, expected: tuple[str, bool, str, int]) -> None:
    assert TencentTraceClient._resolve_grpc_target(endpoint) == expected


def test_resolve_grpc_target_handles_errors() -> None:
    assert TencentTraceClient._resolve_grpc_target(cast(str, 123)) == ("localhost:4317", True, "localhost", 4317)


@pytest.mark.parametrize(
    ("method", "attr_name", "args"),
    [
        ("record_llm_duration", "hist_llm_duration", (0.3, {"foo": object()})),
        ("record_token_usage", "hist_token_usage", (5, "input", "chat", "gpt", "gpt", "addr", "dify")),
        ("record_time_to_first_token", "hist_time_to_first_token", (0.4, "dify", "gpt")),
        ("record_time_to_generate", "hist_time_to_generate", (0.6, "dify", "gpt")),
        ("record_trace_duration", "hist_trace_duration", (1.0, {"meta": object()})),
    ],
)
def test_record_methods_call_histograms(method: str, attr_name: str, args: tuple[object, ...]) -> None:
    client = _build_client()
    hist_mock = MagicMock(name=attr_name)
    setattr(client, attr_name, hist_mock)

    getattr(client, method)(*args)
    hist_mock.record.assert_called_once()


def test_record_methods_skip_when_histogram_missing() -> None:
    client = _build_client()
    client.hist_llm_duration = None
    client.record_llm_duration(0.1)

    client.hist_token_usage = None
    client.record_token_usage(1, "go", "chat", "model", "model", "addr", "provider")

    client.hist_time_to_first_token = None
    client.record_time_to_first_token(0.2, "prov", "model")

    client.hist_time_to_generate = None
    client.record_time_to_generate(0.3, "prov", "model")

    client.hist_trace_duration = None
    client.record_trace_duration(0.5)


def test_record_llm_duration_handles_exceptions(patch_core_components: PatchedCoreComponents) -> None:
    client = _build_client()
    client.hist_llm_duration = MagicMock(name="hist_llm_duration")
    client.hist_llm_duration.record.side_effect = RuntimeError("boom")

    client.record_llm_duration(0.2)
    logger = patch_core_components["logger"]
    logger.debug.assert_called()


def test_create_and_export_span_sets_attributes(patch_core_components: PatchedCoreComponents) -> None:
    client = _build_client()
    span = patch_core_components["span"]
    ctx = _make_span_context(span_id=2)
    span.get_span_context.return_value = ctx

    data = SpanData(
        trace_id=1,
        parent_span_id=None,
        span_id=2,
        name="span",
        attributes={"key": "value"},
        events=[Event(name="evt", attributes={"k": "v"}, timestamp=123)],
        status=Status(StatusCode.OK),
        start_time=10,
        end_time=20,
    )

    client._create_and_export_span(data)
    span.set_attributes.assert_called_once()
    span.add_event.assert_called_once()
    span.set_status.assert_called_once()
    span.end.assert_called_once_with(end_time=20)
    assert client.span_contexts[2] == ctx


def test_create_and_export_span_uses_parent_context(patch_core_components: PatchedCoreComponents) -> None:
    client = _build_client()
    existing_context = _make_span_context(span_id=10)
    client.span_contexts[10] = existing_context
    span = patch_core_components["span"]
    span.get_span_context.return_value = _make_span_context(span_id=11)

    data = SpanData(
        trace_id=1,
        parent_span_id=10,
        span_id=11,
        name="span",
        attributes={},
        events=[],
        start_time=0,
        end_time=1,
    )

    client._create_and_export_span(data)
    trace_api = patch_core_components["trace_api"]
    trace_api.NonRecordingSpan.assert_called_once_with(existing_context)
    trace_api.set_span_in_context.assert_called_once()


def test_create_and_export_span_exception_logs_error(patch_core_components: PatchedCoreComponents) -> None:
    client = _build_client()
    span = patch_core_components["span"]
    span.get_span_context.return_value = _make_span_context(span_id=2)
    client.tracer.start_span.side_effect = RuntimeError("boom")

    client._create_and_export_span(
        SpanData(
            trace_id=1,
            parent_span_id=None,
            span_id=2,
            name="span",
            attributes={},
            events=[],
            start_time=0,
            end_time=1,
        )
    )
    logger = patch_core_components["logger"]
    logger.exception.assert_called_once()


def test_api_check_connects_successfully(monkeypatch: pytest.MonkeyPatch) -> None:
    client = _build_client()

    monkeypatch.setattr(
        TencentTraceClient,
        "_resolve_grpc_target",
        MagicMock(return_value=("host:123", False, "host", 123)),
    )

    socket_mock = MagicMock()
    socket_instance = MagicMock()
    socket_instance.connect_ex.return_value = 0
    socket_mock.return_value = socket_instance
    monkeypatch.setattr(client_module.socket, "socket", socket_mock)

    assert client.api_check()
    socket_instance.connect_ex.assert_called_once()


def test_api_check_returns_false_and_handles_local(monkeypatch: pytest.MonkeyPatch) -> None:
    client = _build_client()

    monkeypatch.setattr(
        TencentTraceClient,
        "_resolve_grpc_target",
        MagicMock(return_value=("host:123", False, "host", 123)),
    )

    socket_mock = MagicMock()
    socket_instance = MagicMock()
    socket_instance.connect_ex.return_value = 1
    socket_mock.return_value = socket_instance
    monkeypatch.setattr(client_module.socket, "socket", socket_mock)

    assert not client.api_check()

    monkeypatch.setattr(
        TencentTraceClient,
        "_resolve_grpc_target",
        MagicMock(return_value=("localhost:4317", True, "localhost", 4317)),
    )
    socket_instance.connect_ex.return_value = 1
    assert client.api_check()


def test_api_check_handles_exceptions(monkeypatch: pytest.MonkeyPatch) -> None:
    client = TencentTraceClient("svc", "https://localhost", "token")

    monkeypatch.setattr(client_module.socket, "socket", MagicMock(side_effect=RuntimeError("boom")))
    assert client.api_check()


def test_get_project_url() -> None:
    client = _build_client()
    assert client.get_project_url() == "https://console.cloud.tencent.com/apm"


def test_shutdown_flushes_all_components(patch_core_components: PatchedCoreComponents) -> None:
    client = _build_client()
    span_processor = patch_core_components["span_processor"]
    tracer_provider = patch_core_components["tracer_provider"]

    client.shutdown()
    span_processor.force_flush.assert_called_once()
    span_processor.shutdown.assert_called_once()
    tracer_provider.shutdown.assert_called_once()

    meter_provider = meter_provider_instances[-1]
    metric_reader = metric_reader_instances[-1]
    meter_provider.shutdown.assert_called_once()
    metric_reader.shutdown.assert_called_once()


def test_shutdown_logs_when_meter_provider_fails(patch_core_components: PatchedCoreComponents) -> None:
    client = _build_client()
    meter_provider = meter_provider_instances[-1]
    meter_provider.shutdown.side_effect = RuntimeError("boom")
    assert client.metric_reader is not None
    client.metric_reader.shutdown.side_effect = RuntimeError("boom")

    client.shutdown()
    logger = patch_core_components["logger"]
    logger.debug.assert_any_call(
        "[Tencent APM] Error shutting down meter provider",
        exc_info=True,
    )
    logger.debug.assert_any_call(
        "[Tencent APM] Error shutting down metric reader",
        exc_info=True,
    )


def test_metrics_initialization_failure_sets_histogram_attributes(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(DummyMeterProvider, "__init__", MagicMock(side_effect=RuntimeError("err")))
    client = _build_client()

    assert client.meter is None
    assert client.meter_provider is None
    assert client.hist_llm_duration is None
    assert client.hist_token_usage is None
    assert client.hist_time_to_first_token is None
    assert client.hist_time_to_generate is None
    assert client.hist_trace_duration is None
    assert client.metric_reader is None


def test_add_span_logs_exception(monkeypatch: pytest.MonkeyPatch, patch_core_components: PatchedCoreComponents) -> None:
    client = _build_client()
    monkeypatch.setattr(client, "_create_and_export_span", MagicMock(side_effect=RuntimeError("boom")))

    client.add_span(
        SpanData(
            trace_id=1,
            parent_span_id=None,
            span_id=2,
            name="span",
            attributes={},
            events=[],
            start_time=0,
            end_time=1,
        )
    )

    logger = patch_core_components["logger"]
    logger.exception.assert_called_once()


def test_create_and_export_span_converts_attribute_types(patch_core_components: PatchedCoreComponents) -> None:
    client = _build_client()
    span = patch_core_components["span"]
    span.get_span_context.return_value = _make_span_context(span_id=2)

    data = SpanData.model_construct(
        trace_id=1,
        parent_span_id=None,
        span_id=2,
        name="span",
        attributes={"num": 5, "flag": True, "pi": 3.14, "text": "value"},
        events=[],
        links=[],
        status=Status(StatusCode.OK),
        start_time=0,
        end_time=1,
    )

    client._create_and_export_span(data)
    (attrs,) = span.set_attributes.call_args.args
    assert attrs["num"] == 5
    assert attrs["flag"] is True
    assert attrs["pi"] == 3.14
    assert attrs["text"] == "value"


def test_record_llm_duration_converts_attributes() -> None:
    client = _build_client()
    hist_mock = MagicMock(name="hist_llm_duration")
    client.hist_llm_duration = hist_mock

    client.record_llm_duration(0.3, cast(dict[str, str], {"foo": object(), "bar": 2}))
    _, attrs = hist_mock.record.call_args.args
    assert isinstance(attrs["foo"], str)
    assert attrs["bar"] == 2


def test_record_trace_duration_converts_attributes() -> None:
    client = _build_client()
    hist_mock = MagicMock(name="hist_trace_duration")
    client.hist_trace_duration = hist_mock

    client.record_trace_duration(1.0, cast(dict[str, str], {"meta": object(), "ok": True}))
    _, attrs = hist_mock.record.call_args.args
    assert isinstance(attrs["meta"], str)
    assert attrs["ok"] is True


@pytest.mark.parametrize(
    ("method", "attr_name", "args"),
    [
        ("record_token_usage", "hist_token_usage", (5, "input", "chat", "gpt", "gpt", "addr", "dify")),
        ("record_time_to_first_token", "hist_time_to_first_token", (0.4, "dify", "gpt")),
        ("record_time_to_generate", "hist_time_to_generate", (0.6, "dify", "gpt")),
        ("record_trace_duration", "hist_trace_duration", (1.0, {"meta": object()})),
    ],
)
def test_record_methods_handle_exceptions(
    method: str, attr_name: str, args: tuple[object, ...], patch_core_components: PatchedCoreComponents
) -> None:
    client = _build_client()
    hist_mock = MagicMock(name=attr_name)
    hist_mock.record.side_effect = RuntimeError("boom")
    setattr(client, attr_name, hist_mock)

    getattr(client, method)(*args)
    logger = patch_core_components["logger"]
    logger.debug.assert_called()


def test_metrics_initializes_grpc_metric_exporter() -> None:
    client = _build_client()
    metric_reader = metric_reader_instances[-1]
    exporter = cast(DummyGrpcMetricExporter, metric_reader.exporter)

    assert isinstance(exporter, DummyGrpcMetricExporter)
    assert metric_reader.export_interval_millis == client.metrics_export_interval_sec * 1000
    assert exporter.kwargs["endpoint"] == "trace.example.com:4317"
    assert exporter.kwargs["insecure"] is False
    assert cast(dict[str, dict[str, str]], exporter.kwargs)["headers"]["authorization"] == "Bearer token"


def test_metrics_initializes_http_protobuf_metric_exporter(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_PROTOCOL", "http/protobuf")
    client = _build_client()
    metric_reader = metric_reader_instances[-1]
    exporter = cast(DummyHttpMetricExporter, metric_reader.exporter)

    assert isinstance(exporter, DummyHttpMetricExporter)
    assert metric_reader.export_interval_millis == client.metrics_export_interval_sec * 1000
    assert exporter.kwargs["endpoint"] == client.endpoint
    assert cast(dict[str, dict[str, str]], exporter.kwargs)["headers"]["authorization"] == "Bearer token"


def test_metrics_initializes_http_json_metric_exporter(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_PROTOCOL", "http/json")
    client = _build_client()
    metric_reader = metric_reader_instances[-1]
    exporter = cast(DummyJsonMetricExporter, metric_reader.exporter)

    assert isinstance(exporter, DummyJsonMetricExporter)
    assert metric_reader.export_interval_millis == client.metrics_export_interval_sec * 1000
    assert exporter.kwargs["endpoint"] == client.endpoint
    assert cast(dict[str, dict[str, str]], exporter.kwargs)["headers"]["authorization"] == "Bearer token"
    assert "preferred_temporality" in exporter.kwargs


def test_metrics_http_json_metric_exporter_falls_back_without_temporality(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_PROTOCOL", "http/json")
    exporter_module = sys.modules["opentelemetry.exporter.otlp.http.json.metric_exporter"]
    monkeypatch.setattr(exporter_module, "OTLPMetricExporter", DummyJsonMetricExporterNoTemporality)
    _ = _build_client()
    metric_reader = metric_reader_instances[-1]
    exporter = cast(DummyJsonMetricExporterNoTemporality, metric_reader.exporter)

    assert isinstance(exporter, DummyJsonMetricExporterNoTemporality)
    assert "preferred_temporality" not in exporter.kwargs


def test_metrics_http_json_uses_http_fallback_when_no_json_exporter(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_PROTOCOL", "http/json")

    def _fail_import(mod_path: str) -> types.ModuleType:
        raise ModuleNotFoundError(mod_path)

    monkeypatch.setattr(client_module.importlib, "import_module", _fail_import)

    _ = _build_client()
    metric_reader = metric_reader_instances[-1]
    assert isinstance(metric_reader.exporter, DummyHttpMetricExporter)
