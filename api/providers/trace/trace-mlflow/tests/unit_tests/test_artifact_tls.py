"""Separate HTTP artifact destinations share captured trust, never credentials."""

import ssl
from datetime import UTC, datetime, timedelta
from pathlib import Path
from unittest.mock import Mock

import httpx
import pytest
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.x509.oid import NameOID
from dify_trace_mlflow.config import MLflowConfig
from dify_trace_mlflow.mlflow_trace import MLflowTraceClient

from core.ops.provider_config import resolve_provider_config


def server_certificate(directory: Path) -> tuple[Path, Path, ssl.SSLContext]:
    directory.mkdir()
    key = ec.generate_private_key(ec.SECP256R1())
    subject = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "localhost")])
    now = datetime.now(UTC)
    certificate = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(subject)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - timedelta(days=1))
        .not_valid_after(now + timedelta(days=1))
        .add_extension(x509.BasicConstraints(ca=True, path_length=None), critical=True)
        .add_extension(x509.SubjectAlternativeName([x509.DNSName("artifacts.example")]), critical=False)
        .sign(key, hashes.SHA256())
    )
    certificate_file = directory / "ca.pem"
    certificate_file.write_bytes(certificate.public_bytes(serialization.Encoding.PEM))
    client_file = directory / "client.pem"
    client_file.write_bytes(
        certificate_file.read_bytes()
        + key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())
    )
    server_context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    server_context.load_cert_chain(client_file)
    server_context.load_verify_locations(cafile=certificate_file)
    server_context.verify_mode = ssl.CERT_OPTIONAL
    return certificate_file, client_file, server_context


def handshake(client_context: ssl.SSLContext, server_context: ssl.SSLContext) -> ssl.SSLObject:
    client_in, client_out, server_in, server_out = (ssl.MemoryBIO() for _ in range(4))
    client = client_context.wrap_bio(client_in, client_out, server_hostname="artifacts.example")
    server = server_context.wrap_bio(server_in, server_out, server_side=True)
    for _ in range(10):
        for connection in (client, server):
            try:
                connection.do_handshake()
            except ssl.SSLWantReadError:
                pass
        server_in.write(client_out.read())
        client_in.write(server_out.read())
        if client.version() and server.version():
            break
    assert client.version()
    assert server.version()
    return server


@pytest.mark.parametrize("tracking_scheme", ["http", "https"])
@pytest.mark.parametrize("ca_kind", ["file", "directory"])
def test_artifact_tls_preserves_owned_ca_snapshots_without_tracking_auth_or_client_certificates(
    tracking_scheme: str, ca_kind: str, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    settings = []
    servers = []
    for owner in ("first", "second"):
        certificate, client_certificate, server = server_certificate(tmp_path / owner)
        ca = certificate
        if ca_kind == "directory":
            ca = certificate.parent / "ca"
            ca.mkdir()
            # OpenSSL's subject hash for CN=localhost.
            (ca / "ce275665.0").symlink_to(certificate)
        monkeypatch.setenv("MLFLOW_TRACKING_SERVER_CERT_PATH", str(ca))
        monkeypatch.setenv("MLFLOW_TRACKING_CLIENT_CERT_PATH", str(client_certificate))
        monkeypatch.setenv("MLFLOW_TRACKING_TOKEN", f"{owner}-secret")
        settings.append(resolve_provider_config("mlflow", {"tracking_uri": f"{tracking_scheme}://mlflow.example"}))
        servers.append(server)
        certificate.unlink()
        client_certificate.unlink()
    assert settings[0] != settings[1]
    monkeypatch.setattr(MLflowConfig, "load_runtime_settings", Mock(side_effect=AssertionError("Snapshot reread")))
    monkeypatch.setenv("MLFLOW_TRACKING_INSECURE_TLS", "true")
    contexts: list[ssl.SSLContext] = []
    requests: list[httpx.Request] = []

    def respond(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200)

    def create_http_client(*, ssl_context: ssl.SSLContext | None = None) -> httpx.Client:
        assert ssl_context is not None
        contexts.append(ssl_context)
        return httpx.Client(transport=httpx.MockTransport(respond), verify=ssl_context, trust_env=False)

    monkeypatch.setattr("core.ops.provider_export.ssrf_proxy.create_http_client", create_http_client)
    for index, setting in enumerate(settings):
        client = MLflowTraceClient("mlflow", setting)
        client.verify_credentials()
        client._upload_mlflow_artifact("https://artifacts.example/trace?signature=artifact", b"{}")
        tracking_context, artifact_context = contexts[-2:]
        assert tracking_context is not artifact_context
        assert artifact_context.verify_mode == ssl.CERT_REQUIRED
        assert handshake(artifact_context, servers[index]).getpeercert() is None
        if tracking_scheme == "https":
            assert handshake(tracking_context, servers[index]).getpeercert()
        owner = "first" if index == 0 else "second"
        assert requests[-2].headers["Authorization"] == f"Bearer {owner}-secret"
        assert "Authorization" not in requests[-1].headers
    assert contexts[1] is not contexts[3]
    assert contexts[1].get_ca_certs(binary_form=True) != contexts[3].get_ca_certs(binary_form=True)


@pytest.mark.parametrize("tracking_scheme", ["http", "https"])
def test_separate_artifact_verification_uses_captured_setting(
    tracking_scheme: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("MLFLOW_TRACKING_INSECURE_TLS", "true")
    settings = resolve_provider_config("mlflow", {"tracking_uri": f"{tracking_scheme}://mlflow.example"})
    monkeypatch.setenv("MLFLOW_TRACKING_INSECURE_TLS", "false")
    monkeypatch.setenv("REQUESTS_CA_BUNDLE", "/uncaptured/ca.pem")
    contexts: list[ssl.SSLContext] = []

    def create_http_client(*, ssl_context: ssl.SSLContext | None = None) -> httpx.Client:
        assert ssl_context is not None
        contexts.append(ssl_context)
        return httpx.Client(transport=httpx.MockTransport(lambda request: httpx.Response(200)), verify=ssl_context)

    monkeypatch.setattr("core.ops.provider_export.ssrf_proxy.create_http_client", create_http_client)
    MLflowTraceClient("mlflow", settings)._upload_mlflow_artifact("https://artifacts.example/trace", b"{}")
    assert contexts[0].verify_mode == ssl.CERT_NONE
    assert contexts[0].check_hostname is False


@pytest.mark.parametrize("ca_error", ["unreadable", "invalid"])
def test_http_tracker_defers_captured_ca_failure_until_https_artifact_upload(
    ca_error: str, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    ca = tmp_path / "ca.pem"
    if ca_error == "invalid":
        ca.write_text("invalid certificate")
    monkeypatch.setenv("MLFLOW_TRACKING_SERVER_CERT_PATH", str(ca))
    settings = resolve_provider_config("mlflow", {"tracking_uri": "http://mlflow.example"})
    monkeypatch.delenv("MLFLOW_TRACKING_SERVER_CERT_PATH")
    client = MLflowTraceClient("mlflow", settings)
    request = Mock(return_value=httpx.Response(200))
    monkeypatch.setattr("core.ops.provider_export.ssrf_proxy.make_request", request)
    assert client.verify_credentials()
    client._upload_mlflow_artifact("http://artifacts.example/trace", b"{}")
    with pytest.raises((ValueError, ssl.SSLError)):
        client._upload_mlflow_artifact("https://artifacts.example/trace", b"{}")
    assert request.call_count == 2
