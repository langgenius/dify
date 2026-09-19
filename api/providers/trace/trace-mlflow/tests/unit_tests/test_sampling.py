from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from typing import Any
from unittest.mock import Mock
from uuid import UUID

import httpx
import pytest
from dify_trace_mlflow.config import DatabricksConfig, MLflowConfig
from dify_trace_mlflow.mlflow_trace import MLflowTraceClient
from opentelemetry.sdk.trace.sampling import TraceIdRatioBased
from pydantic import JsonValue

from core.ops.otlp_trace import OtlpTraceClient
from core.ops.provider_export import TraceExportError
from tests.unit_tests.core.ops.test_provider_export import make_completed_trace

# Pytest importlib mode resolves these hyphenated provider packages.
from .test_export_contract import make_provider_config  # pyrefly: ignore[missing-import]


@pytest.mark.parametrize("provider", ["mlflow", "databricks"])
@pytest.mark.parametrize(
    ("value", "expected"),
    [(None, 1.0), ("0", 0.0), ("0.25", 0.25), ("1", 1.0), ("-1", 1.0), ("2", 1.0), ("NaN", 1.0), ("inf", 1.0)],
)
def test_sampling_ratio_keeps_sdk_default_and_invalid_number_fallback(
    provider: str, value: str | None, expected: float, monkeypatch: pytest.MonkeyPatch
) -> None:
    if value is not None:
        monkeypatch.setenv("MLFLOW_TRACE_SAMPLING_RATIO", value)
    schema = DatabricksConfig if provider == "databricks" else MLflowConfig
    assert schema.load_runtime_settings(make_provider_config(provider))["sampling_ratio"] == expected


@pytest.mark.parametrize("provider", ["mlflow", "databricks"])
@pytest.mark.parametrize("value", ["", " ", "invalid"])
def test_sampling_rejects_unparseable_ratios(provider: str, value: str, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("MLFLOW_TRACE_SAMPLING_RATIO", value)
    schema = DatabricksConfig if provider == "databricks" else MLflowConfig
    with pytest.raises(ValueError):
        schema.load_runtime_settings(make_provider_config(provider))


@pytest.mark.parametrize("provider", ["mlflow", "databricks"])
def test_zero_sampling_snapshot_skips_metadata_auth_and_upload_but_keeps_verification(
    provider: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    config: dict[str, Any] = make_provider_config(provider)
    if provider == "databricks":
        config.update(client_id="client", client_secret="secret")
    schema = DatabricksConfig if provider == "databricks" else MLflowConfig
    monkeypatch.setenv("MLFLOW_TRACE_SAMPLING_RATIO", "0")
    snapshot = schema.load_runtime_settings(config)
    monkeypatch.setenv("MLFLOW_TRACE_SAMPLING_RATIO", "1")
    monkeypatch.setattr(schema, "load_runtime_settings", Mock(side_effect=AssertionError("snapshot reread")))
    trace = make_completed_trace()
    trace = trace.model_copy(
        update={"spans": tuple(span.model_copy(update={"started_at": None, "ended_at": None}) for span in trace.spans)}
    )
    receipts = []
    for _ in range(2):
        client = MLflowTraceClient(provider, {**config, "_runtime_settings": snapshot})
        request = Mock(return_value=httpx.Response(200, json={"access_token": "verification-token"}))
        monkeypatch.setattr(client.http, "request", request)
        authenticate = Mock(wraps=client._authenticate_databricks)
        monkeypatch.setattr(client, "_authenticate_databricks", authenticate)
        receipts.append(client.export_trace(trace))
        request.assert_not_called()
        authenticate.assert_not_called()
        assert all(receipt["sampled"] is False for receipt in receipts[-1].spans.values())
        assert client.verify_credentials()
        assert request.call_count == (2 if provider == "databricks" else 1)
        assert request.call_args.args == ("GET", "api/2.0/mlflow/experiments/get")
    assert receipts[0] == receipts[1]


@pytest.mark.parametrize("route", ["mlflow", "mlflow-artifact", "databricks"])
@pytest.mark.parametrize("external_id", [False, True])
@pytest.mark.parametrize("low_bits", [(1 << 63) - 1, 1 << 63])
def test_fractional_sampling_matches_sdk_and_follows_parent_across_export_routes(
    route: str, external_id: bool, low_bits: int, monkeypatch: pytest.MonkeyPatch
) -> None:
    provider = "databricks" if route == "databricks" else "mlflow"
    artifact = route != "mlflow"
    trace = make_completed_trace()
    trace_id = str(UUID(int=(1 << 64) | low_bits))
    if external_id:
        trace = trace.model_copy(
            update={"source": trace.source.model_copy(update={"external_trace_id": "tr-" + UUID(trace_id).hex})}
        )
    else:
        trace = trace.model_copy(update={"trace_id": trace_id})
    original = trace.model_dump_json()
    expected = TraceIdRatioBased(0.5).should_sample(None, UUID(trace_id).int, "workflow").decision.is_sampled()
    config = {**make_provider_config(provider), "_runtime_settings": {"sampling_ratio": 0.5}}
    authenticate, register, upload, send = Mock(), Mock(), Mock(return_value="tr-" + UUID(trace_id).hex), Mock()
    if route == "mlflow-artifact":
        send.side_effect = TraceExportError("provider_http_501")
    monkeypatch.setattr(MLflowTraceClient, "_authenticate_databricks", authenticate)
    monkeypatch.setattr(MLflowTraceClient, "_register_trace_metadata", register)
    monkeypatch.setattr(MLflowTraceClient, "_export_artifact_trace", upload)
    monkeypatch.setattr(OtlpTraceClient, "send_traces", send)
    receipts = [MLflowTraceClient(provider, config).export_trace(trace) for _ in range(2)]
    assert receipts[0] == receipts[1]
    assert trace.model_dump_json() == original
    assert all(parent["sampled"] is expected for parent in receipts[0].spans.values())
    assert authenticate.call_count == (2 if expected and provider == "databricks" else 0)
    assert upload.call_count == (2 if expected and artifact else 0)
    assert register.call_count == send.call_count == (2 if expected and provider == "mlflow" else 0)

    for mock in (authenticate, register, upload, send):
        mock.reset_mock()
    late = make_completed_trace()
    late = late.model_copy(
        update={
            "source": late.source.model_copy(
                update={"tenant_id": trace.source.tenant_id, "app_id": trace.source.app_id}
            )
        }
    )
    child = MLflowTraceClient(
        provider, {**make_provider_config(provider), "_runtime_settings": {"sampling_ratio": 0.0 if expected else 1.0}}
    )
    child_receipt = child.export_trace(late, receipts[0].spans[trace.root_span_id])
    assert all(parent["sampled"] is expected for parent in child_receipt.spans.values())
    assert authenticate.call_count == upload.call_count == (1 if expected and artifact else 0)
    assert send.call_count == (1 if expected and not artifact else 0)
    register.assert_not_called()


@pytest.mark.parametrize("route", ["mlflow", "mlflow-artifact", "databricks"])
def test_legacy_parent_receipt_already_represents_a_sampled_trace(route: str, monkeypatch: pytest.MonkeyPatch) -> None:
    provider = "databricks" if route == "databricks" else "mlflow"
    artifact = route != "mlflow"
    trace = make_completed_trace()
    parent: dict[str, JsonValue] = {
        "trace_id": str(UUID(int=1)),
        "span_id": str(UUID(int=2)),
        "artifact_trace": artifact,
    }
    client = MLflowTraceClient(
        provider, {**make_provider_config(provider), "_runtime_settings": {"sampling_ratio": 0.0}}
    )
    monkeypatch.setattr(client, "_authenticate_databricks", Mock())
    upload, send = Mock(return_value="tr-" + UUID(int=1).hex), Mock()
    monkeypatch.setattr(client, "_export_artifact_trace", upload)
    monkeypatch.setattr(OtlpTraceClient, "send_traces", send)
    receipt = client.export_trace(trace, parent)
    assert all(span["sampled"] is True for span in receipt.spans.values())
    assert upload.call_count == int(artifact)
    assert send.call_count == int(not artifact)


@pytest.mark.parametrize("provider", ["mlflow", "databricks"])
def test_concurrent_tenants_keep_opposite_sampling_snapshots(provider: str, monkeypatch: pytest.MonkeyPatch) -> None:
    traces = [make_completed_trace(), make_completed_trace()]
    assert traces[0].source.tenant_id != traces[1].source.tenant_id
    clients = []
    auth_calls, metadata_calls, uploads = [], [], []
    for rate in (0, 1):
        config = make_provider_config(provider, secret=f"tenant-{rate}-secret")
        schema = DatabricksConfig if provider == "databricks" else MLflowConfig
        monkeypatch.setenv("MLFLOW_TRACE_SAMPLING_RATIO", str(rate))
        snapshot = schema.load_runtime_settings(config)
        client = MLflowTraceClient(provider, {**config, "_runtime_settings": snapshot})
        auth, metadata, upload = Mock(), Mock(), Mock(return_value="tr-" + UUID(traces[rate].trace_id).hex)
        monkeypatch.setattr(client, "_authenticate_databricks", auth)
        monkeypatch.setattr(client, "_register_trace_metadata", metadata)
        monkeypatch.setattr(client, "_export_artifact_trace", upload)
        clients.append(client)
        auth_calls.append(auth)
        metadata_calls.append(metadata)
        uploads.append(upload)
    send = Mock()
    monkeypatch.setattr(OtlpTraceClient, "send_traces", send)
    barrier = Barrier(2)

    def export(index: int):
        barrier.wait(timeout=5)
        return clients[index].export_trace(traces[index])

    with ThreadPoolExecutor(max_workers=2) as executor:
        receipts = list(executor.map(export, range(2)))
    for call in (auth_calls[0], metadata_calls[0], uploads[0]):
        call.assert_not_called()
    assert metadata_calls[1].call_count == send.call_count == int(provider == "mlflow")
    assert auth_calls[1].call_count == uploads[1].call_count == int(provider == "databricks")
    exported = uploads[1] if provider == "databricks" else metadata_calls[1]
    assert exported.call_args.args[0].source.tenant_id == traces[1].source.tenant_id
    assert all(receipt["sampled"] is False for receipt in receipts[0].spans.values())
    assert all(receipt["sampled"] is True for receipt in receipts[1].spans.values())
