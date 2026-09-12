"""Pinned exporter settings and credential factories cross queues without shared clients."""

import base64
import json
import ssl
import sys
from collections.abc import Callable
from pathlib import Path
from time import monotonic
from types import ModuleType
from typing import Any
from unittest.mock import MagicMock, Mock

import grpc  # pyrefly: ignore[untyped-import]
import httpx
import pytest
import requests
from dify_trace_mlflow.mlflow_trace import MLflowTraceClient
from dify_trace_mlflow.otlp_export import capture_otlp_settings
from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import ExportTraceServiceRequest
from requests.auth import HTTPBasicAuth

from configs import dify_config
from core.ops.provider_config import provider_config_identity, resolve_provider_config
from core.ops.provider_export import TraceExportError, basic_auth

from .test_artifact_tls import handshake, server_certificate  # pyrefly: ignore[missing-import]
from .test_export_contract import make_provider_config  # pyrefly: ignore[missing-import]
from .test_native_export import make_trace, read_attribute_value  # pyrefly: ignore[missing-import]
from .test_otlp_routing import configure_collector  # pyrefly: ignore[missing-import]
from .test_request_auth import install_transport  # pyrefly: ignore[missing-import]


@pytest.mark.parametrize(
    ("endpoint", "insecure", "secure", "target"),
    [
        ("collector.example:4317", None, True, "collector.example:4317"),
        ("http://collector.example", None, False, "collector.example"),
        ("https://collector.example/path", "true", True, "collector.example"),
        ("http://collector.example:4317/path", "false", True, "collector.example:4317"),
        ("collector.example:4317", "true", False, "collector.example:4317"),
        ("dns:///collector.example:4317", None, True, "dns:///collector.example:4317"),
    ],
)
def test_grpc_default_protocol_target_security_compression_and_timeout(
    endpoint: str, insecure: str | None, secure: bool, target: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT", endpoint)
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_TRACES_HEADERS", "")
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_HEADERS", "authorization=Bearer%20grpc-secret")
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_TIMEOUT", "15")
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_TRACES_TIMEOUT", "0")
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_TRACES_COMPRESSION", " GZIP ")
    if insecure is not None:
        monkeypatch.setenv("OTEL_EXPORTER_OTLP_TRACES_INSECURE", insecure)
    for name in ("SSRF_PROXY_ALL_URL", "SSRF_PROXY_HTTP_URL", "SSRF_PROXY_HTTPS_URL"):
        monkeypatch.setattr(dify_config, name, "")
    send = Mock(return_value=b"")
    channel = MagicMock()
    channel.unary_unary.return_value = send
    secure_channel, insecure_channel = Mock(return_value=channel), Mock(return_value=channel)
    monkeypatch.setattr(grpc, "secure_channel", secure_channel)
    monkeypatch.setattr(grpc, "insecure_channel", insecure_channel)
    client = MLflowTraceClient("mlflow", make_provider_config("mlflow"))
    client.http.deadline = monotonic() + 4
    client.export_trace(make_trace())
    opened, unused = (secure_channel, insecure_channel) if secure else (insecure_channel, secure_channel)
    assert opened.call_args.args[0] == target
    assert opened.call_args.kwargs["compression"] == grpc.Compression.Gzip
    unused.assert_not_called()
    assert send.call_args.kwargs["timeout"] <= 4
    assert send.call_args.kwargs["metadata"] == (("authorization", "Bearer grpc-secret"),)
    assert client.otlp is not None
    assert client.otlp.http.request_timeout == 15


@pytest.mark.parametrize("compression", ["", "none", "deflate", "invalid"])
def test_grpc_rejects_present_unsupported_compression(compression: str, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "https://collector.example")
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_COMPRESSION", "gzip")
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_TRACES_COMPRESSION", compression)
    with pytest.raises(ValueError, match="compression"):
        capture_otlp_settings()


def test_base_endpoint_and_trace_protocol_fallback(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "https://collector.example/prefix/")
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT", "")
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_PROTOCOL", "http/protobuf")
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_TRACES_PROTOCOL", "")
    assert capture_otlp_settings()["endpoint"] == "https://collector.example/prefix/v1/traces"
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_PROTOCOL", "")
    with pytest.raises(ValueError, match="protocol"):
        capture_otlp_settings()


def test_tls_contents_are_captured_for_http_and_grpc(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    configure_collector(monkeypatch)
    ca, certificate, server_context = server_certificate(tmp_path / "collector")
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_CERTIFICATE", "/ignored/common.pem")
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_TRACES_CERTIFICATE", str(ca))
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_TRACES_CLIENT_CERTIFICATE", str(certificate))
    snapshot = resolve_provider_config("mlflow", make_provider_config("mlflow"))
    assert snapshot["_runtime_settings"]["otlp"]["tls"]["certificate"] == base64.b64encode(ca.read_bytes()).decode()
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_TRACES_PROTOCOL", "grpc")
    grpc_settings = capture_otlp_settings()
    assert grpc_settings["tls"] == snapshot["_runtime_settings"]["otlp"]["tls"]
    ca.unlink()
    certificate.unlink()
    contexts = install_transport(monkeypatch, lambda request: httpx.Response(200))
    client = MLflowTraceClient("mlflow", json.loads(json.dumps(snapshot)))
    client.export_trace(make_trace())
    assert handshake(contexts[0], server_context).getpeercert()


def test_grpc_tls_uses_a_selected_bundle_without_mixing_client_files(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    common_ca = tmp_path / "common.pem"
    trace_ca = tmp_path / "trace.pem"
    common_ca.write_bytes(b"common")
    trace_ca.write_bytes(b"trace")
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "https://collector.example")
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_CERTIFICATE", str(common_ca))
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_CLIENT_KEY", "/unused/common-key")
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_TRACES_CERTIFICATE", str(trace_ca))
    assert capture_otlp_settings()["tls"] == {"certificate": base64.b64encode(b"trace").decode()}
    monkeypatch.delenv("OTEL_EXPORTER_OTLP_CLIENT_KEY")
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_TRACES_INSECURE", "true")
    assert capture_otlp_settings()["tls"] == {"certificate": base64.b64encode(b"common").decode()}


@pytest.fixture
def install_credential_factories(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Callable[[dict[str, Any]], None]:
    directory = tmp_path / "factories"
    distribution = directory / "otlp_auth_example-1.0.dist-info"
    distribution.mkdir(parents=True)
    (distribution / "METADATA").write_text("Metadata-Version: 2.1\nName: otlp-auth-example\nVersion: 1.0\n")
    module = ModuleType("otlp_auth_example")
    monkeypatch.setitem(sys.modules, module.__name__, module)
    monkeypatch.syspath_prepend(str(directory))

    def install(factories: dict[str, Any]) -> None:
        entries = ["[opentelemetry_otlp_credential_provider]"]
        for name, factory in factories.items():
            setattr(module, name, factory)
            entries.append(f"{name} = {module.__name__}:{name}")
        (distribution / "entry_points.txt").write_text("\n".join(entries) + "\n")

    return install


def test_http_credential_factory_precedence_snapshot_and_ssrf_session(
    install_credential_factories: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    configure_collector(monkeypatch)
    sessions: list[requests.Session] = []

    def shared() -> requests.Session:
        session = requests.Session()
        session.auth = HTTPBasicAuth("factory-user", "factory-secret")
        session.headers["X-Factory"] = "selected"
        sessions.append(session)
        return session

    install_credential_factories({"shared": shared})
    monkeypatch.setenv("OTEL_PYTHON_EXPORTER_OTLP_HTTP_CREDENTIAL_PROVIDER", "shared")
    monkeypatch.setenv("OTEL_PYTHON_EXPORTER_OTLP_HTTP_TRACES_CREDENTIAL_PROVIDER", "unavailable")
    snapshot = json.dumps(resolve_provider_config("mlflow", make_provider_config("mlflow")))
    assert sessions == []
    monkeypatch.setenv("OTEL_PYTHON_EXPORTER_OTLP_HTTP_CREDENTIAL_PROVIDER", "changed")
    sent: list[httpx.Request] = []

    def respond(request: httpx.Request) -> httpx.Response:
        sent.append(request)
        return httpx.Response(200, content=b"")

    install_transport(monkeypatch, respond)
    for _ in range(2):
        MLflowTraceClient("mlflow", json.loads(snapshot)).export_trace(make_trace())
    assert len(sessions) == len(sent) == 2
    assert sessions[0] is not sessions[1]
    assert all(request.headers["Authorization"] == basic_auth("factory-user", "factory-secret") for request in sent)
    assert all(request.headers["X-Factory"] == "selected" for request in sent)


def test_grpc_credentials_factory_precedence_and_identity(
    install_credential_factories: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    common = Mock(side_effect=grpc.ssl_channel_credentials)
    signal = Mock(side_effect=grpc.ssl_channel_credentials)
    install_credential_factories({"common": common, "signal": signal})
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "https://collector.example")
    monkeypatch.setenv("OTEL_PYTHON_EXPORTER_OTLP_GRPC_CREDENTIAL_PROVIDER", "common")
    monkeypatch.setenv("OTEL_PYTHON_EXPORTER_OTLP_GRPC_TRACES_CREDENTIAL_PROVIDER", "signal")
    config = make_provider_config("mlflow")
    first = resolve_provider_config("mlflow", config)
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_TRACES_CERTIFICATE", "/factory-ignores-this-path")
    second = resolve_provider_config("mlflow", config)
    assert provider_config_identity("mlflow", first) != provider_config_identity("mlflow", second)
    common.assert_not_called()
    signal.assert_not_called()
    for snapshot in (first, second):
        MLflowTraceClient("mlflow", json.loads(json.dumps(snapshot)))
    common.assert_called_once()
    signal.assert_called_once()


def test_http_redirects_keep_captured_netrc_and_strip_cross_host_authorization(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    configure_collector(monkeypatch)
    (tmp_path / ".netrc").write_text("machine final.example login redirect-user password redirect-secret\n")
    snapshot = resolve_provider_config("mlflow", make_provider_config("mlflow"))
    (tmp_path / ".netrc").unlink()
    sent: list[httpx.Request] = []

    def respond(request: httpx.Request) -> httpx.Response:
        sent.append(request)
        if request.url.host == "collector.example":
            return httpx.Response(307, headers={"Location": "https://middle.example/traces"})
        if request.url.host == "middle.example":
            return httpx.Response(307, headers={"Location": "https://final.example/traces"})
        return httpx.Response(200)

    install_transport(monkeypatch, respond)
    MLflowTraceClient("mlflow", snapshot).export_trace(make_trace())
    assert len(sent) == 3
    assert sent[0].headers["Authorization"] == "Bearer collector-secret"
    assert "Authorization" not in sent[1].headers
    assert sent[2].headers["Authorization"] == basic_auth("redirect-user", "redirect-secret")
    assert all(request.method == "POST" and request.content == sent[0].content for request in sent)


def test_http_retry_after_is_preserved(monkeypatch: pytest.MonkeyPatch) -> None:
    configure_collector(monkeypatch)
    install_transport(monkeypatch, lambda request: httpx.Response(429, headers={"Retry-After": "7"}))
    with pytest.raises(TraceExportError) as failure:
        MLflowTraceClient("mlflow", make_provider_config("mlflow")).export_trace(make_trace())
    assert failure.value.retryable
    assert failure.value.retry_after == 7


def test_resource_and_genai_flags_are_frozen_for_collector_only(monkeypatch: pytest.MonkeyPatch) -> None:
    configure_collector(monkeypatch, dual=True)
    monkeypatch.setenv("OTEL_SERVICE_NAME", "collector-service")
    monkeypatch.setenv("OTEL_RESOURCE_ATTRIBUTES", "environment=prod%20east,telemetry.sdk.name=ignored")
    monkeypatch.setenv("MLFLOW_ENABLE_OTEL_GENAI_SEMCONV", "true")
    config = resolve_provider_config("mlflow", make_provider_config("mlflow"))
    monkeypatch.setenv("MLFLOW_ENABLE_OTEL_GENAI_SEMCONV", "false")
    monkeypatch.setenv("OTEL_SERVICE_NAME", "changed")
    captured: list[httpx.Request] = []

    def respond(request: httpx.Request) -> httpx.Response:
        captured.append(request)
        return httpx.Response(404 if request.method == "GET" else 200)

    install_transport(monkeypatch, respond)
    MLflowTraceClient("mlflow", config).export_trace(make_trace())
    collector = ExportTraceServiceRequest.FromString(captured[0].content).resource_spans[0]
    resource = {item.key: read_attribute_value(item.value) for item in collector.resource.attributes}
    assert resource["service.name"] == "collector-service"
    assert resource["environment"] == "prod east"
    assert resource["telemetry.sdk.name"] == "mlflow"
    collector_attributes = {
        item.key: read_attribute_value(item.value) for item in collector.scope_spans[0].spans[1].attributes
    }
    assert collector_attributes["gen_ai.operation.name"] == "generate_content"
    assert "mlflow.spanType" not in collector_attributes
    native = ExportTraceServiceRequest.FromString(captured[-1].content).resource_spans[0].scope_spans[0].spans[1]
    assert {item.key: read_attribute_value(item.value) for item in native.attributes}["mlflow.spanType"] == "LLM"


def test_http_to_https_redirect_uses_captured_ca_and_client_certificate(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    configure_collector(monkeypatch)
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT", "http://collector.example/traces")
    ca, certificate, server_context = server_certificate(tmp_path / "redirect")
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_TRACES_CERTIFICATE", str(ca))
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_TRACES_CLIENT_CERTIFICATE", str(certificate))
    snapshot = resolve_provider_config("mlflow", make_provider_config("mlflow"))
    ca.unlink()
    certificate.unlink()
    contexts = install_transport(
        monkeypatch,
        lambda request: (
            httpx.Response(307, headers={"Location": "https://artifacts.example/traces"})
            if request.url.scheme == "http"
            else httpx.Response(200)
        ),
    )
    MLflowTraceClient("mlflow", snapshot).export_trace(make_trace())
    assert len(contexts) == 2
    assert handshake(contexts[1], server_context).getpeercert()


@pytest.mark.parametrize("redirect", [False, True])
def test_unreadable_tls_does_not_block_http_but_rejects_https_redirects(
    redirect: bool, monkeypatch: pytest.MonkeyPatch
) -> None:
    configure_collector(monkeypatch)
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT", "http://collector.example/traces")
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_TRACES_CERTIFICATE", "/missing/collector-ca.pem")
    contexts = install_transport(
        monkeypatch,
        lambda request: (
            httpx.Response(307, headers={"Location": "https://collector.example/traces"})
            if redirect
            else httpx.Response(200)
        ),
    )
    client = MLflowTraceClient("mlflow", make_provider_config("mlflow"))
    if redirect:
        with pytest.raises(TraceExportError, match="mlflow_otlp_authentication_failed"):
            client.export_trace(make_trace())
    else:
        client.export_trace(make_trace())
    assert len(contexts) == 1


def test_plugin_trust_env_and_blank_client_certificate_keep_native_tls_precedence(
    install_credential_factories: Any, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    configure_collector(monkeypatch)
    ca, _, server_context = server_certificate(tmp_path / "session")
    monkeypatch.setenv("REQUESTS_CA_BUNDLE", str(ca))

    def isolated() -> requests.Session:
        session = requests.Session()
        session.trust_env = False
        session.cert = "/unused/plugin-client.pem"
        return session

    install_credential_factories({"isolated": isolated})
    monkeypatch.setenv("OTEL_PYTHON_EXPORTER_OTLP_HTTP_CREDENTIAL_PROVIDER", "isolated")
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_TRACES_CLIENT_CERTIFICATE", "")
    contexts = install_transport(monkeypatch, lambda request: httpx.Response(200))
    MLflowTraceClient("mlflow", make_provider_config("mlflow")).export_trace(make_trace())
    with pytest.raises(ssl.SSLError):
        handshake(contexts[0], server_context)
    # An explicit OTLP certificate still wins with trust_env disabled.
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_TRACES_CERTIFICATE", str(ca))
    MLflowTraceClient("mlflow", make_provider_config("mlflow")).export_trace(make_trace())
    assert handshake(contexts[1], server_context).getpeercert() is None


def test_empty_netrc_entry_suppresses_default_without_overwriting_url_credentials(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    configure_collector(monkeypatch)
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT", "https://url:secret@collector.example/traces")
    (tmp_path / ".netrc").write_text("machine collector.example\ndefault login default password ignored\n")
    sent: list[httpx.Request] = []

    def respond(request: httpx.Request) -> httpx.Response:
        sent.append(request)
        return httpx.Response(200)

    install_transport(monkeypatch, respond)
    MLflowTraceClient("mlflow", make_provider_config("mlflow")).export_trace(make_trace())
    assert sent[0].headers["Authorization"] == basic_auth("url", "secret")
