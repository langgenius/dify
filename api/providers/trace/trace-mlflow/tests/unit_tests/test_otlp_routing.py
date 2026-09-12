"""MLflow's collector route remains separate from tracking and artifact delivery."""

import gzip
import json
import zlib
from pathlib import Path
from time import monotonic
from typing import Any
from unittest.mock import Mock
from uuid import UUID

import httpx
import pytest
from dify_trace_mlflow.config import DatabricksConfig, MLflowConfig
from dify_trace_mlflow.mlflow_trace import MLflowTraceClient
from dify_trace_mlflow.otlp_export import MLflowOtlpClient, capture_otlp_settings
from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import ExportTraceServiceRequest
from pydantic import JsonValue

from core.ops.provider_config import provider_config_identity, resolve_provider_config
from core.ops.provider_export import TraceExportError, basic_auth, export_span_id, span_id_bytes

from .test_export_contract import make_provider_config  # pyrefly: ignore[missing-import]
from .test_native_export import make_trace, read_attribute_value  # pyrefly: ignore[missing-import]
from .test_request_auth import install_transport as install_requests_transport  # pyrefly: ignore[missing-import]


def configure_collector(monkeypatch: pytest.MonkeyPatch, *, dual: bool = False) -> None:
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT", "https://collector.example/v1/traces")
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_TRACES_PROTOCOL", "http/protobuf")
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_TRACES_HEADERS", "Authorization=Bearer collector-secret")
    monkeypatch.setenv("MLFLOW_TRACE_ENABLE_OTLP_DUAL_EXPORT", str(dual))


def install_transport(monkeypatch: pytest.MonkeyPatch, requests: list[httpx.Request]) -> None:
    def respond(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if request.url.host == "collector.example" or request.url.path == "/v1/traces":
            return httpx.Response(200, content=b"")
        if "credentials-for-data-upload" in request.url.path:
            return httpx.Response(200, json={"credential_info": {"signed_uri": "https://storage.example/trace"}})
        if request.url.path == "/api/2.0/mlflow/experiments/get":
            return httpx.Response(200, json={})
        return httpx.Response(404 if request.method == "GET" else 200, json={})

    install_requests_transport(monkeypatch, respond)


@pytest.mark.parametrize("provider", ["mlflow", "databricks"])
def test_collector_only_uses_captured_route_and_json_span_attributes(
    provider: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    configure_collector(monkeypatch)
    snapshot = json.dumps(resolve_provider_config(provider, make_provider_config(provider)))
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT", "https://changed.example/traces")
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_TRACES_HEADERS", "Authorization=changed")
    schema = DatabricksConfig if provider == "databricks" else MLflowConfig
    monkeypatch.setattr(schema, "load_runtime_settings", Mock(side_effect=AssertionError("Snapshot reread")))
    requests: list[httpx.Request] = []
    install_transport(monkeypatch, requests)
    trace = make_trace()
    client = MLflowTraceClient(provider, json.loads(snapshot))
    client.http.deadline = monotonic() + 5
    receipts = client.export_trace(trace)
    assert len(requests) == 1
    request = requests[0]
    assert str(request.url) == "https://collector.example/v1/traces"
    assert request.headers["Authorization"] == "Bearer collector-secret"
    assert "x-mlflow-experiment-id" not in request.headers
    assert int(request.headers["content-length"]) == len(request.content) > 0
    assert request.extensions["timeout"]["read"] <= 5
    spans = ExportTraceServiceRequest.FromString(request.content).resource_spans[0].scope_spans[0].spans
    assert len(spans) == len(trace.spans)
    attributes = {item.key: read_attribute_value(item.value) for item in spans[1].attributes}
    assert attributes["mlflow.spanType"] == '"LLM"'
    assert json.loads(str(attributes["mlflow.spanInputs"]))["messages"][0]["content"] == "Rendered prompt"
    assert json.loads(str(attributes["dify.tenant_id"])) == trace.source.tenant_id
    assert receipts.spans[trace.root_span_id] == {
        "trace_id": trace.trace_id,
        "span_id": export_span_id(trace, trace.root_span_id),
        "sampled": True,
    }
    assert client.verify_credentials()
    assert str(requests[-1].url).startswith(f"https://{provider}.example/api/2.0/mlflow/experiments/get")


@pytest.mark.parametrize("provider", ["mlflow", "databricks"])
def test_dual_export_keeps_destination_auth_and_native_payload_separate(
    provider: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    configure_collector(monkeypatch, dual=True)
    requests: list[httpx.Request] = []
    install_transport(monkeypatch, requests)
    trace = make_trace()
    client = MLflowTraceClient(provider, make_provider_config(provider))
    receipts = client.export_trace(trace)
    collector = requests[0]
    assert collector.url.host == "collector.example"
    assert collector.headers["Authorization"] == "Bearer collector-secret"
    native_requests = [request for request in requests if request.url.host == f"{provider}.example"]
    assert native_requests
    assert all(
        request.headers["Authorization"]
        == ("Bearer tenant-secret" if provider == "databricks" else basic_auth("user", "tenant-secret"))
        for request in native_requests
    )
    if provider == "mlflow":
        spans = ExportTraceServiceRequest.FromString(native_requests[-1].content).resource_spans[0].scope_spans[0].spans
        assert {item.key: read_attribute_value(item.value) for item in spans[1].attributes}["mlflow.spanType"] == "LLM"
    else:
        upload = requests[-1]
        assert upload.url.host == "storage.example"
        assert "Authorization" not in upload.headers
    assert all(receipt["otlp_trace_id"] == trace.trace_id for receipt in receipts.spans.values())


@pytest.mark.parametrize("provider", ["mlflow", "databricks"])
@pytest.mark.parametrize("dual", [False, True])
def test_late_collector_children_keep_the_collector_parent_id(
    provider: str, dual: bool, monkeypatch: pytest.MonkeyPatch
) -> None:
    configure_collector(monkeypatch, dual=dual)
    requests: list[httpx.Request] = []
    install_transport(monkeypatch, requests)
    trace = make_trace()
    parent: dict[str, JsonValue] = {
        "trace_id": "12345678-1234-5678-1234-567812345678",
        "span_id": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        "sampled": True,
        "artifact_trace": True,
        "native_trace_id": "tr-12345678123456781234567812345678",
        "otlp_trace_id": "87654321-4321-8765-4321-876543218765",
    }
    if dual:
        monkeypatch.setattr(MLflowTraceClient, "_export_artifact_trace", Mock(return_value=parent["native_trace_id"]))
    receipts = MLflowTraceClient(provider, make_provider_config(provider)).export_trace(trace, parent)
    spans = ExportTraceServiceRequest.FromString(requests[0].content).resource_spans[0].scope_spans[0].spans
    assert spans[0].trace_id == UUID(str(parent["otlp_trace_id"])).bytes
    assert spans[0].parent_span_id == span_id_bytes(str(parent["span_id"]))
    assert spans[1].parent_span_id == spans[0].span_id
    receipt = receipts.spans[trace.root_span_id]
    assert receipt["trace_id"] == (parent["trace_id"] if dual else parent["otlp_trace_id"])


@pytest.mark.parametrize("provider", ["mlflow", "databricks"])
@pytest.mark.parametrize("enabled", ["false", "0", "FALSE"])
def test_disabled_collector_ignores_invalid_unused_exporter_settings(
    provider: str, enabled: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    configure_collector(monkeypatch)
    monkeypatch.setenv("MLFLOW_ENABLE_OTLP_EXPORTER", enabled)
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_TRACES_PROTOCOL", "invalid")
    monkeypatch.setenv("MLFLOW_TRACE_ENABLE_OTLP_DUAL_EXPORT", "invalid")
    assert capture_otlp_settings() == {}
    requests: list[httpx.Request] = []
    install_transport(monkeypatch, requests)
    MLflowTraceClient(provider, make_provider_config(provider)).export_trace(make_trace())
    assert requests
    assert all(request.url.host != "collector.example" for request in requests)


@pytest.mark.parametrize("provider", ["mlflow", "databricks"])
@pytest.mark.parametrize(
    ("name", "value"),
    [
        ("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT", "https://other.example/traces"),
        ("OTEL_EXPORTER_OTLP_TRACES_HEADERS", "Authorization=rotated"),
        ("OTEL_EXPORTER_OTLP_TRACES_TIMEOUT", "4"),
        ("MLFLOW_TRACE_ENABLE_OTLP_DUAL_EXPORT", "true"),
        ("MLFLOW_ENABLE_OTLP_EXPORTER", "false"),
    ],
)
def test_collector_route_and_credentials_change_destination_identity(
    provider: str, name: str, value: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    configure_collector(monkeypatch)
    before = provider_config_identity(provider, resolve_provider_config(provider, make_provider_config(provider)))
    monkeypatch.setenv(name, value)
    after = provider_config_identity(provider, resolve_provider_config(provider, make_provider_config(provider)))
    assert before != after


@pytest.mark.parametrize("compression", ["none", "gzip", "deflate"])
def test_http_collector_keeps_exact_url_headers_compression_and_netrc(
    compression: str, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    configure_collector(monkeypatch)
    monkeypatch.setenv(
        "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT", "https://url:secret@collector.example/custom/?signal=trace"
    )
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_TRACES_HEADERS", "Authorization=ignored,content-type=custom/protobuf")
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_TRACES_COMPRESSION", compression)
    (tmp_path / ".netrc").write_text("machine collector.example login netrc-user password netrc-secret\n")
    settings = capture_otlp_settings()
    requests: list[httpx.Request] = []
    install_transport(monkeypatch, requests)
    config: dict[str, Any] = {**make_provider_config("mlflow"), "_runtime_settings": {"otlp": settings}}
    MLflowTraceClient("mlflow", config).export_trace(make_trace())
    request = requests[0]
    assert str(request.url) == "https://collector.example/custom/?signal=trace"
    assert request.headers["Authorization"] == basic_auth("netrc-user", "netrc-secret")
    assert request.headers.get_list("Content-Type") == ["custom/protobuf"]
    serialized = request.content
    if compression == "gzip":
        serialized = gzip.decompress(serialized)
    elif compression == "deflate":
        serialized = zlib.decompress(serialized)
    assert ExportTraceServiceRequest.FromString(serialized).resource_spans


def test_http_collector_tls_and_timeout_precedence(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    configure_collector(monkeypatch)
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_TIMEOUT", "30")
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_TRACES_TIMEOUT", "0")
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_HEADERS", "x-common=ignored")
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_TRACES_HEADERS", "")
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_CERTIFICATE", "/ignored/missing.pem")
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_TRACES_CERTIFICATE", "")
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_TRACES_CLIENT_KEY", "/ignored/key.pem")
    settings = capture_otlp_settings()
    assert settings["request_timeout"] == "0.0"
    assert settings["headers"]["Content-Type"] == "application/x-protobuf"
    assert settings["headers"]["User-Agent"].startswith("OTel-OTLP-Exporter-Python/")
    assert "x-common" not in settings["headers"]
    assert settings["tls"] == {}
    assert settings["verify"] is False
    ca = tmp_path / "ca.pem"
    ca.write_bytes(b"captured-ca")
    monkeypatch.delenv("OTEL_EXPORTER_OTLP_TRACES_CERTIFICATE")
    monkeypatch.delenv("OTEL_EXPORTER_OTLP_CERTIFICATE")
    monkeypatch.setenv("REQUESTS_CA_BUNDLE", str(ca))
    first = capture_otlp_settings()
    ca.write_bytes(b"rotated-ca")
    second = capture_otlp_settings()
    assert first["requests_tls"] != second["requests_tls"]


def test_collector_partial_success_is_a_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    configure_collector(monkeypatch)
    monkeypatch.setattr(MLflowOtlpClient, "_send", Mock(return_value=b"\x0a\x02\x08\x01"))
    with pytest.raises(TraceExportError, match="provider_rejected_spans"):
        MLflowTraceClient("mlflow", make_provider_config("mlflow")).export_trace(make_trace())
