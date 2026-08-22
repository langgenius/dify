"""Standalone deterministic Config data plane for E2B benchmark sandboxes."""

from __future__ import annotations

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import hashlib
import io
import json
import os
from pathlib import Path
import string
from threading import Lock
from typing import Literal, cast
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
_DOWNLOAD_REQUEST_PATH = "/agent-stub/files/download-request"
_DATA_PREFIX = "/files/benchmarks/config/"
_MAX_REQUEST_BODY_BYTES = 64 * 1024
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
        self._allocated_pulls: set[tuple[str, str]] = set()
        self._claimed_pulls: set[tuple[str, str]] = set()
        super().__init__(server_address, _E2BConfigStubHandler)

    def allocate_pull(self, *, kind: Literal["skill", "file"], name: str) -> bool:
        """Allocate an idempotent data URL until the Config item is consumed."""
        key = (kind, name)
        with self._pull_lock:
            if key in self._claimed_pulls:
                return False
            self._allocated_pulls.add(key)
            return True

    def claim_pull(self, *, kind: Literal["skill", "file"], name: str) -> bool:
        """Consume one previously allocated run-scoped Config item exactly once."""
        key = (kind, name)
        with self._pull_lock:
            if key not in self._allocated_pulls or key in self._claimed_pulls:
                return False
            self._claimed_pulls.add(key)
            return True

    def data_url(self, *, kind: Literal["skill", "file"], name: str) -> str:
        host, port = self.server_address[:2]
        return f"http://{host}:{port}{_DATA_PREFIX}{kind}/{name}"


class _E2BConfigStubHandler(BaseHTTPRequestHandler):
    def do_POST(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler API
        path = unquote(urlsplit(self.path).path)
        if path != _DOWNLOAD_REQUEST_PATH:
            self.send_error(404, "not found")
            return

        try:
            request = self._read_json_request()
            config = request.get("config")
            if not isinstance(config, dict):
                raise ValueError("config source is required")
            source = cast(dict[str, object], config)
            kind = source.get("kind")
            name = source.get("name")
            if kind not in {"skill", "file"} or not isinstance(name, str):
                raise ValueError("config source must contain a valid kind and name")
            typed_kind = cast(Literal["skill", "file"], kind)
            if request.get("for_frontend") is not False:
                raise ValueError("Config downloads require for_frontend=false")
            if not _is_safe_name(name) or not _is_fixed_scenario_item(name, kind=typed_kind):
                raise ValueError("invalid Config item name")
        except (UnicodeDecodeError, json.JSONDecodeError, ValueError) as exc:
            self.send_error(400, str(exc))
            return

        server = self._server()
        if not server.allocate_pull(kind=typed_kind, name=name):
            self.send_error(409, "Config item was already downloaded")
            return
        payload = _config_payload(kind=typed_kind, name=name, content_bytes=self._item_bytes())
        self._write_json_response(
            status=200,
            payload={
                "filename": f"{name}.zip" if typed_kind == "skill" else name,
                "mime_type": "application/zip" if typed_kind == "skill" else "application/octet-stream",
                "size": len(payload),
                "download_url": server.data_url(kind=typed_kind, name=name),
            },
        )

    def do_GET(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler API
        path = unquote(urlsplit(self.path).path)
        if path == _HEALTH_PATH:
            self._write_response(status=200, content_type="application/json", body=b'{"status":"ok"}')
            return

        item = _data_item(path)
        if item is not None:
            kind, name = item
            if not _is_safe_name(name) or not _is_fixed_scenario_item(name, kind=kind):
                self.send_error(400, "invalid Config item name")
                return
            if not self._server().claim_pull(kind=kind, name=name):
                self.send_error(409, "Config item was not allocated or was already downloaded")
                return
            self._write_response(
                status=200,
                content_type="application/zip" if kind == "skill" else "application/octet-stream",
                body=_config_payload(kind=kind, name=name, content_bytes=self._item_bytes()),
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

    def _write_json_response(self, *, status: int, payload: dict[str, object]) -> None:
        self._write_response(
            status=status,
            content_type="application/json",
            body=json.dumps(payload, separators=(",", ":"), sort_keys=True).encode(),
        )

    def _read_json_request(self) -> dict[str, object]:
        raw_length = self.headers.get("Content-Length")
        if raw_length is None:
            raise ValueError("Content-Length is required")
        try:
            length = int(raw_length)
        except ValueError as exc:
            raise ValueError("Content-Length must be an integer") from exc
        if not 1 <= length <= _MAX_REQUEST_BODY_BYTES:
            raise ValueError("request body size is invalid")
        payload = json.loads(self.rfile.read(length).decode())
        if not isinstance(payload, dict):
            raise ValueError("request body must be a JSON object")
        return cast(dict[str, object], payload)

    def _item_bytes(self) -> int:
        return self._server().item_bytes

    def _server(self) -> E2BConfigStubServer:
        if not isinstance(self.server, E2BConfigStubServer):
            raise TypeError("Config Stub handler requires E2BConfigStubServer")
        return self.server


def build_server(*, host: str, port: int, item_bytes: int) -> E2BConfigStubServer:
    """Build a server that callers may run or shut down explicitly."""
    return E2BConfigStubServer((host, port), item_bytes=item_bytes)


def _data_item(path: str) -> tuple[Literal["skill", "file"], str] | None:
    if not path.startswith(_DATA_PREFIX):
        return None
    relative_path = path.removeprefix(_DATA_PREFIX)
    kind, separator, name = relative_path.partition("/")
    if not separator or "/" in name or kind not in {"skill", "file"}:
        return None
    return cast(Literal["skill", "file"], kind), name


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


def _config_payload(*, kind: Literal["skill", "file"], name: str, content_bytes: int) -> bytes:
    if kind == "skill":
        return _skill_archive(name=name, content_bytes=content_bytes)
    return fixed_payload(f"config:{name}", content_bytes)


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
