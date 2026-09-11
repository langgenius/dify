"""Explicit deployment span limits remain captured and separate from metrics and trace storage."""

import json
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import Mock

import pytest
from dify_trace_tencent import config as tencent_config
from dify_trace_tencent.tencent_trace import create_trace_client
from opentelemetry.context import Context
from opentelemetry.sdk.trace import Span as SdkSpan
from opentelemetry.sdk.trace import SpanLimits, TracerProvider
from pydantic import JsonValue

from core.ops.otlp_trace import otlp_value
from core.ops.provider_config import provider_config_identity, resolve_provider_config
from core.ops.trace_data import CompletedTrace
from tests.unit_tests.core.ops.test_provider_export import (
    isolate_deployment_settings,  # noqa: F401
    make_completed_trace,
)

# Pytest importlib mode resolves these hyphenated provider packages.
from .test_export_contract import make_provider_config  # pyrefly: ignore[missing-import]

LIMIT_SETTINGS = (
    "OTEL_ATTRIBUTE_COUNT_LIMIT",
    "OTEL_SPAN_ATTRIBUTE_COUNT_LIMIT",
    "OTEL_ATTRIBUTE_VALUE_LENGTH_LIMIT",
    "OTEL_SPAN_ATTRIBUTE_VALUE_LENGTH_LIMIT",
)


@pytest.mark.parametrize(
    "environment",
    [
        {"OTEL_SPAN_ATTRIBUTE_VALUE_LENGTH_LIMIT": "8"},
        {"OTEL_ATTRIBUTE_VALUE_LENGTH_LIMIT": "8"},
        {"OTEL_SPAN_ATTRIBUTE_VALUE_LENGTH_LIMIT": "0"},
        {"OTEL_ATTRIBUTE_VALUE_LENGTH_LIMIT": "3", "OTEL_SPAN_ATTRIBUTE_VALUE_LENGTH_LIMIT": "8"},
        {"OTEL_ATTRIBUTE_VALUE_LENGTH_LIMIT": "8", "OTEL_SPAN_ATTRIBUTE_VALUE_LENGTH_LIMIT": ""},
        {"OTEL_SPAN_ATTRIBUTE_COUNT_LIMIT": "2"},
        {"OTEL_ATTRIBUTE_COUNT_LIMIT": "2"},
        {"OTEL_SPAN_ATTRIBUTE_COUNT_LIMIT": "0"},
        {"OTEL_ATTRIBUTE_COUNT_LIMIT": "1", "OTEL_SPAN_ATTRIBUTE_COUNT_LIMIT": "2"},
        {"OTEL_ATTRIBUTE_COUNT_LIMIT": "2", "OTEL_SPAN_ATTRIBUTE_COUNT_LIMIT": ""},
        {"OTEL_ATTRIBUTE_COUNT_LIMIT": ""},
        {"OTEL_SPAN_ATTRIBUTE_COUNT_LIMIT": " \t "},
        {"OTEL_SPAN_ATTRIBUTE_VALUE_LENGTH_LIMIT": " \t "},
        {"OTEL_ATTRIBUTE_COUNT_LIMIT": "2", "OTEL_SPAN_ATTRIBUTE_VALUE_LENGTH_LIMIT": "8"},
    ],
)
def test_explicit_limits_match_native_projection_and_captured_configuration(
    environment: dict[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    trace = make_completed_trace()
    config = resolve_provider_config("tencent", make_provider_config())
    full_span = create_trace_client(config).build_span(trace, trace.spans[0])
    full_attributes = {item.key: item.value for item in full_span.attributes}
    for name, value in environment.items():
        monkeypatch.setenv(name, value)
    native = TracerProvider(shutdown_on_exit=False)
    try:
        native_span = native.get_tracer("native-tencent").start_span("operation", context=Context())
        assert isinstance(native_span, SdkSpan)
        # The previous Tencent client submitted every non-primitive value as a string.
        native_span.set_attributes(
            {
                key: value.string_value if value.HasField("string_value") else "native-value"
                for key, value in full_attributes.items()
            }
        )
        expected_keys = list(native_span.attributes or {})
        expected_input = (native_span.attributes or {}).get("gen_ai.entity.input")
        expected_dropped = native_span.dropped_attributes
        native_span.end()
    finally:
        native.shutdown()
    limits = SpanLimits()
    config = resolve_provider_config("tencent", make_provider_config())
    assert config["_runtime_settings"]["span_limits"] == {
        "max_attributes": limits.max_span_attributes
        if any(name in environment for name in LIMIT_SETTINGS[:2])
        else None,
        "max_value_length": limits.max_span_attribute_length
        if any(name in environment for name in LIMIT_SETTINGS[2:])
        else None,
    }
    assert json.loads(json.dumps(config)) == config
    identity = provider_config_identity("tencent", config)
    monkeypatch.setenv("OTEL_SPAN_ATTRIBUTE_COUNT_LIMIT", "7")
    monkeypatch.setenv("OTEL_SPAN_ATTRIBUTE_VALUE_LENGTH_LIMIT", "9")
    changed = resolve_provider_config("tencent", make_provider_config())
    assert provider_config_identity("tencent", changed) != identity
    monkeypatch.setattr(
        tencent_config.TencentConfig, "load_runtime_settings", Mock(side_effect=AssertionError("snapshot reread"))
    )
    monkeypatch.setattr(tencent_config, "SpanLimits", Mock(side_effect=AssertionError("worker parsed limits")))

    limited_span = create_trace_client(config).build_span(trace, trace.spans[0])

    actual = {item.key: item.value for item in limited_span.attributes}
    assert list(actual) == expected_keys
    assert limited_span.dropped_attributes_count == expected_dropped
    if expected_input is not None:
        assert actual["gen_ai.entity.input"].string_value == expected_input


@pytest.mark.parametrize("setting", LIMIT_SETTINGS)
@pytest.mark.parametrize("value", ["unlimited", "invalid", "-1", "1.5", "nan"])
def test_invalid_explicit_limit_preserves_native_error(
    setting: str, value: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv(setting, value)
    with pytest.raises(ValueError) as expected:
        SpanLimits()
    with pytest.raises(ValueError) as actual:
        resolve_provider_config("tencent", make_provider_config())
    assert str(actual.value) == str(expected.value)


def test_default_and_length_only_keep_more_than_128_captured_attributes(monkeypatch: pytest.MonkeyPatch) -> None:
    trace = make_completed_trace()
    root = trace.spans[0].model_copy(
        update={"attributes": {f"attribute-{index}": "long value" for index in range(150)}}
    )
    trace = trace.model_copy(update={"spans": (root, *trace.spans[1:])})
    config = resolve_provider_config("tencent", make_provider_config())
    assert config["_runtime_settings"]["span_limits"] == {}
    full_span = create_trace_client(config).build_span(trace, root)
    assert len(full_span.attributes) > 150
    assert full_span.dropped_attributes_count == 0
    monkeypatch.setenv("OTEL_SPAN_ATTRIBUTE_VALUE_LENGTH_LIMIT", "4")

    limited_span = create_trace_client(make_provider_config()).build_span(trace, root)

    assert len(limited_span.attributes) == len(full_span.attributes)
    assert limited_span.dropped_attributes_count == 0
    assert next(item.value.string_value for item in limited_span.attributes if item.key == "attribute-0") == "long"


@pytest.mark.parametrize("count", ["2", ""])
def test_count_limit_filters_missing_values_before_retaining_latest_attributes(
    count: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    trace = make_completed_trace()
    full_span = create_trace_client(make_provider_config()).build_span(trace, trace.spans[0])
    monkeypatch.setenv("OTEL_SPAN_ATTRIBUTE_COUNT_LIMIT", count)

    limited_span = create_trace_client(make_provider_config()).build_span(trace, trace.spans[0])

    assert limited_span.attributes == (full_span.attributes[-2:] if count == "2" else full_span.attributes)
    assert limited_span.dropped_attributes_count == (len(full_span.attributes) - 2 if count == "2" else 0)


def test_unicode_arrays_and_structured_values_keep_content_and_metric_inputs(monkeypatch: pytest.MonkeyPatch) -> None:
    trace = make_completed_trace()
    values: dict[str, JsonValue] = {
        "unicode": "天地玄黄🌟✨",
        "strings": ["abcdef", "天地玄黄🌟✨"],
        "structured": {"mixed": ["abcdef", 3, True, None, {"text": "天地玄黄🌟✨"}]},
    }
    root = trace.spans[0].model_copy(update={"attributes": values, "inputs": values, "outputs": values})
    trace = trace.model_copy(update={"spans": (root, *trace.spans[1:])})
    serialized = trace.model_dump_json()
    full_client = create_trace_client(make_provider_config())
    full_metrics = full_client.build_metrics(trace)
    monkeypatch.setenv("OTEL_SPAN_ATTRIBUTE_VALUE_LENGTH_LIMIT", "4")
    limited_client = create_trace_client(make_provider_config())

    span = limited_client.build_span(trace, root)

    actual = {item.key: item.value for item in span.attributes}
    expected: dict[str, JsonValue] = {
        "unicode": "天地玄黄",
        "strings": ["abcd", "天地玄黄"],
        "structured": {"mixed": ["abcd", 3, True, None, {"text": "天地玄黄"}]},
    }
    for key, value in expected.items():
        assert actual[key] == otlp_value(value)
    assert actual["dify.inputs"] == otlp_value(expected)
    assert actual["dify.outputs"] == otlp_value(expected)
    assert limited_client.build_metrics(trace) == full_metrics
    assert trace.model_dump_json() == serialized


def test_concurrent_tenants_keep_captured_limits_and_credentials(monkeypatch: pytest.MonkeyPatch) -> None:
    operations: list[tuple[CompletedTrace, dict[str, JsonValue], int]] = []
    for length in (3, 8):
        trace = make_completed_trace()
        monkeypatch.setenv("OTEL_SPAN_ATTRIBUTE_VALUE_LENGTH_LIMIT", str(length))
        config = resolve_provider_config("tencent", make_provider_config(trace.source.tenant_id))
        operations.append((trace, config, length))
    monkeypatch.setenv("OTEL_SPAN_ATTRIBUTE_VALUE_LENGTH_LIMIT", "0")
    monkeypatch.setattr(
        tencent_config.TencentConfig, "load_runtime_settings", Mock(side_effect=AssertionError("snapshot reread"))
    )

    def project(operation: tuple[CompletedTrace, dict[str, JsonValue], int]) -> tuple[int, str]:
        trace, config, _ = operation
        client = create_trace_client(config)
        span = client.build_span(trace, trace.spans[0])
        value = next(item.value.string_value for item in span.attributes if item.key == "gen_ai.entity.input")
        return len(value), client.http.headers["authorization"]

    with ThreadPoolExecutor(max_workers=2) as executor:
        assert list(executor.map(project, operations)) == [
            (length, f"Bearer {trace.source.tenant_id}") for trace, _, length in operations
        ]


def test_older_snapshot_does_not_inherit_worker_limits(monkeypatch: pytest.MonkeyPatch) -> None:
    trace = make_completed_trace()
    config = resolve_provider_config("tencent", make_provider_config())
    config["_runtime_settings"].pop("span_limits", None)
    full_span = create_trace_client(config).build_span(trace, trace.spans[0])
    monkeypatch.setenv("OTEL_SPAN_ATTRIBUTE_COUNT_LIMIT", "0")
    monkeypatch.setenv("OTEL_SPAN_ATTRIBUTE_VALUE_LENGTH_LIMIT", "0")

    assert create_trace_client(config).build_span(trace, trace.spans[0]) == full_span
