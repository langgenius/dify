"""Explicit OTEL span limits stay with captured enterprise settings."""

import json
import logging
import os
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import Mock
from uuid import uuid4

import pytest
from opentelemetry.sdk.trace import SpanLimits, TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter
from opentelemetry.sdk.trace.sampling import ParentBasedTraceIdRatio
from pydantic import JsonValue

from core.ops.otlp_trace import otlp_attributes
from core.ops.trace_source import _settings_hash
from enterprise.telemetry import enterprise_trace
from enterprise.telemetry.exporter import EnterpriseExporter
from tests.unit_tests.core.ops.test_provider_export import make_completed_trace


@pytest.fixture(autouse=True)
def enterprise_configuration(monkeypatch: pytest.MonkeyPatch, config_overrides: Callable[..., None]) -> None:
    config_overrides(
        DEPLOYMENT_EDITION="ENTERPRISE",
        ENTERPRISE_TELEMETRY_ENABLED=True,
        ENTERPRISE_OTLP_ENDPOINT="http://collector.example",
        ENTERPRISE_OTLP_PROTOCOL="http/protobuf",
        ENTERPRISE_INCLUDE_CONTENT=True,
        ENTERPRISE_OTEL_SAMPLING_RATE=1,
        SECRET_KEY="enterprise-span-limits-test",
    )
    for name in tuple(os.environ):
        if (name.startswith("OTEL_") and name.endswith("_LIMIT")) or name == "OTEL_SDK_DISABLED":
            monkeypatch.delenv(name)
    monkeypatch.setenv("OTEL_TRACES_SAMPLER", "always_off")


@pytest.mark.parametrize(
    "environment",
    [
        {"OTEL_SPAN_ATTRIBUTE_VALUE_LENGTH_LIMIT": "8"},
        {"OTEL_ATTRIBUTE_VALUE_LENGTH_LIMIT": "8"},
        {"OTEL_ATTRIBUTE_VALUE_LENGTH_LIMIT": "2", "OTEL_SPAN_ATTRIBUTE_VALUE_LENGTH_LIMIT": "8"},
        {"OTEL_SPAN_ATTRIBUTE_VALUE_LENGTH_LIMIT": "0"},
        {"OTEL_ATTRIBUTE_VALUE_LENGTH_LIMIT": "0", "OTEL_SPAN_ATTRIBUTE_VALUE_LENGTH_LIMIT": " "},
        {"OTEL_SPAN_ATTRIBUTE_COUNT_LIMIT": "2"},
        {"OTEL_ATTRIBUTE_COUNT_LIMIT": "2"},
        {"OTEL_ATTRIBUTE_COUNT_LIMIT": "0", "OTEL_SPAN_ATTRIBUTE_COUNT_LIMIT": "2"},
        {"OTEL_SPAN_ATTRIBUTE_COUNT_LIMIT": "0"},
        {"OTEL_ATTRIBUTE_COUNT_LIMIT": "0", "OTEL_SPAN_ATTRIBUTE_COUNT_LIMIT": ""},
        {"OTEL_ATTRIBUTE_COUNT_LIMIT": ""},
        {"OTEL_SPAN_ATTRIBUTE_COUNT_LIMIT": "2", "OTEL_SPAN_ATTRIBUTE_VALUE_LENGTH_LIMIT": "8"},
    ],
)
def test_explicit_limits_match_native_spans_without_changing_logs_or_metrics(
    environment: dict[str, str], monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    for name, value in environment.items():
        monkeypatch.setenv(name, value)
    captured = enterprise_trace.load_enterprise_config()
    assert captured is not None
    assert json.loads(json.dumps(captured)) == captured
    attributes = {"first": "abcdefghijk", "second": ["αβγδεζηθικ", "abcdefghijk"], "third": "value3"}
    provider = TracerProvider(sampler=ParentBasedTraceIdRatio(1.0), shutdown_on_exit=False)
    collector = InMemorySpanExporter()
    provider.add_span_processor(SimpleSpanProcessor(collector))
    native = EnterpriseExporter.__new__(EnterpriseExporter)
    native._tracer = provider.get_tracer("dify.enterprise")
    correlation_id = str(uuid4())
    native.export_span("dify.workflow.run", attributes, correlation_id=correlation_id, span_id_source=correlation_id)
    native_span = collector.get_finished_spans()[0]
    provider.shutdown()
    for name in environment:
        monkeypatch.setenv(name, "invalid-after-capture")
    client = enterprise_trace.EnterpriseTraceClient(captured)
    monkeypatch.setattr(client, "_attributes", lambda *_args: dict(attributes))
    send_traces, send_metrics = Mock(), Mock()
    monkeypatch.setattr(client.otlp, "send_traces", send_traces)
    monkeypatch.setattr(client.otlp, "send_metrics", send_metrics)
    trace = make_completed_trace()
    expected_metrics = [
        metric for span in trace.spans for metric in client._metrics(trace, span, client._operation_type(span))
    ]

    with caplog.at_level(logging.INFO, logger="dify.telemetry"):
        client.export_trace(trace)

    spans = send_traces.call_args.args[0].resource_spans[0].scope_spans[0].spans
    assert spans[0].attributes == otlp_attributes(dict(native_span.attributes or {}))
    assert spans[0].dropped_attributes_count == native_span.dropped_attributes
    assert send_metrics.call_args.args[0] == expected_metrics
    assert len(caplog.records) == len(trace.spans)
    assert all(record.__dict__["attributes"]["first"] == attributes["first"] for record in caplog.records)
    assert trace.spans[0].inputs == {"query": "hello"}


@pytest.mark.parametrize(
    "name",
    [
        "OTEL_SPAN_ATTRIBUTE_COUNT_LIMIT",
        "OTEL_ATTRIBUTE_COUNT_LIMIT",
        "OTEL_SPAN_ATTRIBUTE_VALUE_LENGTH_LIMIT",
        "OTEL_ATTRIBUTE_VALUE_LENGTH_LIMIT",
    ],
)
@pytest.mark.parametrize("value", ["-1", "invalid", "1.5", "unlimited"])
def test_invalid_explicit_limits_preserve_native_validation(
    name: str, value: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv(name, value)
    with pytest.raises(ValueError):
        SpanLimits()
    with pytest.raises(ValueError):
        enterprise_trace.load_enterprise_config()


def test_explicit_limits_bind_identity_and_remain_separate_for_concurrent_tenants(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    traces = [make_completed_trace(), make_completed_trace()]
    clients = []
    for limit in (4, 8):
        monkeypatch.setenv("OTEL_SPAN_ATTRIBUTE_VALUE_LENGTH_LIMIT", str(limit))
        config = enterprise_trace.load_enterprise_config()
        assert config is not None
        clients.append((config, enterprise_trace.EnterpriseTraceClient(config)))
    tenant_id = traces[0].source.tenant_id
    assert _settings_hash(tenant_id, clients[0][0]) != _settings_hash(tenant_id, clients[1][0])
    monkeypatch.setenv("OTEL_SPAN_ATTRIBUTE_VALUE_LENGTH_LIMIT", "0")
    requests = []
    for _, client in clients:
        send = Mock()
        monkeypatch.setattr(client.otlp, "send_traces", send)
        monkeypatch.setattr(client.otlp, "send_metrics", Mock())
        requests.append(send)

    with ThreadPoolExecutor(max_workers=2) as executor:
        list(executor.map(lambda pair: pair[0][1].export_trace(pair[1]), zip(clients, traces, strict=True)))

    for send, limit in zip(requests, (4, 8), strict=True):
        span = send.call_args.args[0].resource_spans[0].scope_spans[0].spans[0]
        values = {attribute.key: attribute.value for attribute in span.attributes}
        assert len(values["dify.workflow.inputs"].string_value) == limit
        assert len(values["dify.tenant_id"].string_value) == limit
    assert traces[0].source.tenant_id != traces[1].source.tenant_id


def test_default_capture_retains_large_and_structured_attributes(monkeypatch: pytest.MonkeyPatch) -> None:
    attributes: dict[str, JsonValue] = {f"field-{index}": "full attribute value" for index in range(160)}
    attributes["structured"] = {"nested": ["full nested value"]}
    captured = enterprise_trace.load_enterprise_config()
    assert captured is not None
    client = enterprise_trace.EnterpriseTraceClient(captured)
    monkeypatch.setattr(client, "_attributes", lambda *_args: dict(attributes))
    send = Mock()
    monkeypatch.setattr(client.otlp, "send_traces", send)
    monkeypatch.setattr(client.otlp, "send_metrics", Mock())

    client.export_trace(make_completed_trace())

    span = send.call_args.args[0].resource_spans[0].scope_spans[0].spans[0]
    assert span.attributes == otlp_attributes(attributes)
    assert span.dropped_attributes_count == 0
