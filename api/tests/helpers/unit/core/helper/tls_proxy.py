"""Loopback CONNECT proxy exercising real TLS handshakes without external I/O."""

import ssl
from collections.abc import Generator
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Event, Thread
from typing import override

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID


@contextmanager
def tls_proxy(tmp_path: Path) -> Generator[tuple[str, ssl.SSLContext, Event]]:
    """Yield a proxy, trusted client context and handshake release event.

    CONNECT to timeout.example stalls TLS until released. Other tunnels present
    a localhost certificate and serve one response. Exit releases server threads
    and sockets even when a client assertion fails.
    """
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "localhost")])
    now = datetime.now(UTC)
    certificate = (
        x509.CertificateBuilder()
        .subject_name(name)
        .issuer_name(name)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - timedelta(minutes=1))
        .not_valid_after(now + timedelta(days=1))
        .add_extension(x509.SubjectAlternativeName([x509.DNSName("localhost")]), critical=False)
        .sign(key, hashes.SHA256())
    )
    cert_path = tmp_path / "certificate.pem"
    key_path = tmp_path / "key.pem"
    cert_path.write_bytes(certificate.public_bytes(serialization.Encoding.PEM))
    key_path.write_bytes(
        key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())
    )
    server_context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    server_context.load_cert_chain(cert_path, key_path)
    client_context = ssl.create_default_context(cafile=str(cert_path))
    release = Event()

    class Handler(BaseHTTPRequestHandler):
        def do_CONNECT(self) -> None:
            """Acknowledge the tunnel, then perform TLS or wait for test cleanup."""
            self.connection.settimeout(3)
            self.send_response(200)
            self.end_headers()
            self.wfile.flush()
            self.close_connection = True
            if self.path == "timeout.example:443":
                release.wait(3)
                return
            try:
                with server_context.wrap_socket(self.connection, server_side=True) as stream:
                    request = b""
                    while b"\r\n\r\n" not in request:
                        chunk = stream.recv(4096)
                        if not chunk:
                            return
                        request += chunk
                    stream.sendall(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nOK")
            except (TimeoutError, ssl.SSLError):
                # Certificate rejection deliberately aborts its handshake.
                return

        @override
        def log_message(self, format: str, *args: object) -> None:
            """Keep the loopback fixture silent."""

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    server.daemon_threads = False
    thread = Thread(target=server.serve_forever, kwargs={"poll_interval": 0.01})
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}", client_context, release
    finally:
        release.set()
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)
        assert not thread.is_alive()
