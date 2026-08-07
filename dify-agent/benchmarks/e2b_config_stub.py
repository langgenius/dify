"""Standalone deterministic Config data plane for E2B benchmark sandboxes."""

from __future__ import annotations

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import hashlib
import io
import os
from pathlib import Path
import string
from threading import Lock
from typing import Literal
from urllib.parse import unquote, urlsplit
import zipfile


E2B_CONFIG_STUB_SOURCE_PATH = Path(__file__).resolve()
E2B_CONFIG_STUB_REMOTE_PATH = "/tmp/dify-agent-benchmark-config-stub.py"
E2B_CONFIG_STUB_DEFAULT_HOST = "127.0.0.1"
E2B_CONFIG_STUB_DEFAULT_PORT = 8765
E2B_CONFIG_STUB_DEFAULT_ITEM_BYTES = 4096
E2B_CONFIG_STUB_HOST_ENV = "BENCH_E2B_CONFIG_STUB_HOST"
E2B_CONFIG_STUB_PORT_ENV = "BENCH_E2B_CONFIG_STUB_PORT"
E2B_CONFIG_STUB_ITEM_BYTES_ENV = "BENCH_E2B_CONFIG_STUB_ITEM_BYTES"

_HEALTH_PATH = "/health"
_SKILL_PULL_PREFIX = "/agent-stub/config/skills/"
_FILE_PULL_PREFIX = "/agent-stub/config/files/"
_PULL_SUFFIX = "/pull"
_SAFE_NAME_CHARACTERS = frozenset(string.ascii_letters + string.digits + "._-")
_MAX_CONFIG_ITEM_NAME_LENGTH = 255
_CONFIG_SKILL_COUNT = 3
_CONFIG_FILE_COUNT = 10


def fixed_payload(label: str, size: int) -> bytes:
    """Return the same deterministic bytes as the Docker Fake dependency."""
    if size < 1:
        raise ValueError("payload size must be positive")
    seed = hashlib.sha256(label.encode()).digest()
    return (seed * ((size + len(seed) - 1) // len(seed)))[:size]


def configured_item_bytes() -> int:
    """Read and validate the configured payload size for this sandbox process."""
    raw_value = os.environ.get(E2B_CONFIG_STUB_ITEM_BYTES_ENV)
    if raw_value is None:
        return E2B_CONFIG_STUB_DEFAULT_ITEM_BYTES
    try:
        value = int(raw_value)
    except ValueError as exc:
        raise ValueError(f"{E2B_CONFIG_STUB_ITEM_BYTES_ENV} must be a positive integer") from exc
    if value < 1:
        raise ValueError(f"{E2B_CONFIG_STUB_ITEM_BYTES_ENV} must be a positive integer")
    return value


class E2BConfigStubServer(ThreadingHTTPServer):
    """HTTP server carrying the immutable payload size for all request threads."""

    daemon_threads = True

    def __init__(self, server_address: tuple[str, int], *, item_bytes: int) -> None:
        if item_bytes < 1:
            raise ValueError("item_bytes must be positive")
        self.item_bytes = item_bytes
        self._pull_lock = Lock()
        self._claimed_pulls: set[tuple[str, str]] = set()
        super().__init__(server_address, _E2BConfigStubHandler)

    def claim_pull(self, *, kind: Literal["skill", "file"], name: str) -> bool:
        """Allow one successful pull for every run-scoped Config item."""
        key = (kind, name)
        with self._pull_lock:
            if key in self._claimed_pulls:
                return False
            self._claimed_pulls.add(key)
            return True


class _E2BConfigStubHandler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler API
        path = unquote(urlsplit(self.path).path)
        if path == _HEALTH_PATH:
            self._write_response(status=200, content_type="application/json", body=b'{"status":"ok"}')
            return

        skill_name = _pull_name(path, prefix=_SKILL_PULL_PREFIX)
        if skill_name is not None:
            if not _is_safe_name(skill_name) or not _is_fixed_scenario_item(skill_name, kind="skill"):
                self.send_error(400, "invalid Config skill name")
                return
            if not self._server().claim_pull(kind="skill", name=skill_name):
                self.send_error(409, "duplicate Config skill pull")
                return
            self._write_response(
                status=200,
                content_type="application/zip",
                body=_skill_archive(name=skill_name, content_bytes=self._item_bytes()),
            )
            return

        file_name = _pull_name(path, prefix=_FILE_PULL_PREFIX)
        if file_name is not None:
            if not _is_safe_name(file_name) or not _is_fixed_scenario_item(file_name, kind="file"):
                self.send_error(400, "invalid Config file name")
                return
            if not self._server().claim_pull(kind="file", name=file_name):
                self.send_error(409, "duplicate Config file pull")
                return
            self._write_response(
                status=200,
                content_type="application/octet-stream",
                body=fixed_payload(f"config:{file_name}", self._item_bytes()),
            )
            return

        self.send_error(404, "not found")

    def log_message(self, format: str, *args: object) -> None:
        del format, args

    def _write_response(self, *, status: int, content_type: str, body: bytes) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _item_bytes(self) -> int:
        return self._server().item_bytes

    def _server(self) -> E2BConfigStubServer:
        if not isinstance(self.server, E2BConfigStubServer):
            raise TypeError("Config Stub handler requires E2BConfigStubServer")
        return self.server


def build_server(*, host: str, port: int, item_bytes: int) -> E2BConfigStubServer:
    """Build a server that callers may run or shut down explicitly."""
    return E2BConfigStubServer((host, port), item_bytes=item_bytes)


def _pull_name(path: str, *, prefix: str) -> str | None:
    if not path.startswith(prefix) or not path.endswith(_PULL_SUFFIX):
        return None
    return path[len(prefix) : -len(_PULL_SUFFIX)]


def _is_safe_name(name: str) -> bool:
    return (
        0 < len(name) <= _MAX_CONFIG_ITEM_NAME_LENGTH
        and name not in {".", ".."}
        and all(character in _SAFE_NAME_CHARACTERS for character in name)
    )


def _is_fixed_scenario_item(name: str, *, kind: Literal["skill", "file"]) -> bool:
    prefix, suffix, count = (
        ("skill-", "", _CONFIG_SKILL_COUNT) if kind == "skill" else ("file-", ".bin", _CONFIG_FILE_COUNT)
    )
    if not name.startswith(prefix) or (suffix and not name.endswith(suffix)):
        return False
    item = name[len(prefix) : -len(suffix) if suffix else None]
    index_text, separator, run_scope = item.partition("-")
    return bool(separator and run_scope) and index_text.isascii() and index_text.isdigit() and int(index_text) < count


def _skill_archive(*, name: str, content_bytes: int) -> bytes:
    payload = fixed_payload(f"skill:{name}", content_bytes)
    skill_markdown = b"# Benchmark skill\n\n" + payload
    buffer = io.BytesIO()
    info = zipfile.ZipInfo("SKILL.md", date_time=(1980, 1, 1, 0, 0, 0))
    info.compress_type = zipfile.ZIP_STORED
    info.external_attr = 0o644 << 16
    with zipfile.ZipFile(buffer, mode="w") as archive:
        archive.writestr(info, skill_markdown)
    return buffer.getvalue()


def main() -> None:
    host = os.environ.get(E2B_CONFIG_STUB_HOST_ENV, E2B_CONFIG_STUB_DEFAULT_HOST)
    raw_port = os.environ.get(E2B_CONFIG_STUB_PORT_ENV, str(E2B_CONFIG_STUB_DEFAULT_PORT))
    try:
        port = int(raw_port)
    except ValueError as exc:
        raise ValueError(f"{E2B_CONFIG_STUB_PORT_ENV} must be an integer") from exc
    if not 1 <= port <= 65535:
        raise ValueError(f"{E2B_CONFIG_STUB_PORT_ENV} must be between 1 and 65535")
    server = build_server(host=host, port=port, item_bytes=configured_item_bytes())
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()


__all__ = [
    "E2B_CONFIG_STUB_DEFAULT_HOST",
    "E2B_CONFIG_STUB_DEFAULT_ITEM_BYTES",
    "E2B_CONFIG_STUB_DEFAULT_PORT",
    "E2B_CONFIG_STUB_HOST_ENV",
    "E2B_CONFIG_STUB_ITEM_BYTES_ENV",
    "E2B_CONFIG_STUB_PORT_ENV",
    "E2B_CONFIG_STUB_REMOTE_PATH",
    "E2B_CONFIG_STUB_SOURCE_PATH",
    "build_server",
    "configured_item_bytes",
    "fixed_payload",
    "main",
]
