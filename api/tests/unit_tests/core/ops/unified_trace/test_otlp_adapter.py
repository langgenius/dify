import json
from datetime import datetime
from unittest.mock import MagicMock, patch

import pytest

from core.ops.exceptions import RetryableTraceDispatchError
from core.ops.unified_trace.entities import CanonicalSpan, CanonicalSpanKind, CanonicalSpanStatus, CanonicalTrace
from core.ops.unified_trace.otel import OTelTracingConfig, UnifiedOTelAdapter


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
        ),
    ]
    return CanonicalTrace(
        trace_id="trace-1",
        session_id="session-1",
        root_span_id="root-1",
        spans=tuple(spans),
    )


def make_adapter(**config_kwargs) -> tuple[UnifiedOTelAdapter, MagicMock]:
    from opentelemetry.sdk.trace.export import SpanExportResult

    config = OTelTracingConfig(endpoint="http://collector:4318/v1/traces", **config_kwargs)
    with patch.object(UnifiedOTelAdapter, "build_exporter", return_value=MagicMock()) as _:
        adapter = UnifiedOTelAdapter(config)
    adapter._exporter.export.return_value = SpanExportResult.SUCCESS
    return adapter, adapter._exporter


def test_emit_exports_all_spans_in_order() -> None:
    adapter, exporter = make_adapter()
    publisher = MagicMock()

    adapter.emit(make_trace(), None, publisher)

    assert exporter.export.call_count == 2
    first_span = exporter.export.call_args_list[0].args[0][0]
    assert first_span.name == "chatflow_run-1"
    assert first_span.attributes["dify.span.id"] == "root-1"
    assert first_span.attributes["openinference.span.kind"] == "CHAIN"


def test_emit_marks_error_span() -> None:
    adapter, exporter = make_adapter()
    publisher = MagicMock()

    adapter.emit(make_trace(error=True), None, publisher)

    llm_span = exporter.export.call_args_list[1].args[0][0]
    assert llm_span.status.status_code.name == "ERROR"


def test_emit_publishes_parent_context_only_after_export_success() -> None:
    adapter, exporter = make_adapter()
    publisher = MagicMock()

    adapter.emit(make_trace(), None, publisher)

    publisher.assert_called_once()
    published_span_id = publisher.call_args.args[0]
    assert published_span_id == "root-1"
    provider_context = publisher.call_args.args[1]
    assert provider_context.provider == "otel"
    assert "traceparent" in provider_context.provider_context


def test_emit_export_failure_raises_and_does_not_publish() -> None:
    adapter, exporter = make_adapter()
    exporter.export.side_effect = RuntimeError("connection refused")
    publisher = MagicMock()

    with pytest.raises(RetryableTraceDispatchError, match="otel span export failed"):
        adapter.emit(make_trace(), None, publisher)

    publisher.assert_not_called()


def test_emit_export_rejection_raises_and_does_not_publish() -> None:
    from opentelemetry.sdk.trace.export import SpanExportResult

    adapter, exporter = make_adapter()
    exporter.export.return_value = SpanExportResult.FAILURE
    publisher = MagicMock()

    with pytest.raises(RetryableTraceDispatchError, match="canonical_span_id=root-1"):
        adapter.emit(make_trace(), None, publisher)

    publisher.assert_not_called()


def test_adapter_builds_resource_and_headers_from_config() -> None:
    adapter, _ = make_adapter(
        headers=json.dumps({"authorization": "Bearer tok"}),
        service_name="dify-app-a",
        resource_attributes={"deployment.environment": "prod"},
    )

    with patch("core.ops.unified_trace.otel.OTLPSpanExporter") as exporter_cls:
        adapter.build_exporter(adapter._config)
        exporter_cls.assert_called_once_with(
            endpoint="http://collector:4318/v1/traces",
            headers={"authorization": "Bearer tok"},
            timeout=30,
        )

    resource = adapter.build_resource(adapter._config)
    assert resource.attributes["service.name"] == "dify-app-a"
    assert resource.attributes["deployment.environment"] == "prod"


def test_otel_config_defaults_and_coercion() -> None:
    config = OTelTracingConfig(endpoint="http://collector:4318/v1/traces", headers={"a": "b"})
    assert config.service_name == "dify"
    assert json.loads(config.resource_attributes) == {}
    assert json.loads(config.headers) == {"a": "b"}
    assert config.parsed_headers() == {"a": "b"}


def test_otel_config_accepts_json_string_resource_attributes() -> None:
    config = OTelTracingConfig(
        endpoint="http://collector:4318/v1/traces",
        resource_attributes='{"team": "A"}',
    )
    assert config.parsed_resource_attributes() == {"team": "A"}


def test_otel_config_rejects_invalid_headers_json() -> None:
    with pytest.raises(ValueError, match="Expecting property name"):
        OTelTracingConfig(endpoint="http://collector:4318/v1/traces", headers="{not-json")


def test_api_check_success_and_failure() -> None:
    from opentelemetry.sdk.trace.export import SpanExportResult

    from core.ops.unified_trace.otel import UnifiedOTelTrace

    with patch.object(UnifiedOTelAdapter, "build_exporter") as build:
        exporter = MagicMock()
        exporter.export.return_value = SpanExportResult.SUCCESS
        build.return_value = exporter
        instance = UnifiedOTelTrace(OTelTracingConfig(endpoint="http://collector:4318/v1/traces"))

    assert instance.api_check() is True
    exporter.export.return_value = SpanExportResult.FAILURE

    with pytest.raises(ValueError, match="rejected the api_check span"):
        instance.api_check()
