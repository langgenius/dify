"""Compare captured sampling with the native SDK without sending trace content."""

import json
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import Mock
from uuid import UUID

import pytest
from dify_trace_arize_phoenix.arize_phoenix_trace import OpenInferenceTraceClient, create_trace_client
from dify_trace_arize_phoenix.config import ArizeConfig, PhoenixConfig
from opentelemetry.context import Context
from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import ExportTraceServiceRequest
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.id_generator import RandomIdGenerator
from opentelemetry.trace import NonRecordingSpan, SpanContext, TraceFlags, set_span_in_context
from pydantic import JsonValue

from configs import dify_config
from core.ops.provider_config import provider_config_identity, resolve_provider_config
from core.ops.provider_export import span_id_bytes
from core.ops.trace_source import _settings_hash
from tests.unit_tests.core.ops.test_provider_export import (
    isolate_deployment_settings,  # noqa: F401
    make_completed_trace,
)

from .test_export_contract import make_provider_config  # pyrefly: ignore[missing-import]


@pytest.mark.parametrize("provider", ["arize", "phoenix"])
@pytest.mark.parametrize(
    ("name", "argument"),
    [
        (None, None),
        ("ALWAYS_OFF", "unused"),
        (" always_off ", "0"),
        ("unknown", "0"),
        ("", None),
        ("traceidratio", None),
        ("traceidratio", "invalid"),
        ("traceidratio", "0"),
        ("traceidratio", "1"),
        ("traceidratio", " 0.25 "),
        ("parentbased_traceidratio", "0.75"),
    ],
)
def test_captured_settings_keep_native_sampler_parsing(
    provider: str, name: str | None, argument: str | None, monkeypatch: pytest.MonkeyPatch
) -> None:
    if name is not None:
        monkeypatch.setenv("OTEL_TRACES_SAMPLER", name)
    if argument is not None:
        monkeypatch.setenv("OTEL_TRACES_SAMPLER_ARG", argument)
    native = TracerProvider(shutdown_on_exit=False)
    try:
        captured = resolve_provider_config(provider, make_provider_config(provider))
        assert json.loads(json.dumps(captured)) == captured
        monkeypatch.setenv("OTEL_TRACES_SAMPLER", "always_on")
        client = create_trace_client(provider, captured)

        assert client.sampler.get_description() == native.sampler.get_description()
    finally:
        native.shutdown()


@pytest.mark.parametrize("provider", ["arize", "phoenix"])
@pytest.mark.parametrize("name", ["traceidratio", "parentbased_traceidratio"])
@pytest.mark.parametrize("argument", ["-0.01", "1.01", "nan", "inf", "-inf"])
def test_invalid_native_ratios_are_rejected_when_capturing_settings(
    provider: str, name: str, argument: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("OTEL_TRACES_SAMPLER", name)
    monkeypatch.setenv("OTEL_TRACES_SAMPLER_ARG", argument)
    with pytest.raises(ValueError):
        TracerProvider(shutdown_on_exit=False)
    with pytest.raises(ValueError):
        resolve_provider_config(provider, make_provider_config(provider))


@pytest.mark.parametrize("provider", ["arize", "phoenix"])
@pytest.mark.parametrize(
    "name",
    [
        "always_on",
        "always_off",
        "parentbased_always_on",
        "parentbased_always_off",
        "traceidratio",
        "parentbased_traceidratio",
    ],
)
@pytest.mark.parametrize("trace_id", [1, (1 << 64) - 1])
@pytest.mark.parametrize("parent_sampled", [None, False, True, "legacy"])
def test_export_and_late_children_keep_native_parent_and_ratio_decisions(
    provider: str, name: str, trace_id: int, parent_sampled: bool | str | None, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("OTEL_TRACES_SAMPLER", name)
    monkeypatch.setenv("OTEL_TRACES_SAMPLER_ARG", "0.5")
    trace = make_completed_trace()
    trace = trace.model_copy(
        update={"source": trace.source.model_copy(update={"external_trace_id": str(UUID(int=trace_id))})}
    )
    parent: dict[str, JsonValue] | None = None
    parent_context = Context()
    if parent_sampled is not None:
        parent = {"trace_id": str(UUID(int=trace_id)), "span_id": str(UUID(int=2 << 64))}
        if isinstance(parent_sampled, bool):
            parent["sampled"] = parent_sampled
        parent_context = set_span_in_context(
            NonRecordingSpan(SpanContext(trace_id, 2, True, TraceFlags(int(parent_sampled is not False)))),
            Context(),
        )
    native = TracerProvider(shutdown_on_exit=False)
    monkeypatch.setattr(native.id_generator, "generate_trace_id", lambda: trace_id)
    try:
        native_root = native.get_tracer("sampling-contract").start_span("Workflow", context=parent_context)
        sampled = native_root.get_span_context().trace_flags.sampled
        native_child = native.get_tracer("sampling-contract").start_span(
            "Model", context=set_span_in_context(native_root, Context())
        )
        assert native_child.get_span_context().trace_flags.sampled is sampled
        native_child.end()
        native_root.end()
    finally:
        native.shutdown()
    captured = resolve_provider_config(provider, make_provider_config(provider))
    # A worker cannot replace the captured sampler or its argument.
    monkeypatch.setenv("OTEL_TRACES_SAMPLER", "traceidratio")
    monkeypatch.setenv("OTEL_TRACES_SAMPLER_ARG", "-1")
    config_class = ArizeConfig if provider == "arize" else PhoenixConfig
    monkeypatch.setattr(config_class, "load_runtime_settings", Mock(side_effect=AssertionError("snapshot reread")))
    send = Mock(return_value=b"")
    monkeypatch.setattr(OpenInferenceTraceClient, "_send", send)
    client = create_trace_client(provider, captured)

    receipts = client.export_trace(trace, parent)

    assert send.call_count == int(sampled)
    assert all(receipt["sampled"] is sampled for receipt in receipts.spans.values())
    assert client.export_trace(trace, parent) == receipts
    late_parent = json.loads(json.dumps(receipts.spans[trace.spans[1].span_id]))
    late_trace = make_completed_trace()
    late_trace = late_trace.model_copy(
        update={"source": late_trace.source.model_copy(update={"tenant_id": trace.source.tenant_id})}
    )
    late = create_trace_client(provider, captured).export_trace(late_trace, late_parent)
    assert all(receipt["sampled"] is sampled for receipt in late.spans.values())
    if sampled:
        assert send.call_count == 3
        request = ExportTraceServiceRequest.FromString(send.call_args.args[1])
        spans = request.resource_spans[0].scope_spans[0].spans
        assert len(spans) == len(late_trace.spans)
        assert spans[0].parent_span_id == span_id_bytes(str(late_parent["span_id"]))
        assert all(span.trace_id == UUID(int=trace_id).bytes and span.flags & 1 for span in spans)
    else:
        send.assert_not_called()


@pytest.mark.parametrize("provider", ["arize", "phoenix"])
@pytest.mark.parametrize(
    "name",
    [
        "always_off",
        "always_on",
        "parentbased_always_off",
        "parentbased_always_on",
        "traceidratio",
        "parentbased_traceidratio",
    ],
)
@pytest.mark.parametrize("trace_id", [1, (1 << 64) - 1])
def test_credential_probe_obeys_native_root_sampling(
    provider: str, name: str, trace_id: int, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("OTEL_TRACES_SAMPLER", name)
    monkeypatch.setenv("OTEL_TRACES_SAMPLER_ARG", "0.5")
    native = TracerProvider(shutdown_on_exit=False)
    try:
        sampled = native.sampler.should_sample(Context(), trace_id, "api_check").decision.is_sampled()
    finally:
        native.shutdown()
    captured = resolve_provider_config(provider, make_provider_config(provider))
    monkeypatch.setenv("OTEL_TRACES_SAMPLER", "always_on" if not sampled else "always_off")
    monkeypatch.setattr(RandomIdGenerator, "generate_trace_id", lambda self: trace_id)
    send = Mock(return_value=b"")
    monkeypatch.setattr(OpenInferenceTraceClient, "_send", send)

    assert create_trace_client(provider, captured).verify_credentials()

    assert send.call_count == int(sampled)


@pytest.mark.parametrize("provider", ["arize", "phoenix"])
def test_sampling_settings_bind_identity_and_isolate_concurrent_attempts(
    provider: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(dify_config, "SECRET_KEY", "sampling-test")
    first_trace, second_trace = make_completed_trace(), make_completed_trace()
    configs = []
    for sampler, secret in [("always_off", "first-secret"), ("always_on", "second-secret")]:
        monkeypatch.setenv("OTEL_TRACES_SAMPLER", sampler)
        configs.append(resolve_provider_config(provider, make_provider_config(provider, secret)))
    fingerprint = _settings_hash(first_trace.source.tenant_id, provider_config_identity(provider, configs[0]))
    changed = resolve_provider_config(provider, make_provider_config(provider, "first-secret"))
    assert _settings_hash(first_trace.source.tenant_id, provider_config_identity(provider, changed)) != fingerprint
    monkeypatch.setenv("OTEL_TRACES_SAMPLER", "traceidratio")
    ratio_fingerprints = []
    for ratio in ("0", "1"):
        monkeypatch.setenv("OTEL_TRACES_SAMPLER_ARG", ratio)
        ratio_config = resolve_provider_config(provider, make_provider_config(provider))
        ratio_fingerprints.append(
            _settings_hash(first_trace.source.tenant_id, provider_config_identity(provider, ratio_config))
        )
    assert ratio_fingerprints[0] != ratio_fingerprints[1]
    monkeypatch.setenv("OTEL_TRACES_SAMPLER_ARG", "-1")
    send = Mock(return_value=b"")
    monkeypatch.setattr(OpenInferenceTraceClient, "_send", send)
    clients = [create_trace_client(provider, config) for config in configs * 3]

    with ThreadPoolExecutor(max_workers=2) as executor:
        attempts = [
            executor.submit(client.export_trace, trace)
            for client, trace in zip(clients, [first_trace, second_trace] * 3, strict=True)
        ]
        receipts = [attempt.result() for attempt in attempts]

    assert receipts[0] == receipts[2] == receipts[4]
    assert receipts[1] == receipts[3] == receipts[5]
    assert send.call_count == 3
    assert all("second-secret" in client.http.headers["authorization"] for client in clients[1::2])
    assert all("first-secret" in client.http.headers["authorization"] for client in clients[::2])
    assert all(not receipt["sampled"] for receipt in receipts[0].spans.values())
    assert all(receipt["sampled"] for receipt in receipts[1].spans.values())
    assert all(
        str(second_trace.source.tenant_id).encode() in call.args[1]
        and str(first_trace.source.tenant_id).encode() not in call.args[1]
        for call in send.call_args_list
    )
    assert _settings_hash(first_trace.source.tenant_id, provider_config_identity(provider, configs[0])) == fingerprint


@pytest.mark.parametrize("provider", ["arize", "phoenix"])
def test_disabled_parent_takes_precedence_over_always_on(provider: str, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OTEL_TRACES_SAMPLER", "always_on")
    client = create_trace_client(provider, resolve_provider_config(provider, make_provider_config(provider)))
    send = Mock(side_effect=AssertionError("disabled parent exported"))
    monkeypatch.setattr(client, "_send", send)
    trace = make_completed_trace()
    parent: dict[str, JsonValue] = {
        "trace_id": trace.trace_id,
        "span_id": trace.root_span_id,
        "sampled": True,
        "disabled": True,
    }

    receipts = client.export_trace(trace, parent)

    assert all(receipt["sampled"] is False and receipt["disabled"] is True for receipt in receipts.spans.values())
    send.assert_not_called()
