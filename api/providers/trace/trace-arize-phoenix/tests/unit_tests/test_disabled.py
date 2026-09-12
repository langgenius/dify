"""Keep native SDK suppression bound to each queued OpenInference export."""

import json
import os
from unittest.mock import Mock
from uuid import uuid4

import pytest
from dify_trace_arize_phoenix.arize_phoenix_trace import OpenInferenceTraceClient, create_trace_client
from dify_trace_arize_phoenix.config import ArizeConfig, PhoenixConfig
from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import ExportTraceServiceRequest
from opentelemetry.sdk.trace import TracerProvider

from configs import dify_config
from core.ops.provider_config import provider_config_identity, resolve_provider_config
from core.ops.trace_source import _settings_hash
from tests.unit_tests.core.ops.test_provider_export import make_completed_trace

from .test_export_contract import make_provider_config  # pyrefly: ignore[missing-import]


@pytest.fixture(autouse=True)
def clear_otlp_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in tuple(os.environ):
        if name.startswith("OTEL_EXPORTER_OTLP") or name in {
            "OTEL_SDK_DISABLED",
            "REQUESTS_CA_BUNDLE",
            "CURL_CA_BUNDLE",
        }:
            monkeypatch.delenv(name)


@pytest.mark.parametrize("provider", ["arize", "phoenix"])
@pytest.mark.parametrize("setting", [None, "", "true", "TRUE", " TrUe ", "false", "1", "yes"])
def test_disabled_setting_matches_native_sdk_parser(
    provider: str, setting: str | None, monkeypatch: pytest.MonkeyPatch
) -> None:
    if setting is not None:
        monkeypatch.setenv("OTEL_SDK_DISABLED", setting)
    captured = resolve_provider_config(provider, make_provider_config(provider))
    native = TracerProvider()
    try:
        assert captured["_runtime_settings"]["disabled"] is native._disabled
    finally:
        native.shutdown()


@pytest.mark.parametrize("provider", ["arize", "phoenix"])
def test_disabled_snapshot_skips_export_and_probe_and_keeps_late_parent_receipts(
    provider: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(dify_config, "SECRET_KEY", "openinference-disabled-test")
    config = make_provider_config(provider)
    monkeypatch.setenv("OTEL_SDK_DISABLED", "true")
    captured = json.loads(json.dumps(resolve_provider_config(provider, config)))
    tenant_id = str(uuid4())
    fingerprint = _settings_hash(tenant_id, provider_config_identity(provider, captured))
    monkeypatch.setenv("OTEL_SDK_DISABLED", "false")
    enabled = resolve_provider_config(provider, config)
    assert _settings_hash(tenant_id, provider_config_identity(provider, enabled)) != fingerprint
    config_class = ArizeConfig if provider == "arize" else PhoenixConfig
    monkeypatch.setattr(config_class, "load_runtime_settings", Mock(side_effect=AssertionError("snapshot reread")))
    send = Mock(side_effect=AssertionError("disabled tracing sent an OTLP request"))
    monkeypatch.setattr(OpenInferenceTraceClient, "_send", send)
    client = create_trace_client(provider, captured)
    trace = make_completed_trace()

    receipts = client.export_trace(trace)

    assert client.export_trace(trace) == receipts
    assert client.verify_credentials()
    assert set(receipts.spans) == {span.span_id for span in trace.spans}
    assert all(receipt["disabled"] is True for receipt in receipts.spans.values())
    parent = receipts.spans[trace.root_span_id]
    child = make_completed_trace()
    child = child.model_copy(update={"source": child.source.model_copy(update={"tenant_id": trace.source.tenant_id})})
    late_receipts = create_trace_client(provider, enabled).export_trace(child, parent)
    assert all(
        receipt["disabled"] is True and receipt["trace_id"] == parent["trace_id"]
        for receipt in late_receipts.spans.values()
    )
    assert client.export_trace(trace) == receipts
    send.assert_not_called()
    assert _settings_hash(tenant_id, provider_config_identity(provider, captured)) == fingerprint


@pytest.mark.parametrize("provider", ["arize", "phoenix"])
def test_enabled_snapshot_exports_and_probes_after_worker_environment_changes(
    provider: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    captured = json.loads(json.dumps(resolve_provider_config(provider, make_provider_config(provider))))
    monkeypatch.setenv("OTEL_SDK_DISABLED", "true")
    config_class = ArizeConfig if provider == "arize" else PhoenixConfig
    monkeypatch.setattr(config_class, "load_runtime_settings", Mock(side_effect=AssertionError("snapshot reread")))
    send = Mock(return_value=b"")
    monkeypatch.setattr(OpenInferenceTraceClient, "_send", send)
    client = create_trace_client(provider, captured)
    trace = make_completed_trace()

    assert client.verify_credentials()
    receipts = client.export_trace(trace)

    assert all("disabled" not in receipt for receipt in receipts.spans.values())
    assert send.call_count == 2
    assert all(call.args[0] == "trace" for call in send.call_args_list)
    exported = ExportTraceServiceRequest.FromString(send.call_args.args[1])
    assert len(exported.resource_spans[0].scope_spans[0].spans) == len(trace.spans)
