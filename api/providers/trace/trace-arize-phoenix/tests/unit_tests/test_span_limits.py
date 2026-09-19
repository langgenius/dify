"""Keep explicit native attribute limits bound to the provider export attempt."""

import json
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import Mock

import pytest
from dify_trace_arize_phoenix.arize_phoenix_trace import create_trace_client
from dify_trace_arize_phoenix.config import ArizeConfig, PhoenixConfig
from opentelemetry.sdk.trace import ReadableSpan, SpanLimits, TracerProvider

from configs import dify_config
from core.ops.provider_config import provider_config_identity, resolve_provider_config
from core.ops.trace_source import _settings_hash
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
        {"OTEL_ATTRIBUTE_COUNT_LIMIT": "5"},
        {"OTEL_SPAN_ATTRIBUTE_COUNT_LIMIT": "2"},
        {"OTEL_ATTRIBUTE_COUNT_LIMIT": "8", "OTEL_SPAN_ATTRIBUTE_COUNT_LIMIT": "0"},
        {"OTEL_ATTRIBUTE_COUNT_LIMIT": ""},
        {"OTEL_ATTRIBUTE_COUNT_LIMIT": "2", "OTEL_SPAN_ATTRIBUTE_COUNT_LIMIT": " "},
        {"OTEL_ATTRIBUTE_VALUE_LENGTH_LIMIT": "8"},
        {"OTEL_SPAN_ATTRIBUTE_VALUE_LENGTH_LIMIT": " 4 "},
        {"OTEL_ATTRIBUTE_VALUE_LENGTH_LIMIT": "8", "OTEL_SPAN_ATTRIBUTE_VALUE_LENGTH_LIMIT": "4"},
        {"OTEL_ATTRIBUTE_VALUE_LENGTH_LIMIT": "8", "OTEL_SPAN_ATTRIBUTE_VALUE_LENGTH_LIMIT": ""},
        {"OTEL_SPAN_ATTRIBUTE_VALUE_LENGTH_LIMIT": "0"},
        {"OTEL_ATTRIBUTE_COUNT_LIMIT": "8", "OTEL_SPAN_ATTRIBUTE_VALUE_LENGTH_LIMIT": "5"},
    ],
)
def test_explicit_limits_keep_native_precedence_and_json_safe_snapshots(
    provider: str, environment: dict[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    for name, value in environment.items():
        monkeypatch.setenv(name, value)
    native = SpanLimits()
    captured = resolve_provider_config(provider, make_provider_config(provider))
    assert json.loads(json.dumps(captured)) == captured
    expected = (
        {
            "max_attributes": native.max_span_attributes if any("COUNT" in name for name in environment) else None,
            "max_value_length": native.max_span_attribute_length
            if any("LENGTH" in name for name in environment)
            else None,
        }
        if environment
        else {}
    )
    assert captured["_runtime_settings"]["span_limits"] == expected
    monkeypatch.setenv("OTEL_SPAN_ATTRIBUTE_VALUE_LENGTH_LIMIT", "invalid-worker-value")
    client = create_trace_client(provider, captured)
    assert client.span_limits == expected


@pytest.mark.parametrize("provider", ["arize", "phoenix"])
@pytest.mark.parametrize(
    "name",
    [
        "OTEL_ATTRIBUTE_COUNT_LIMIT",
        "OTEL_SPAN_ATTRIBUTE_COUNT_LIMIT",
        "OTEL_ATTRIBUTE_VALUE_LENGTH_LIMIT",
        "OTEL_SPAN_ATTRIBUTE_VALUE_LENGTH_LIMIT",
    ],
)
@pytest.mark.parametrize("value", ["-1", "unlimited", "1.5", "invalid"])
def test_invalid_limits_keep_native_validation(
    provider: str, name: str, value: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv(name, value)
    with pytest.raises(ValueError):
        SpanLimits()
    with pytest.raises(ValueError):
        resolve_provider_config(provider, make_provider_config(provider))


@pytest.mark.parametrize("provider", ["arize", "phoenix"])
@pytest.mark.parametrize("limit", [0, 4, 8])
@pytest.mark.parametrize("name", ["OTEL_ATTRIBUTE_VALUE_LENGTH_LIMIT", "OTEL_SPAN_ATTRIBUTE_VALUE_LENGTH_LIMIT"])
def test_native_string_limits_reach_export_without_discarding_structured_values(
    provider: str, limit: int, name: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv(name, str(limit))
    text = "用户甲乙abcdefg"
    native = TracerProvider(shutdown_on_exit=False)
    try:
        span = native.get_tracer("native-limit-contract").start_span(
            "Workflow", attributes={"input.value": text, "string_array": [text, text]}
        )
        assert isinstance(span, ReadableSpan)
        assert span.attributes is not None
        expected_input = span.attributes["input.value"]
        expected_array = span.attributes["string_array"]
        span.end()
    finally:
        native.shutdown()
    trace = make_completed_trace()
    root = trace.spans[0].model_copy(
        update={
            "inputs": text,
            "attributes": {"string_array": [text, text], "structured": {"mixed": [text, 12, True, None]}},
        }
    )
    original = root.model_dump_json()
    client = create_trace_client(provider, resolve_provider_config(provider, make_provider_config(provider)))

    exported = client.build_span(trace, root)

    attributes = {item.key: item.value for item in exported.attributes}
    assert attributes["input.value"].string_value == expected_input
    assert tuple(item.string_value for item in attributes["string_array"].array_value.values) == expected_array
    mixed = attributes["structured"].kvlist_value.values[0].value.array_value.values
    assert mixed[0].string_value == text[:limit]
    assert mixed[1].int_value == 12
    assert mixed[2].bool_value is True
    assert len(mixed) == 4
    assert root.model_dump_json() == original


@pytest.mark.parametrize("provider", ["arize", "phoenix"])
@pytest.mark.parametrize("count", [0, 3, 128])
def test_count_keeps_latest_native_attributes_and_reports_dropped_values(
    provider: str, count: int, monkeypatch: pytest.MonkeyPatch
) -> None:
    trace = make_completed_trace()
    root = trace.spans[0].model_copy(
        update={"attributes": {**{f"field_{index}": index for index in range(150)}, "unused": None}}
    )
    original = root.model_dump_json()
    unbounded = create_trace_client(provider, resolve_provider_config(provider, make_provider_config(provider)))
    full_span = unbounded.build_span(trace, root)
    assert len(full_span.attributes) > 128
    assert not any(attribute.key == "unused" for attribute in full_span.attributes)
    monkeypatch.setenv("OTEL_SPAN_ATTRIBUTE_COUNT_LIMIT", str(count))
    limited = create_trace_client(provider, resolve_provider_config(provider, make_provider_config(provider)))

    limited_span = limited.build_span(trace, root)

    assert list(limited_span.attributes) == list(full_span.attributes)[len(full_span.attributes) - count :]
    assert limited_span.dropped_attributes_count == len(full_span.attributes) - count
    assert root.model_dump_json() == original


@pytest.mark.parametrize("provider", ["arize", "phoenix"])
def test_limit_snapshots_bind_fingerprints_and_isolate_concurrent_tenants(
    provider: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(dify_config, "SECRET_KEY", "span-limit-test")
    traces = [make_completed_trace(), make_completed_trace()]
    configs = []
    for length in ("4", "12"):
        monkeypatch.setenv("OTEL_SPAN_ATTRIBUTE_VALUE_LENGTH_LIMIT", length)
        configs.append(resolve_provider_config(provider, make_provider_config(provider, f"secret-{length}")))
    identity = _settings_hash(traces[0].source.tenant_id, provider_config_identity(provider, configs[0]))
    changed = resolve_provider_config(provider, make_provider_config(provider, "secret-4"))
    assert _settings_hash(traces[0].source.tenant_id, provider_config_identity(provider, changed)) != identity
    monkeypatch.setenv("OTEL_SPAN_ATTRIBUTE_VALUE_LENGTH_LIMIT", "invalid-worker-value")
    config_class = ArizeConfig if provider == "arize" else PhoenixConfig
    monkeypatch.setattr(config_class, "load_runtime_settings", Mock(side_effect=AssertionError("snapshot reread")))
    clients = [create_trace_client(provider, config) for config in configs]
    roots = [trace.spans[0].model_copy(update={"inputs": "abcdefghijklmnop"}) for trace in traces]

    with ThreadPoolExecutor(max_workers=2) as executor:
        requests = [
            executor.submit(client.build_span, trace, root)
            for client, trace, root in zip(clients, traces, roots, strict=True)
        ]
        spans = [request.result() for request in requests]

    for client, trace, root, span, length in zip(clients, traces, roots, spans, (4, 12), strict=True):
        assert span == client.build_span(trace, root)
        assert (
            next(item.value.string_value for item in span.attributes if item.key == "input.value")
            == ("abcdefghijklmnop"[:length])
        )
        assert client.http.headers["authorization"].endswith(f"secret-{length}")
    assert _settings_hash(traces[0].source.tenant_id, provider_config_identity(provider, configs[0])) == identity
