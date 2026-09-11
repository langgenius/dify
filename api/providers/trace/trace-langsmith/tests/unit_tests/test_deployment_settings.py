import base64
import json
import ssl
from datetime import UTC, datetime, timedelta
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from threading import Thread
from typing import Any, override
from unittest.mock import Mock

import httpx
import pytest
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID
from dify_trace_langsmith.config import LangSmithConfig
from dify_trace_langsmith.langsmith_trace import LangSmithTraceClient

from core.ops.provider_config import resolve_provider_config
from tests.unit_tests.core.ops.test_provider_export import make_completed_trace


def test_workspace_selection_keeps_environment_and_profile_precedence(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    profiles = tmp_path / "profiles.json"
    profiles.write_text(
        json.dumps(
            {
                "current_profile": "current",
                "profiles": {
                    "current": {"workspace_id": "current-workspace"},
                    "selected": {"workspace_id": "selected-workspace"},
                },
            }
        )
    )
    monkeypatch.setenv("LANGSMITH_CONFIG_FILE", str(profiles))
    config = {"api_key": ' "saved-key" ', "project": "project"}
    assert LangSmithTraceClient(config).http.headers == {"x-api-key": "saved-key", "X-Tenant-Id": "current-workspace"}
    monkeypatch.setenv("LANGSMITH_PROFILE", "selected")
    assert LangSmithTraceClient(config).http.headers["X-Tenant-Id"] == "selected-workspace"
    monkeypatch.setenv("LANGCHAIN_WORKSPACE_ID", " 'legacy-workspace' ")
    monkeypatch.setenv("LANGSMITH_WORKSPACE_ID", " ")
    assert LangSmithTraceClient(config).http.headers["X-Tenant-Id"] == "legacy-workspace"
    monkeypatch.setenv("LANGSMITH_WORKSPACE_ID", ' "current-env-workspace" ')
    assert LangSmithTraceClient(config).http.headers["X-Tenant-Id"] == "current-env-workspace"


def test_workspace_snapshot_does_not_reread_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    config = {"api_key": "saved-key", "project": "project"}
    monkeypatch.setenv("LANGSMITH_WORKSPACE_ID", "first-workspace")
    first = resolve_provider_config("langsmith", config)
    monkeypatch.setenv("LANGSMITH_WORKSPACE_ID", "second-workspace")
    second = resolve_provider_config("langsmith", config)
    assert first != second
    monkeypatch.setattr(LangSmithConfig, "load_runtime_settings", Mock(side_effect=AssertionError("snapshot reread")))
    requests: list[httpx.Request] = []

    def respond(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200, json={})

    monkeypatch.setattr(
        "core.ops.provider_export.ssrf_proxy.create_http_client",
        lambda *, ssl_context: httpx.Client(
            verify=ssl_context, transport=httpx.MockTransport(respond), trust_env=False
        ),
    )
    first_client, second_client = LangSmithTraceClient(first), LangSmithTraceClient(second)
    assert first_client.verify_credentials()
    second_client.export_trace(make_completed_trace())
    assert requests[0].headers["X-Tenant-Id"] == "first-workspace"
    assert all(request.headers["X-Tenant-Id"] == "second-workspace" for request in requests[1:])
    assert first_client.http.headers["X-Tenant-Id"] == "first-workspace"


@pytest.mark.parametrize(
    ("current", "legacy", "hidden"),
    [
        (None, None, False),
        (None, "true", True),
        (" ", "true", True),
        ("false", "true", False),
        ("true", "false", True),
        ("TRUE", "true", False),
        (" true ", "true", False),
    ],
)
def test_privacy_switches_keep_sdk_namespace_and_boolean_semantics(
    current: str | None, legacy: str | None, hidden: bool, monkeypatch: pytest.MonkeyPatch
) -> None:
    for name in ("HIDE_INPUTS", "HIDE_OUTPUTS", "HIDE_METADATA"):
        if current is not None:
            monkeypatch.setenv(f"LANGSMITH_{name}", current)
        if legacy is not None:
            monkeypatch.setenv(f"LANGCHAIN_{name}", legacy)
    settings = LangSmithConfig.load_runtime_settings({"api_key": "key", "project": "project"})
    assert all(settings[name] is hidden for name in ("hide_inputs", "hide_outputs", "hide_metadata"))


@pytest.mark.parametrize("directory", [False, True])
def test_requests_ca_precedence_and_directory_capture(
    directory: bool, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    certificate = tmp_path / "01234567.0"
    certificate.write_bytes(b"captured CA")
    monkeypatch.setenv("CURL_CA_BUNDLE", str(certificate))
    monkeypatch.setenv("REQUESTS_CA_BUNDLE", str(tmp_path if directory else certificate))
    config = {"api_key": "key", "project": "project"}
    captured = LangSmithConfig.load_runtime_settings(config)
    if directory:
        assert (
            base64.b64decode(json.loads(captured["tls"]["certificate_directory"])[certificate.name]) == b"captured CA"
        )
    else:
        assert base64.b64decode(captured["tls"]["certificate"]) == b"captured CA"
    monkeypatch.setenv("REQUESTS_CA_BUNDLE", "")
    assert base64.b64decode(LangSmithConfig.load_runtime_settings(config)["tls"]["certificate"]) == b"captured CA"


def test_captured_private_ca_is_used_by_the_real_https_transport(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "localhost")])
    certificate = (
        x509.CertificateBuilder()
        .subject_name(name)
        .issuer_name(name)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(datetime.now(UTC) - timedelta(days=1))
        .not_valid_after(datetime.now(UTC) + timedelta(days=1))
        .add_extension(x509.SubjectAlternativeName([x509.DNSName("localhost")]), False)
        .add_extension(x509.BasicConstraints(ca=True, path_length=None), True)
        .sign(key, hashes.SHA256())
    )
    ca_file, key_file = tmp_path / "ca.pem", tmp_path / "key.pem"
    ca_file.write_bytes(certificate.public_bytes(serialization.Encoding.PEM))
    key_file.write_bytes(
        key.private_bytes(
            serialization.Encoding.PEM, serialization.PrivateFormat.TraditionalOpenSSL, serialization.NoEncryption()
        )
    )

    class ProviderHandler(BaseHTTPRequestHandler):
        def do_GET(self):
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b"[]")

        @override
        def log_message(self, format: str, *args: Any) -> None:
            pass

    server = HTTPServer(("localhost", 0), ProviderHandler)
    server_tls = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    server_tls.minimum_version = ssl.TLSVersion.TLSv1_2
    server_tls.load_cert_chain(ca_file, key_file)
    server.socket = server_tls.wrap_socket(server.socket, server_side=True)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        monkeypatch.setenv("REQUESTS_CA_BUNDLE", str(ca_file))
        settings = resolve_provider_config(
            "langsmith", {"api_key": "key", "project": "project", "endpoint": f"https://localhost:{server.server_port}"}
        )
        ca_file.unlink()
        monkeypatch.setenv("REQUESTS_CA_BUNDLE", "/missing/rotated-ca.pem")
        monkeypatch.setattr(
            "core.ops.provider_export.ssrf_proxy.create_http_client",
            lambda *, ssl_context: httpx.Client(verify=ssl_context, trust_env=False),
        )
        assert LangSmithTraceClient(settings).verify_credentials()
    finally:
        server.shutdown()
        server.server_close()
        thread.join()
