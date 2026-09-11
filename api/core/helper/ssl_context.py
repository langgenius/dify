"""Create operation-owned TLS credentials from explicitly captured certificate contents."""

import base64
import json
import re
import ssl
import weakref
from collections.abc import Mapping
from pathlib import Path
from tempfile import NamedTemporaryFile, TemporaryDirectory
from typing import Any

import certifi


def read_tls_files(filenames: Mapping[str, str | None], *, allow_ca_directory: bool = False) -> dict[str, str]:
    """Copy TLS files and HTTP CA directories into JSON-safe settings without logging their contents."""
    try:
        settings = {}
        for field, filename in filenames.items():
            if not filename:
                continue
            path = Path(filename)
            if field == "certificate" and allow_ca_directory and path.is_dir():
                # OpenSSL capath looks up hashed basenames, including symlinks, without loading unrelated files.
                certificates = {
                    entry.name: base64.b64encode(entry.read_bytes()).decode("ascii")
                    for entry in sorted(path.iterdir())
                    if re.fullmatch(r"[0-9a-f]{8}\.r?[0-9]+", entry.name) and entry.is_file()
                }
                settings["certificate_directory"] = json.dumps(certificates, sort_keys=True, separators=(",", ":"))
            else:
                settings[field] = base64.b64encode(path.read_bytes()).decode("ascii")
        return settings
    except OSError:
        raise ValueError("Cannot read TLS configuration") from None


def create_ssl_context(tls: Mapping[str, str], *, verify: bool = True) -> ssl.SSLContext:
    if not isinstance(verify, bool):
        raise ValueError("TLS verification flag must be a boolean")
    if tls.get("client_key") and not tls.get("client_certificate"):
        raise ValueError("TLS client key requires a client certificate")
    certificate = base64.b64decode(tls["certificate"]) if "certificate" in tls else None
    if certificate == b"":
        raise ValueError("TLS CA certificate is empty")
    certificate_directory = None
    try:
        if "certificate_directory" in tls:
            certificate_directory = TemporaryDirectory()
            for filename, contents in json.loads(tls["certificate_directory"]).items():
                if not re.fullmatch(r"[0-9a-f]{8}\.r?[0-9]+", filename):
                    raise ValueError("Invalid TLS CA directory entry")
                Path(certificate_directory.name, filename).write_bytes(base64.b64decode(contents))
        ssl_context = ssl.create_default_context(
            cafile=certifi.where() if certificate is None and certificate_directory is None else None,
            cadata=certificate.decode("ascii") if certificate and b"-----BEGIN" in certificate else certificate,
            capath=certificate_directory.name if certificate_directory is not None else None,
        )
    except Exception:
        if certificate_directory is not None:
            certificate_directory.cleanup()
        raise
    if certificate_directory is not None:
        # OpenSSL reads capath lazily during handshakes, so keep this private copy until its context is released.
        weakref.finalize(ssl_context, certificate_directory.cleanup)
    if not verify:
        ssl_context.check_hostname = False
        ssl_context.verify_mode = ssl.CERT_NONE
    if tls.get("client_certificate"):
        # SSLContext requires filenames for a client chain. These private files are removed after loading.
        with NamedTemporaryFile() as certificate_file, NamedTemporaryFile() as key_file:
            certificate_file.write(base64.b64decode(tls["client_certificate"]))
            certificate_file.flush()
            if tls.get("client_key"):
                key_file.write(base64.b64decode(tls["client_key"]))
                key_file.flush()
            ssl_context.load_cert_chain(certificate_file.name, key_file.name if tls.get("client_key") else None)
    return ssl_context


def create_grpc_credentials(tls: Mapping[str, str]) -> Any | None:
    if not tls:
        return None
    import grpc  # pyrefly: ignore[untyped-import]

    return grpc.ssl_channel_credentials(
        root_certificates=base64.b64decode(tls["certificate"]) if tls.get("certificate") else None,
        private_key=base64.b64decode(tls["client_key"]) if tls.get("client_key") else None,
        certificate_chain=base64.b64decode(tls["client_certificate"]) if tls.get("client_certificate") else None,
    )
