import ssl
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from typing import override
from unittest.mock import Mock

import pytest
import requests
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.x509.oid import NameOID
from requests.adapters import HTTPAdapter

from core.helper.ssl_context import create_ssl_context, read_tls_files
from core.helper.ssrf_requests import SSRFRequestsAdapter
from core.tools.errors import ToolSSRFError


@pytest.mark.parametrize(
    ("all_proxy", "http_proxy", "https_proxy", "expected"),
    [
        ("http://all.example", "http://http.example", "http://https.example", {"all": "http://all.example"}),
        (
            None,
            "http://http.example",
            "http://https.example",
            {"http": "http://http.example", "https": "http://https.example"},
        ),
        (None, None, None, {"https": "http://environment.example"}),
        (None, "http://unused.example", None, {"https": "http://environment.example"}),
    ],
)
def test_native_requests_enforce_the_shared_proxy_policy(
    all_proxy: str | None,
    http_proxy: str | None,
    https_proxy: str | None,
    expected: dict[str, str],
    config_overrides: Callable[..., None],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    config_overrides(SSRF_PROXY_ALL_URL=all_proxy, SSRF_PROXY_HTTP_URL=http_proxy, SSRF_PROXY_HTTPS_URL=https_proxy)
    environment = Mock(return_value={"https": "http://environment.example"})
    monkeypatch.setattr("requests.utils.get_environ_proxies", environment)
    response = requests.Response()
    response.status_code = 200
    send = Mock(return_value=response)
    monkeypatch.setattr(HTTPAdapter, "send", send)
    adapter = SSRFRequestsAdapter()
    request = requests.Request("GET", "https://destination.example/export").prepare()
    config_overrides(SSRF_PROXY_ALL_URL="http://later.example")
    try:
        assert (
            adapter.send(request, proxies={"https": "http://bypass.example"}, verify=False, cert="missing.pem")
            is response
        )
        assert send.call_args.kwargs["proxies"] == expected
        assert send.call_args.kwargs["verify"] is True
        assert send.call_args.kwargs["cert"] is None
        assert adapter.max_retries.total == 0
        assert environment.call_count == (1 if "environment.example" in str(expected) else 0)
    finally:
        adapter.close()


@pytest.mark.parametrize("verify", [True, False])
def test_native_tls_pool_uses_the_owned_context_without_loading_auth_hook_files(verify: bool) -> None:
    context = create_ssl_context({}, verify=verify)
    adapter = SSRFRequestsAdapter(ssl_context=context)
    request = requests.Request("GET", "https://destination.example").prepare()
    try:
        host, tls = adapter.build_connection_pool_key_attributes(
            request, "missing-ca.pem", ("missing-cert", "missing-key")
        )
        assert host == {"scheme": "https", "host": "destination.example", "port": None}
        assert tls == {"ssl_context": context, "cert_reqs": context.verify_mode}
        adapter.cert_verify(Mock(), request.url or "", "missing-ca.pem", ("missing-cert", "missing-key"))
        assert context.check_hostname is verify
        assert context.verify_mode == (ssl.CERT_REQUIRED if verify else ssl.CERT_NONE)
    finally:
        adapter.close()


@pytest.mark.parametrize("status", [401, 403])
def test_native_requests_close_squid_rejections_and_hide_url_credentials(
    status: int, monkeypatch: pytest.MonkeyPatch
) -> None:
    response = requests.Response()
    response.status_code = status
    response.headers["Server"] = "squid/6"
    response._content = b"blocked"
    assert response.content == b"blocked"
    raw = Mock()
    response.raw = raw
    monkeypatch.setattr(HTTPAdapter, "send", Mock(return_value=response))
    adapter = SSRFRequestsAdapter()
    request = requests.Request("GET", "https://user:secret@destination.example/export?token=secret#secret").prepare()
    try:
        with pytest.raises(ToolSSRFError) as rejected:
            adapter.send(request)
        assert "secret" not in str(rejected.value)
        assert "https://destination.example/export" in str(rejected.value)
        assert "SSRF_PROXY_ALLOW_PRIVATE_IPS" in str(rejected.value)
        raw.release_conn.assert_called_once()
    finally:
        adapter.close()


def test_native_https_uses_captured_ca_and_client_certificate_after_files_are_removed(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
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
        .add_extension(x509.SubjectAlternativeName([x509.DNSName("localhost")]), critical=False)
        .sign(key, hashes.SHA256())
    )
    certificate_file = tmp_path / "certificate.pem"
    key_file = tmp_path / "key.pem"
    certificate_file.write_bytes(certificate.public_bytes(serialization.Encoding.PEM))
    key_file.write_bytes(
        key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())
    )
    captured = read_tls_files(
        {"certificate": str(certificate_file), "client_certificate": str(certificate_file), "client_key": str(key_file)}
    )
    client_context = create_ssl_context(captured)
    original_roots = client_context.get_ca_certs(binary_form=True)
    server_context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    server_context.minimum_version = ssl.TLSVersion.TLSv1_2
    server_context.load_cert_chain(certificate_file, key_file)
    server_context.load_verify_locations(cafile=str(certificate_file))
    server_context.verify_mode = ssl.CERT_REQUIRED
    certificate_file.unlink()
    key_file.unlink()
    monkeypatch.setenv("REQUESTS_CA_BUNDLE", str(tmp_path / "unavailable-ca.pem"))
    monkeypatch.setattr("core.helper.ssrf_proxy.get_proxy_urls", lambda: None)
    monkeypatch.setattr("requests.utils.get_environ_proxies", lambda _url: {})
    received: list[dict[str, bytes | None]] = []

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self) -> None:
            assert isinstance(self.connection, ssl.SSLSocket)
            received.append(
                {
                    "peer_certificate": self.connection.getpeercert(binary_form=True),
                    "header": self.headers["X-Signed-Bytes"].encode("latin1"),
                    "body": self.rfile.read(int(self.headers["Content-Length"])),
                }
            )
            self.send_response(200)
            self.send_header("Content-Length", "2")
            self.end_headers()
            self.wfile.write(b"ok")

        @override
        def log_message(self, format: str, *args: object) -> None:
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    server.socket = server_context.wrap_socket(server.socket, server_side=True)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    adapter = SSRFRequestsAdapter(ssl_context=client_context)
    try:
        with requests.Session() as session:
            session.trust_env = False
            session.mount("https://", adapter)
            response = session.post(
                f"https://localhost:{server.server_port}/trace",
                data=b"signed body",
                headers={"X-Signed-Bytes": b"\xff\xc3\xa9"},
                timeout=3,
                allow_redirects=False,
            )
            assert response.content == b"ok"
        assert received == [
            {
                "peer_certificate": certificate.public_bytes(serialization.Encoding.DER),
                "header": b"\xff\xc3\xa9",
                "body": b"signed body",
            }
        ]
        assert client_context.get_ca_certs(binary_form=True) == original_roots
        assert adapter.ssl_context is client_context
    finally:
        adapter.close()
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)
