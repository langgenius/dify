"""Retry only unfinished dual destinations, including server-assigned native IDs."""

import json
from typing import Any
from unittest.mock import Mock

import httpx
import pytest
import requests
from dify_trace_mlflow.mlflow_trace import MLflowTraceClient
from dify_trace_mlflow.otlp_export import MLflowOtlpClient
from google.protobuf.message import DecodeError

from core.ops.provider_config import resolve_provider_config
from core.ops.provider_export import TraceExportError, export_span_id
from core.ops.trace_data import ExportedParentSpans

from .test_export_contract import make_provider_config  # pyrefly: ignore[missing-import]
from .test_native_export import make_trace  # pyrefly: ignore[missing-import]
from .test_otlp_routing import configure_collector  # pyrefly: ignore[missing-import]
from .test_request_auth import install_transport  # pyrefly: ignore[missing-import]


def make_state(persisted: dict[str, Any]) -> Mock:
    state = Mock()
    state.has_completed_signal.side_effect = lambda name: name in persisted
    state.completed_signal_receipt.side_effect = lambda name: persisted.get(name)

    def complete(name: str, receipt: dict[str, Any] | None = None) -> None:
        persisted[name] = json.loads(json.dumps(receipt))

    state.complete_signal.side_effect = complete
    return state


@pytest.mark.parametrize("provider", ["mlflow", "databricks"])
@pytest.mark.parametrize("failed_destination", ["collector", "native"])
def test_retry_restores_native_receipts_without_replaying_successful_destination(
    provider: str, failed_destination: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    configure_collector(monkeypatch, dual=True)
    config = json.dumps(resolve_provider_config(provider, make_provider_config(provider)))
    trace = make_trace()
    native_id = "12345678-1234-5678-1234-567812345678"
    native_receipts = ExportedParentSpans(
        spans={
            span.span_id: {
                "trace_id": native_id,
                "span_id": export_span_id(trace, span.span_id),
                "native_trace_id": "tr-12345678123456781234567812345678",
                "artifact_trace": True,
                "sampled": True,
            }
            for span in trace.spans
        }
    )
    failure = TraceExportError("provider_http_503", retryable=True)
    collector = Mock(side_effect=[failure, None] if failed_destination == "collector" else [None])
    native = Mock(side_effect=[failure, native_receipts] if failed_destination == "native" else [native_receipts])
    monkeypatch.setattr(MLflowOtlpClient, "send_traces", collector)
    monkeypatch.setattr(MLflowTraceClient, "_export_native_trace", native)
    persisted: dict[str, Any] = {}
    first = MLflowTraceClient(provider, json.loads(config))
    first.export_state = make_state(persisted)
    with pytest.raises(TraceExportError, match="provider_http_503"):
        first.export_trace(trace)
    assert collector.call_count == native.call_count == 1
    assert set(persisted) == ({"mlflow_native"} if failed_destination == "collector" else {"mlflow_otlp"})
    # Restore both the configuration and delivery progress as a different worker would.
    restored = json.loads(json.dumps(persisted))
    second = MLflowTraceClient(provider, json.loads(config))
    second.export_state = make_state(restored)
    result = second.export_trace(trace)
    assert collector.call_count == (2 if failed_destination == "collector" else 1)
    assert native.call_count == (2 if failed_destination == "native" else 1)
    assert all(receipt["trace_id"] == native_id for receipt in result.spans.values())
    assert all(receipt["otlp_trace_id"] == trace.trace_id for receipt in result.spans.values())
    assert [receipt["span_id"] for receipt in result.spans.values()] == [
        export_span_id(trace, span.span_id) for span in trace.spans
    ]
    assert set(restored) == {"mlflow_otlp", "mlflow_native"}


@pytest.mark.parametrize("provider", ["mlflow", "databricks"])
@pytest.mark.parametrize("collector_error", [TraceExportError("provider_http_400"), DecodeError("malformed response")])
def test_native_delivery_survives_permanent_or_malformed_collector_replies(
    provider: str, collector_error: Exception, monkeypatch: pytest.MonkeyPatch
) -> None:
    configure_collector(monkeypatch, dual=True)
    monkeypatch.setattr(MLflowOtlpClient, "send_traces", Mock(side_effect=collector_error))
    trace = make_trace()
    native = Mock(return_value=ExportedParentSpans(spans={trace.root_span_id: {"trace_id": trace.trace_id}}))
    monkeypatch.setattr(MLflowTraceClient, "_export_native_trace", native)
    client = MLflowTraceClient(provider, make_provider_config(provider))
    persisted: dict[str, Any] = {}
    client.export_state = make_state(persisted)
    with pytest.raises(type(collector_error)):
        client.export_trace(trace)
    native.assert_called_once()
    assert persisted["mlflow_native"]["trace_id"] == trace.trace_id


@pytest.mark.parametrize("collector_retryable", [False, True])
def test_dual_failure_keeps_retryable_destination_eligible(
    collector_retryable: bool, monkeypatch: pytest.MonkeyPatch
) -> None:
    configure_collector(monkeypatch, dual=True)
    monkeypatch.setattr(
        MLflowOtlpClient, "send_traces", Mock(side_effect=TraceExportError("collector", retryable=collector_retryable))
    )
    native = Mock(side_effect=TraceExportError("native", retryable=not collector_retryable))
    monkeypatch.setattr(MLflowTraceClient, "_export_native_trace", native)
    with pytest.raises(TraceExportError) as failure:
        MLflowTraceClient("mlflow", make_provider_config("mlflow")).export_trace(make_trace())
    assert failure.value.retryable
    native.assert_called_once()


def test_expired_checkpoint_prevents_further_provider_writes(monkeypatch: pytest.MonkeyPatch) -> None:
    configure_collector(monkeypatch, dual=True)
    monkeypatch.setattr(MLflowOtlpClient, "send_traces", Mock())
    native = Mock()
    monkeypatch.setattr(MLflowTraceClient, "_export_native_trace", native)
    client = MLflowTraceClient("mlflow", make_provider_config("mlflow"))
    client.export_state = make_state({})
    client.export_state.complete_signal.side_effect = TraceExportError("trace_attempt_expired", retryable=True)
    with pytest.raises(TraceExportError, match="trace_attempt_expired"):
        client.export_trace(make_trace())
    native.assert_not_called()


def test_collector_timeout_reserves_native_time_and_retry_uses_the_full_deadline(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    configure_collector(monkeypatch, dual=True)
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_TRACES_TIMEOUT", "200")
    now = [1000.0]
    for module in ("core.ops.provider_export", "dify_trace_mlflow.mlflow_trace", "dify_trace_mlflow.request_auth"):
        monkeypatch.setattr(module + ".monotonic", lambda: now[0])
    collector_timeouts: list[float] = []
    native_requests: list[httpx.Request] = []

    def respond(request: httpx.Request) -> httpx.Response:
        if request.url.host == "collector.example":
            timeout = request.extensions["timeout"]["read"]
            collector_timeouts.append(timeout)
            if len(collector_timeouts) == 1:
                now[0] += timeout
                raise requests.Timeout("Collector timeout")
            return httpx.Response(200)
        native_requests.append(request)
        return httpx.Response(404 if request.method == "GET" else 200)

    install_transport(monkeypatch, respond)
    persisted: dict[str, Any] = {}
    trace = make_trace()
    client = MLflowTraceClient("mlflow", make_provider_config("mlflow"))
    client.export_state = make_state(persisted)
    with pytest.raises(TraceExportError, match="provider_unreachable"):
        client.export_trace(trace)
    assert len(native_requests) == 3
    assert "mlflow_native" in persisted
    retry = MLflowTraceClient("mlflow", make_provider_config("mlflow"))
    retry.export_state = make_state(json.loads(json.dumps(persisted)))
    retry.export_trace(trace)
    assert len(native_requests) == 3
    assert collector_timeouts == [50.0, 100.0]
