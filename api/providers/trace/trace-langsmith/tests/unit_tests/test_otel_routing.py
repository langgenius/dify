"""Captured LangSmith routes, native OTel fields and hybrid delivery progress."""

import base64
import gzip
import json
import zlib
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Barrier
from unittest.mock import Mock
from uuid import UUID, uuid4

import httpx
import pytest
from dify_trace_langsmith.config import LangSmithConfig
from dify_trace_langsmith.langsmith_trace import LangSmithTraceClient
from opentelemetry.exporter.otlp.proto.common.trace_encoder import encode_spans
from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import (
    ExportTraceServiceRequest,
    ExportTraceServiceResponse,
)
from opentelemetry.proto.trace.v1.trace_pb2 import Span, Status
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import SpanLimits, TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter
from opentelemetry.sdk.trace.sampling import ALWAYS_ON

from core.ops.provider_config import resolve_provider_config
from core.ops.provider_export import TraceExportError, timestamp_ns
from core.ops.trace_export_state import TraceExportState
from tests.unit_tests.core.ops.test_provider_export import settings_for
from tests.unit_tests.core.ops.test_trace_export_state import make_export_state

from .test_export_contract import make_provider_config  # pyrefly: ignore[missing-import]
from .test_native_export import make_trace  # pyrefly: ignore[missing-import]


@pytest.mark.parametrize(
    ("environment", "mode"),
    [
        ({}, "langsmith"),
        ({"LANGSMITH_TRACING_MODE": "OtEl"}, "otel"),
        ({"LANGSMITH_TRACING_MODE": " ", "LANGCHAIN_TRACING_MODE": "hybrid"}, "hybrid"),
        (
            {"LANGSMITH_TRACING_MODE": "langsmith", "LANGCHAIN_TRACING_MODE": "otel", "LANGSMITH_OTEL_ONLY": "1"},
            "langsmith",
        ),
        ({"LANGCHAIN_OTEL_ENABLED": "TRUE"}, "hybrid"),
        ({"LANGSMITH_OTEL_ENABLED": "false", "LANGCHAIN_OTEL_ENABLED": "true"}, "langsmith"),
        ({"LANGSMITH_OTEL_ENABLED": " true "}, "langsmith"),
        ({"LANGSMITH_OTEL_ONLY": "1", "LANGSMITH_OTEL_ENABLED": "true"}, "otel"),
    ],
)
def test_mode_precedence(environment: dict[str, str], mode: str, monkeypatch: pytest.MonkeyPatch) -> None:
    for name, value in environment.items():
        monkeypatch.setenv(name, value)
    settings = LangSmithConfig.load_runtime_settings(make_provider_config())
    assert settings["mode"] == mode
    assert ("otel" in settings) == (mode != "langsmith")


@pytest.mark.parametrize("mode", ["invalid", " otel "])
def test_invalid_mode_rejected_before_a_client_is_created(mode: str, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("LANGSMITH_TRACING_MODE", mode)
    with pytest.raises(ValueError, match="tracing mode"):
        LangSmithTraceClient(make_provider_config())


@pytest.mark.parametrize("mode", ["langsmith", "otel", "hybrid"])
@pytest.mark.parametrize("disabled", [False, True])
def test_credential_verification_uses_saved_native_config(
    mode: str, disabled: bool, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("LANGSMITH_TRACING_MODE", mode)
    monkeypatch.setenv("OTEL_SDK_DISABLED", str(disabled).lower())
    client = LangSmithTraceClient(make_provider_config())
    native = Mock(return_value=httpx.Response(200))
    monkeypatch.setattr(client.http, "request", native)
    if client.otel is not None:
        monkeypatch.setattr(client.otel.http, "request", Mock(side_effect=AssertionError("OTel verification")))
    assert client.verify_credentials()
    native.assert_called_once_with("GET", "sessions", params={"name": client.config.project, "limit": 1})


def decode_spans(request: httpx.Request) -> list[Span]:
    content = request.content
    if request.headers.get("Content-Encoding") == "gzip":
        content = gzip.decompress(content)
    elif request.headers.get("Content-Encoding") == "deflate":
        content = zlib.decompress(content)
    decoded = ExportTraceServiceRequest.FromString(content)
    assert decoded.resource_spans[0].scope_spans[0].scope.name == "langsmith"
    return list(decoded.resource_spans[0].scope_spans[0].spans)


@pytest.mark.parametrize(("mode", "compression"), [("langsmith", "none"), ("otel", "gzip"), ("hybrid", "deflate")])
def test_selected_routes_export_prepared_runs_and_late_parents(
    mode: str, compression: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("LANGSMITH_TRACING_MODE", mode)
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "https://collector.example/exact")
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT", "https://ignored.example/traces")
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_HEADERS", " Authorization = Bearer otel-secret , x-project = separate ")
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_COMPRESSION", "none")
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_TRACES_COMPRESSION", compression)
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_TIMEOUT", "70")
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_TRACES_TIMEOUT", "12")
    trace = make_trace()
    trace = trace.model_copy(
        update={
            "spans": (trace.spans[0], trace.spans[1].model_copy(update={"status": "error", "error": "model failed"}))
        }
    )
    requests: list[httpx.Request] = []

    def respond(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200, content=b"")

    monkeypatch.setattr(
        "core.ops.provider_export.ssrf_proxy.create_http_client",
        lambda *, ssl_context: httpx.Client(transport=httpx.MockTransport(respond), trust_env=False),
    )
    config = resolve_provider_config("langsmith", make_provider_config("native-secret"))
    client = LangSmithTraceClient(config)
    receipt = client.export_trace(trace)
    native = [request for request in requests if request.url.host == "langsmith.example"]
    otel = [request for request in requests if request.url.host == "collector.example"]
    assert len(native) == (0 if mode == "otel" else 1)
    assert len(otel) == (0 if mode == "langsmith" else 1)
    for request in native:
        assert request.headers["x-api-key"] == "native-secret"
        assert "Authorization" not in request.headers
        assert request.url.path == "/runs/batch"
    if not otel:
        return
    assert otel[0].url.path == "/exact"
    assert otel[0].headers["Authorization"] == "Bearer otel-secret"
    assert "x-api-key" not in otel[0].headers
    assert all(value <= 12 for value in otel[0].extensions["timeout"].values())
    root, model = decode_spans(otel[0])
    assert root.trace_id == model.trace_id == UUID(str(receipt.spans[trace.root_span_id]["trace_id"])).bytes
    assert model.parent_span_id == root.span_id
    assert model.start_time_unix_nano == timestamp_ns(trace.spans[1].started_at)
    assert model.end_time_unix_nano == timestamp_ns(trace.spans[1].ended_at)
    attributes = {attribute.key: attribute.value for attribute in model.attributes}
    assert attributes["langsmith.span.kind"].string_value == "llm"
    assert attributes["gen_ai.operation.name"].string_value == "chat"
    assert attributes["gen_ai.request.model"].string_value == "gpt-4o"
    assert attributes["gen_ai.system"].string_value == "openai"
    assert attributes["gen_ai.usage.total_tokens"].int_value == 8
    assert attributes["gen_ai.request.temperature"].double_value == 0.2
    assert json.loads(attributes["gen_ai.prompt"].string_value)["messages"][0]["content"] == "Rendered prompt"
    assert json.loads(attributes["gen_ai.completion"].string_value)["choices"][0]["message"]["content"] == "World"
    assert model.status.code == Status.STATUS_CODE_ERROR
    assert model.events[0].name == "exception"
    assert model.events[0].time_unix_nano == model.end_time_unix_nano
    late = trace.model_copy(update={"source": trace.source.model_copy(update={"operation_id": str(uuid4())})})
    client.export_trace(late, receipt.spans[trace.root_span_id])
    late_root = decode_spans(requests[-1])[0]
    assert late_root.parent_span_id == root.span_id
    assert late_root.trace_id == root.trace_id


def test_otel_defaults_and_tls_sources_are_independent_of_saved_native_credentials(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("LANGSMITH_TRACING_MODE", "otel")
    monkeypatch.setenv("LANGCHAIN_ENDPOINT", ' "https://otel-default.example/api/" ')
    monkeypatch.setenv("LANGCHAIN_API_KEY", ' "deployment-key" ')
    monkeypatch.setenv("LANGCHAIN_PROJECT", "deployment-project")
    native_ca = tmp_path / "native-ca.pem"
    native_ca.write_text("native CA")
    monkeypatch.setenv("REQUESTS_CA_BUNDLE", str(native_ca))
    for suffix in ("CERTIFICATE", "CLIENT_CERTIFICATE", "CLIENT_KEY"):
        certificate = tmp_path / suffix
        certificate.write_text(suffix)
        monkeypatch.setenv(f"OTEL_EXPORTER_OTLP_{suffix}", "/ignored")
        monkeypatch.setenv(f"OTEL_EXPORTER_OTLP_TRACES_{suffix}", str(certificate))
    settings = LangSmithConfig.load_runtime_settings(make_provider_config("native-key"))["otel"]
    assert settings["endpoint"] == "https://otel-default.example/api/otel"
    assert settings["headers"] == {"x-api-key": "deployment-key", "Langsmith-Project": "deployment-project"}
    assert {name: base64.b64decode(value).decode() for name, value in settings["tls"].items()} == {
        "certificate": "CERTIFICATE",
        "client_certificate": "CLIENT_CERTIFICATE",
        "client_key": "CLIENT_KEY",
    }
    assert settings["request_timeout"] == "10.0"
    monkeypatch.delenv("LANGCHAIN_API_KEY")
    assert (
        LangSmithConfig.load_runtime_settings(make_provider_config("native-key"))["otel"]["headers"]["x-api-key"] == ""
    )


def test_http_otel_endpoint_ignores_unused_ca_file(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("LANGSMITH_TRACING_MODE", "otel")
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://collector.example/traces")
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_TRACES_CERTIFICATE", "/unused/missing-ca.pem")
    assert LangSmithConfig.load_runtime_settings(make_provider_config())["otel"]["tls"] == {}
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "https://collector.example/traces")
    with pytest.raises(ValueError, match="Cannot read TLS configuration"):
        LangSmithConfig.load_runtime_settings(make_provider_config())


@pytest.mark.parametrize("attribute_limit", [1, 2])
def test_span_attribute_limits_keep_native_prompt_and_completion_order(
    attribute_limit: int, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("LANGSMITH_TRACING_MODE", "otel")
    monkeypatch.setenv("OTEL_SPAN_ATTRIBUTE_COUNT_LIMIT", str(attribute_limit))
    snapshot = resolve_provider_config("langsmith", make_provider_config())
    monkeypatch.delenv("OTEL_SPAN_ATTRIBUTE_COUNT_LIMIT")
    client = LangSmithTraceClient(snapshot)
    assert client.otel is not None
    send_traces = Mock()
    monkeypatch.setattr(client.otel, "send_traces", send_traces)
    client.export_trace(make_trace())
    model = send_traces.call_args.args[0].resource_spans[0].scope_spans[0].spans[1]
    assert [attribute.key for attribute in model.attributes] == ["gen_ai.response.finish_reasons", "gen_ai.completion"][
        -attribute_limit:
    ]
    assert json.loads(model.attributes[-1].value.string_value)["choices"][0]["message"]["content"] == "World"
    assert model.dropped_attributes_count > 0


@pytest.mark.parametrize(
    "environment",
    [
        {},
        {"OTEL_EVENT_COUNT_LIMIT": "0"},
        {"OTEL_EVENT_ATTRIBUTE_COUNT_LIMIT": "1"},
        {"OTEL_ATTRIBUTE_VALUE_LENGTH_LIMIT": "8", "OTEL_SPAN_ATTRIBUTE_VALUE_LENGTH_LIMIT": "100"},
        {"OTEL_SPAN_ATTRIBUTE_VALUE_LENGTH_LIMIT": "2"},
    ],
)
def test_exception_events_match_native_otel_limits(
    environment: dict[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("LANGSMITH_TRACING_MODE", "otel")
    for name, value in environment.items():
        monkeypatch.setenv(name, value)
    trace = make_trace()
    model = trace.spans[1].model_copy(update={"status": "error", "error": "model failed"})
    trace = trace.model_copy(update={"spans": (trace.spans[0], model)})
    exporter = InMemorySpanExporter()
    provider = TracerProvider(
        resource=Resource({}), span_limits=SpanLimits(), sampler=ALWAYS_ON, shutdown_on_exit=False
    )
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    native = provider.get_tracer("langsmith").start_span(model.span_name, start_time=timestamp_ns(model.started_at))
    native.record_exception(Exception(model.error), timestamp=timestamp_ns(model.ended_at))
    native.end(end_time=timestamp_ns(model.ended_at))
    expected = encode_spans(exporter.get_finished_spans()).resource_spans[0].scope_spans[0].spans[0]
    provider.shutdown()
    snapshot = resolve_provider_config("langsmith", make_provider_config())
    for name in environment:
        monkeypatch.delenv(name)
    client = LangSmithTraceClient(snapshot)
    assert client.otel is not None
    send_traces = Mock()
    monkeypatch.setattr(client.otel, "send_traces", send_traces)
    client.export_trace(trace)
    actual = send_traces.call_args.args[0].resource_spans[0].scope_spans[0].spans[1]
    assert actual.events == expected.events
    assert actual.dropped_events_count == expected.dropped_events_count


@pytest.mark.parametrize(
    "environment",
    [
        {"OTEL_SDK_DISABLED": " true "},
        {"OTEL_TRACES_SAMPLER": "always_off"},
        {"OTEL_TRACES_SAMPLER": "parentbased_traceidratio", "OTEL_TRACES_SAMPLER_ARG": "0"},
    ],
)
def test_otel_disabled_and_sampling_do_not_disable_hybrid_native_export(
    environment: dict[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("LANGSMITH_TRACING_MODE", "hybrid")
    for name, value in environment.items():
        monkeypatch.setenv(name, value)
    snapshot = resolve_provider_config("langsmith", make_provider_config())
    monkeypatch.setenv("OTEL_SDK_DISABLED", "false")
    monkeypatch.setenv("OTEL_TRACES_SAMPLER", "always_on")
    client = LangSmithTraceClient(snapshot)
    native = Mock(return_value=httpx.Response(200))
    monkeypatch.setattr(client.http, "request", native)
    assert client.otel is not None
    monkeypatch.setattr(client.otel.http, "request", Mock(side_effect=AssertionError("unsampled OTel request")))
    trace = make_trace()
    receipt = client.export_trace(trace)
    assert native.call_count == 1
    assert all(span["otel_sampled"] is False for span in receipt.spans.values())
    client.export_trace(trace, receipt.spans[trace.root_span_id])
    assert native.call_count == 2


@pytest.mark.parametrize("elapsed", [90, 101])
def test_hybrid_routes_share_one_export_deadline(elapsed: int, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("LANGSMITH_TRACING_MODE", "hybrid")
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "https://collector.example/traces")
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_TIMEOUT", "40")
    clock = [1000.0]
    monkeypatch.setattr("core.ops.provider_export.monotonic", lambda: clock[0])
    requests: list[httpx.Request] = []

    def respond(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if len(requests) == 1:
            clock[0] += elapsed
        return httpx.Response(200, content=b"")

    monkeypatch.setattr(
        "core.ops.provider_export.ssrf_proxy.create_http_client",
        lambda *, ssl_context: httpx.Client(transport=httpx.MockTransport(respond), trust_env=False),
    )
    client = LangSmithTraceClient(make_provider_config())
    if elapsed > 100:
        with pytest.raises(TraceExportError, match="export_deadline_exceeded"):
            client.export_trace(make_trace())
        assert len(requests) == 1
    else:
        client.export_trace(make_trace())
        assert requests[-1].url.host == "collector.example"
        assert all(value <= 10 for value in requests[-1].extensions["timeout"].values())


def test_concurrent_owned_snapshots_keep_routes_credentials_and_privacy(monkeypatch: pytest.MonkeyPatch) -> None:
    snapshots = []
    for tenant in ("first", "second"):
        monkeypatch.setenv("LANGSMITH_TRACING_MODE", "otel")
        monkeypatch.setenv("LANGSMITH_HIDE_INPUTS", "true" if tenant == "first" else "false")
        monkeypatch.setenv("OTEL_EXPORTER_OTLP_ENDPOINT", f"https://{tenant}.example/traces")
        monkeypatch.setenv("OTEL_EXPORTER_OTLP_HEADERS", f"Authorization=Bearer {tenant}")
        snapshots.append(resolve_provider_config("langsmith", make_provider_config()))
    assert snapshots[0] != snapshots[1]
    monkeypatch.setenv("LANGSMITH_TRACING_MODE", "langsmith")
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_TRACES_CERTIFICATE", "/missing/changed.pem")
    monkeypatch.setattr(LangSmithConfig, "load_runtime_settings", Mock(side_effect=AssertionError("snapshot reread")))
    requests: list[httpx.Request] = []
    barrier = Barrier(2)

    def respond(request: httpx.Request) -> httpx.Response:
        barrier.wait(timeout=5)
        requests.append(request)
        return httpx.Response(200, content=b"")

    monkeypatch.setattr(
        "core.ops.provider_export.ssrf_proxy.create_http_client",
        lambda *, ssl_context: httpx.Client(transport=httpx.MockTransport(respond), trust_env=False),
    )
    traces = [make_trace(), make_trace()]
    with ThreadPoolExecutor(2) as pool:
        jobs = [
            pool.submit(LangSmithTraceClient(snapshot).export_trace, trace)
            for snapshot, trace in zip(snapshots, traces, strict=True)
        ]
        assert all(job.result().spans for job in jobs)
    for request in requests:
        first = request.url.host == "first.example"
        assert request.headers["Authorization"] == f"Bearer {'first' if first else 'second'}"
        attrs = {attribute.key: attribute.value for attribute in decode_spans(request)[0].attributes}
        assert attrs["langsmith.metadata.dify.tenant_id"].string_value == traces[0 if first else 1].source.tenant_id
        assert (attrs["gen_ai.prompt"].string_value == "{}") is first
        assert ("langsmith.metadata.dify.inputs" not in attrs) is first


@pytest.mark.parametrize("partial_success", [False, True])
def test_hybrid_retry_skips_accepted_native_route(partial_success: bool, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("LANGSMITH_TRACING_MODE", "hybrid")
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "https://collector.example/traces")
    trace = make_trace()
    state = make_export_state(trace, settings_for(trace, "langsmith"))
    requests: list[httpx.Request] = []
    failures = [True]

    def respond(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if request.url.host == "collector.example" and failures:
            failures.pop()
            response = ExportTraceServiceResponse()
            response.partial_success.rejected_spans = 1
            return httpx.Response(200 if partial_success else 503, content=response.SerializeToString())
        return httpx.Response(200, content=b"")

    monkeypatch.setattr(
        "core.ops.provider_export.ssrf_proxy.create_http_client",
        lambda *, ssl_context: httpx.Client(transport=httpx.MockTransport(respond), trust_env=False),
    )
    config = resolve_provider_config("langsmith", make_provider_config())
    client = LangSmithTraceClient(config)
    client.export_state = state
    with pytest.raises(TraceExportError):
        client.export_trace(trace)
    assert state.has_completed_signal("langsmith_native")
    assert not state.has_completed_signal("langsmith_otel")
    retry = LangSmithTraceClient(config)
    retry.export_state = TraceExportState(state.repository, state.delivery)
    assert retry.export_trace(trace).spans
    assert [request.url.host for request in requests] == [
        "langsmith.example",
        "collector.example",
        "collector.example",
    ]
    assert requests[-1].content == requests[-2].content
    assert retry.export_state.has_completed_signal("langsmith_otel")
