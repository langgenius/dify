"""Failed operations retain native exception details and configured event limits."""

import json
from concurrent.futures import ThreadPoolExecutor

import pytest
from dify_trace_arize_phoenix.arize_phoenix_trace import create_trace_client
from opentelemetry.context import Context
from opentelemetry.sdk.trace import ReadableSpan, TracerProvider
from opentelemetry.sdk.trace.sampling import ALWAYS_ON

from core.ops.otlp_trace import otlp_attributes
from core.ops.provider_config import provider_config_identity, resolve_provider_config
from core.ops.provider_export import timestamp_ns
from tests.unit_tests.core.ops.test_provider_export import (
    isolate_deployment_settings,  # noqa: F401
    make_completed_trace,
)

from .test_export_contract import make_provider_config  # pyrefly: ignore[missing-import]


@pytest.mark.parametrize("provider", ["arize", "phoenix"])
@pytest.mark.parametrize(
    "environment",
    [
        {},
        {"OTEL_SPAN_EVENT_COUNT_LIMIT": "0"},
        {"OTEL_EVENT_ATTRIBUTE_COUNT_LIMIT": "1"},
        {"OTEL_ATTRIBUTE_COUNT_LIMIT": "2", "OTEL_EVENT_ATTRIBUTE_COUNT_LIMIT": "3"},
        {"OTEL_ATTRIBUTE_VALUE_LENGTH_LIMIT": "8", "OTEL_SPAN_ATTRIBUTE_VALUE_LENGTH_LIMIT": "2"},
        {"OTEL_EVENT_ATTRIBUTE_COUNT_LIMIT": ""},
        {"OTEL_SPAN_EVENT_COUNT_LIMIT": "", "OTEL_ATTRIBUTE_VALUE_LENGTH_LIMIT": "0"},
    ],
)
def test_exception_events_match_native_limits_and_use_captured_settings(
    provider: str, environment: dict[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    for name, value in environment.items():
        monkeypatch.setenv(name, value)
    trace = make_completed_trace()
    error = "Model request failed: diagnostic detail"
    failed = trace.spans[0].model_copy(update={"status": "error", "error": error})
    original = failed.model_dump_json()
    attributes = {
        "exception.type": "str",
        "exception.message": error,
        "exception.escaped": False,
        "exception.stacktrace": error,
    }
    native = TracerProvider(sampler=ALWAYS_ON, shutdown_on_exit=False)
    try:
        span = native.get_tracer("native-error-contract").start_span("Workflow", context=Context())
        span.add_event("exception", attributes, timestamp=timestamp_ns(failed.ended_at))
        span.end()
        assert isinstance(span, ReadableSpan)
        expected = span.events
        dropped = span.dropped_events
    finally:
        native.shutdown()
    config = resolve_provider_config(provider, make_provider_config(provider))
    assert json.loads(json.dumps(config)) == config
    monkeypatch.setenv("OTEL_SPAN_EVENT_COUNT_LIMIT", "invalid-worker-value")

    exported = create_trace_client(provider, config).build_span(trace, failed)

    assert len(exported.events) == len(expected)
    assert exported.dropped_events_count == dropped
    for actual, event in zip(exported.events, expected, strict=True):
        assert actual.name == event.name
        assert actual.time_unix_nano == event.timestamp
        assert actual.attributes == otlp_attributes(dict(event.attributes or {}))
        assert actual.dropped_attributes_count == event.dropped_attributes
    assert failed.model_dump_json() == original


@pytest.mark.parametrize("provider", ["arize", "phoenix"])
def test_event_settings_bind_identity_and_isolate_concurrent_exports(
    provider: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    traces = [make_completed_trace(), make_completed_trace()]
    configs = []
    for limit in (0, 1):
        monkeypatch.setenv("OTEL_SPAN_EVENT_COUNT_LIMIT", str(limit))
        configs.append(resolve_provider_config(provider, make_provider_config(provider, f"secret-{limit}")))
    changed = resolve_provider_config(provider, make_provider_config(provider, "secret-0"))
    assert provider_config_identity(provider, configs[0]) != provider_config_identity(provider, changed)
    monkeypatch.setenv("OTEL_SPAN_EVENT_COUNT_LIMIT", "invalid-worker-value")
    clients = [create_trace_client(provider, config) for config in configs]
    with ThreadPoolExecutor(max_workers=2) as executor:
        calls = [
            executor.submit(
                client.build_span, trace, trace.spans[-1].model_copy(update={"status": "error", "error": "failure"})
            )
            for client, trace in zip(clients, traces, strict=True)
        ]
        assert [len(call.result().events) for call in calls] == [0, 1]
    assert [client.http.headers["authorization"] for client in clients] == ["Bearer secret-0", "Bearer secret-1"]
