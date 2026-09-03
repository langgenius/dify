import json
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from opentelemetry.sdk import trace as trace_sdk
from opentelemetry.sdk.trace.export import SpanExportResult

from core.ops.exceptions import RetryableTraceDispatchError, TraceDispatchRejectedError
from core.ops.unified_trace.entities import CanonicalSpan, CanonicalSpanKind, CanonicalSpanStatus, CanonicalTrace
from core.ops.unified_trace.otel import OTelTracingConfig, UnifiedOTelAdapter, UnifiedOTelTrace
from core.ops.unified_trace.otlp_adapter import StatusRecordingOTLPSpanExporter, is_terminal_http_status

ENDPOINT = "http://collector:4318/v1/traces"


def make_trace(*, error: bool = False, publish_parent: bool = True) -> CanonicalTrace:
    spans = [
        CanonicalSpan(
            id="root-1",
            parent_id=None,
            name="chatflow_run-1",
            kind=CanonicalSpanKind.CHAIN,
            start_time=datetime(2025, 1, 1),
            end_time=datetime(2025, 1, 1, 0, 0, 1),
            status=CanonicalSpanStatus.OK,
            can_parent_workflow=publish_parent,
            publishes_parent_context=publish_parent,
        ),
        CanonicalSpan(
            id="llm-1",
            parent_id="root-1",
            name="llm",
            kind=CanonicalSpanKind.LLM,
            start_time=datetime(2025, 1, 1),
            end_time=datetime(2025, 1, 1, 0, 0, 1),
            status=CanonicalSpanStatus.ERROR if error else CanonicalSpanStatus.OK,
            error="boom" if error else None,
            metadata={
                "model_provider": "openai",
                "model_name": "gpt-4o",
                "prompt_tokens": 12,
                "completion_tokens": 3,
                "total_tokens": 15,
            },
        ),
    ]
    return CanonicalTrace(
        trace_id="trace-1",
        session_id="session-1",
        root_span_id="root-1",
        spans=tuple(spans),
    )


def make_adapter(
    monkeypatch: pytest.MonkeyPatch, config: OTelTracingConfig | None = None
) -> tuple[UnifiedOTelAdapter, MagicMock]:
    if config is None:
        config = OTelTracingConfig(endpoint=ENDPOINT)
    exporter = MagicMock()
    exporter.export.return_value = SpanExportResult.SUCCESS
    exporter.last_status_code = None
    monkeypatch.setattr(UnifiedOTelAdapter, "build_exporter", lambda _self, _config: exporter)
    return UnifiedOTelAdapter(config), exporter


def test_emit_exports_all_spans_in_order(monkeypatch: pytest.MonkeyPatch) -> None:
    adapter, exporter = make_adapter(monkeypatch)
    publisher = MagicMock()

    adapter.emit(make_trace(), None, publisher)

    assert exporter.export.call_count == 2
    first_span = exporter.export.call_args_list[0].args[0][0]
    assert first_span.name == "chatflow_run-1"
    assert first_span.attributes["dify.span.id"] == "root-1"
    assert first_span.attributes["openinference.span.kind"] == "CHAIN"


def test_emit_adds_gen_ai_attributes_from_metadata(monkeypatch: pytest.MonkeyPatch) -> None:
    adapter, exporter = make_adapter(monkeypatch)

    adapter.emit(make_trace(), None, MagicMock())

    root_attributes = exporter.export.call_args_list[0].args[0][0].attributes
    llm_attributes = exporter.export.call_args_list[1].args[0][0].attributes
    assert "gen_ai.operation.name" not in root_attributes
    assert root_attributes["gen_ai.conversation.id"] == "session-1"
    assert llm_attributes["gen_ai.operation.name"] == "chat"
    assert llm_attributes["gen_ai.provider.name"] == "openai"
    assert llm_attributes["gen_ai.request.model"] == "gpt-4o"
    assert llm_attributes["gen_ai.usage.input_tokens"] == 12
    assert llm_attributes["gen_ai.usage.output_tokens"] == 3
    assert llm_attributes["gen_ai.usage.total_tokens"] == 15
    # The shared OpenInference dialect is kept alongside gen_ai.*
    assert llm_attributes["openinference.span.kind"] == "LLM"
    assert json.loads(llm_attributes["metadata"])["model_name"] == "gpt-4o"


def test_emit_names_tool_spans_for_gen_ai(monkeypatch: pytest.MonkeyPatch) -> None:
    adapter, exporter = make_adapter(monkeypatch)
    tool = CanonicalSpan(
        id="tool-1",
        parent_id=None,
        name="web_search",
        kind=CanonicalSpanKind.TOOL,
        start_time=datetime(2025, 1, 1),
        end_time=datetime(2025, 1, 1, 0, 0, 1),
        status=CanonicalSpanStatus.OK,
    )

    adapter.emit(CanonicalTrace(trace_id="t", session_id="", root_span_id="tool-1", spans=(tool,)), None, MagicMock())

    attributes = exporter.export.call_args.args[0][0].attributes
    assert attributes["gen_ai.operation.name"] == "execute_tool"
    assert attributes["gen_ai.tool.name"] == "web_search"
    assert "gen_ai.conversation.id" not in attributes


def test_emit_marks_error_span(monkeypatch: pytest.MonkeyPatch) -> None:
    adapter, exporter = make_adapter(monkeypatch)

    adapter.emit(make_trace(error=True), None, MagicMock())

    llm_span = exporter.export.call_args_list[1].args[0][0]
    assert llm_span.status.status_code.name == "ERROR"


def test_emit_publishes_parent_context_only_after_export_success(monkeypatch: pytest.MonkeyPatch) -> None:
    adapter, _ = make_adapter(monkeypatch)
    publisher = MagicMock()

    adapter.emit(make_trace(), None, publisher)

    publisher.assert_called_once()
    published_span_id = publisher.call_args.args[0]
    assert published_span_id == "root-1"
    provider_context = publisher.call_args.args[1]
    assert provider_context.provider == "otel"
    assert "traceparent" in provider_context.provider_context


def test_emit_export_exception_is_retryable_and_does_not_publish(monkeypatch: pytest.MonkeyPatch) -> None:
    adapter, exporter = make_adapter(monkeypatch)
    exporter.export.side_effect = RuntimeError("connection refused")
    publisher = MagicMock()

    with pytest.raises(RetryableTraceDispatchError, match="otel span export failed"):
        adapter.emit(make_trace(), None, publisher)

    publisher.assert_not_called()


@pytest.mark.parametrize("status_code", [None, 408, 429, 500, 503])
def test_emit_transient_export_failure_is_retryable(monkeypatch: pytest.MonkeyPatch, status_code: int | None) -> None:
    adapter, exporter = make_adapter(monkeypatch)
    exporter.export.return_value = SpanExportResult.FAILURE
    exporter.last_status_code = status_code
    publisher = MagicMock()

    with pytest.raises(RetryableTraceDispatchError, match="canonical_span_id=root-1"):
        adapter.emit(make_trace(), None, publisher)

    publisher.assert_not_called()


@pytest.mark.parametrize("status_code", [400, 401, 403, 404, 413])
def test_emit_terminal_export_rejection_is_not_retryable(monkeypatch: pytest.MonkeyPatch, status_code: int) -> None:
    adapter, exporter = make_adapter(monkeypatch)
    exporter.export.return_value = SpanExportResult.FAILURE
    exporter.last_status_code = status_code
    publisher = MagicMock()

    with pytest.raises(TraceDispatchRejectedError, match=f"HTTP {status_code}") as exc_info:
        adapter.emit(make_trace(), None, publisher)

    assert not isinstance(exc_info.value, RetryableTraceDispatchError)
    publisher.assert_not_called()


def test_is_terminal_http_status_classification() -> None:
    assert is_terminal_http_status(401)
    assert is_terminal_http_status(404)
    assert not is_terminal_http_status(408)
    assert not is_terminal_http_status(429)
    assert not is_terminal_http_status(503)
    assert not is_terminal_http_status(None)
    assert not is_terminal_http_status(MagicMock())


def test_status_recording_exporter_remembers_last_http_status() -> None:
    exporter = StatusRecordingOTLPSpanExporter(endpoint=ENDPOINT, timeout=1)
    exporter._session = MagicMock()
    exporter._session.post.return_value = SimpleNamespace(ok=False, status_code=404, reason="Not Found")
    span = trace_sdk.TracerProvider().get_tracer("test").start_span("probe")
    span.end()

    assert exporter.export((span,)) is SpanExportResult.FAILURE
    assert exporter.last_status_code == 404

    exporter._session.post.return_value = SimpleNamespace(ok=True, status_code=200, reason="OK")
    assert exporter.export((span,)) is SpanExportResult.SUCCESS
    assert exporter.last_status_code == 200


def test_adapter_builds_exporter_resource_and_headers_from_config(monkeypatch: pytest.MonkeyPatch) -> None:
    exporter_cls = MagicMock()
    monkeypatch.setattr("core.ops.unified_trace.otlp_adapter.StatusRecordingOTLPSpanExporter", exporter_cls)
    config = OTelTracingConfig(
        endpoint=ENDPOINT,
        headers=json.dumps({"authorization": "Bearer tok"}),
        service_name="dify-app-a",
        resource_attributes={"deployment.environment": "prod"},
    )

    adapter = UnifiedOTelAdapter(config)

    exporter_cls.assert_called_once_with(
        endpoint=ENDPOINT,
        headers={"authorization": "Bearer tok"},
        timeout=30,
    )
    resource = adapter.build_resource(config)
    assert resource.attributes["service.name"] == "dify-app-a"
    assert resource.attributes["deployment.environment"] == "prod"
    assert resource.attributes["telemetry.sdk.language"] == "python"


def test_otel_config_defaults_and_coercion() -> None:
    config = OTelTracingConfig(endpoint=ENDPOINT, headers={"a": "b"})
    assert config.service_name == "dify"
    assert json.loads(config.resource_attributes) == {}
    assert json.loads(config.headers) == {"a": "b"}
    assert config.parsed_headers() == {"a": "b"}


@pytest.mark.parametrize("service_name", ["", "   "])
def test_otel_config_empty_service_name_falls_back_to_default(service_name: str) -> None:
    config = OTelTracingConfig(endpoint=ENDPOINT, service_name=service_name)
    assert config.service_name == "dify"


def test_otel_config_tolerates_empty_structured_fields() -> None:
    config = OTelTracingConfig(endpoint=ENDPOINT, headers="", resource_attributes="")
    assert config.parsed_headers() == {}
    assert config.parsed_resource_attributes() == {}


def test_otel_config_accepts_json_string_resource_attributes() -> None:
    config = OTelTracingConfig(endpoint=ENDPOINT, resource_attributes='{"team": "A"}')
    assert config.parsed_resource_attributes() == {"team": "A"}


def test_otel_config_rejects_invalid_headers_json() -> None:
    with pytest.raises(ValueError, match="Expecting property name"):
        OTelTracingConfig(endpoint=ENDPOINT, headers="{not-json")


@pytest.mark.parametrize("value", ["[]", '"text"', "1"])
def test_otel_config_rejects_non_object_resource_attributes(value: str) -> None:
    with pytest.raises(ValueError, match="resource_attributes must be a JSON object"):
        OTelTracingConfig(endpoint=ENDPOINT, resource_attributes=value)


def test_otel_config_header_values_may_contain_asterisks() -> None:
    config = OTelTracingConfig(endpoint=ENDPOINT, headers='{"authorization": "Basic a*b"}')
    assert config.parsed_headers() == {"authorization": "Basic a*b"}


@pytest.mark.parametrize("masked", ['{"aut************n"}', "*" * 20])
def test_otel_config_masked_headers_pass_validation_but_never_export(masked: str) -> None:
    config = OTelTracingConfig(endpoint=ENDPOINT, headers=masked)
    assert config.headers == masked
    with pytest.raises(ValueError, match="masked"):
        config.parsed_headers()


def test_otel_config_keeps_ciphertext_headers_untouched() -> None:
    ciphertext = "SFlCUklEOmFiY2RlZg=="
    config = OTelTracingConfig(endpoint=ENDPOINT, headers=ciphertext)
    assert config.headers == ciphertext


def test_api_check_success_and_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    exporter = MagicMock()
    exporter.export.return_value = SpanExportResult.SUCCESS
    exporter.last_status_code = None
    monkeypatch.setattr(UnifiedOTelAdapter, "build_exporter", lambda _self, _config: exporter)
    instance = UnifiedOTelTrace(OTelTracingConfig(endpoint=ENDPOINT))

    assert instance.api_check() is True

    exporter.export.return_value = SpanExportResult.FAILURE
    with pytest.raises(ValueError, match="rejected the api_check span"):
        instance.api_check()

    exporter.last_status_code = 401
    with pytest.raises(ValueError, match=r"rejected the api_check span \(HTTP 401\)"):
        instance.api_check()

    exporter.export.side_effect = ConnectionError("down")
    with pytest.raises(ValueError, match=r"\[otel\] API check failed: down"):
        instance.api_check()
