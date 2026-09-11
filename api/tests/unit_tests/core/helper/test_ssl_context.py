import base64
import gc
import json
import ssl
from datetime import UTC, datetime, timedelta
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import Mock

import certifi
import pytest
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.x509.oid import NameOID

from core.helper.ssl_context import create_ssl_context, read_tls_files


def test_tls_settings_capture_file_contents_and_report_unreadable_files(tmp_path: Path) -> None:
    certificate = tmp_path / "certificate.pem"
    certificate.write_bytes(b"captured certificate")
    captured = read_tls_files({"certificate": str(certificate), "client_key": None})
    certificate.write_bytes(b"rotated certificate")
    assert captured == {"certificate": base64.b64encode(b"captured certificate").decode()}
    assert read_tls_files({"certificate": str(certificate)}) != captured
    certificate.unlink()
    with pytest.raises(ValueError, match="Cannot read TLS configuration"):
        read_tls_files({"certificate": str(certificate)})


def test_tls_verification_requires_an_explicit_boolean_and_owns_each_context() -> None:
    assert create_ssl_context({}) is None
    ssl_context = create_ssl_context({}, verify=False)
    assert ssl_context is not None
    assert ssl_context.verify_mode == ssl.CERT_NONE
    assert ssl_context.check_hostname is False
    assert create_ssl_context({}, verify=False) is not ssl_context
    with pytest.raises(ValueError, match="must be a boolean"):
        create_ssl_context({}, verify="false")  # type: ignore[arg-type]
    with pytest.raises(ValueError, match="requires a client certificate"):
        create_ssl_context({"client_key": base64.b64encode(b"private key").decode()})
    with pytest.raises(ValueError, match="CA certificate is empty"):
        create_ssl_context({"certificate": ""})


def test_http_client_certificate_uses_certifi_only_without_an_explicit_ca(monkeypatch: pytest.MonkeyPatch) -> None:
    create_context = Mock(return_value=Mock())
    monkeypatch.setattr("core.helper.ssl_context.ssl.create_default_context", create_context)
    create_ssl_context({"client_certificate": base64.b64encode(b"client certificate").decode()})
    assert create_context.call_args.kwargs["cafile"] == certifi.where()
    assert create_context.call_args.kwargs["cadata"] is None
    create_ssl_context({"certificate": base64.b64encode(b"explicit CA").decode()})
    assert create_context.call_args.kwargs["cafile"] is None
    assert create_context.call_args.kwargs["cadata"] == b"explicit CA"


def test_http_ca_directory_snapshot_survives_rotation_and_lasts_through_handshake(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    private_key = ec.generate_private_key(ec.SECP256R1())
    subject = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "localhost")])
    now = datetime.now(UTC)
    certificate = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(subject)
        .public_key(private_key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - timedelta(days=1))
        .not_valid_after(now + timedelta(days=1))
        .add_extension(x509.BasicConstraints(ca=True, path_length=None), critical=True)
        .add_extension(x509.SubjectAlternativeName([x509.DNSName("localhost")]), critical=False)
        .sign(private_key, hashes.SHA256())
    )
    certificate_file = tmp_path / "server.pem"
    certificate_file.write_bytes(certificate.public_bytes(serialization.Encoding.PEM))
    key_file = tmp_path / "server.key"
    key_file.write_bytes(
        private_key.private_bytes(
            serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()
        )
    )
    ca_directory = tmp_path / "ca"
    ca_directory.mkdir()
    # OpenSSL's subject hash for the fixed CN=localhost above is ce275665.
    hashed_certificate = ca_directory / "ce275665.0"
    hashed_certificate.symlink_to(certificate_file)
    (ca_directory / "unrelated.pem").write_bytes(b"ignored non-hashed file")
    with pytest.raises(ValueError, match="Cannot read TLS configuration"):
        read_tls_files({"certificate": str(ca_directory)})
    settings = read_tls_files({"certificate": str(ca_directory)}, allow_ca_directory=True)
    assert json.loads(settings["certificate_directory"]) == {
        "ce275665.0": base64.b64encode(certificate_file.read_bytes()).decode()
    }
    hashed_certificate.unlink()
    assert read_tls_files({"certificate": str(ca_directory)}, allow_ca_directory=True) != settings

    private_directories: list[Path] = []

    def make_directory() -> TemporaryDirectory[str]:
        directory = TemporaryDirectory()
        private_directories.append(Path(directory.name))
        return directory

    monkeypatch.setattr("core.helper.ssl_context.TemporaryDirectory", make_directory)
    client_context = create_ssl_context(settings)
    assert client_context is not None
    assert private_directories[0].is_dir()
    # capath certificates are loaded lazily, so the private copy must still exist during this handshake.
    assert client_context.get_ca_certs() == []
    server_context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    server_context.load_cert_chain(certificate_file, key_file)
    client_in, client_out, server_in, server_out = (ssl.MemoryBIO() for _ in range(4))
    client = client_context.wrap_bio(client_in, client_out, server_hostname="localhost")
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
    assert len(client_context.get_ca_certs()) == 1
    del client, client_context
    gc.collect()
    assert not private_directories[0].exists()


@pytest.mark.parametrize("filename", ["../ce275665.0", "ce275665.0/child", "unrelated.pem"])
def test_ca_directory_snapshot_rejects_nonhashed_basenames(filename: str) -> None:
    with pytest.raises(ValueError, match="Invalid TLS CA directory entry"):
        create_ssl_context({"certificate_directory": json.dumps({filename: ""})})
