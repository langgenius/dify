"""Unit tests for the API-side workspace files backend client."""

from __future__ import annotations

import base64
import json
from collections.abc import Callable

import httpx
import pytest

from clients.agent_backend.errors import AgentBackendHTTPError, AgentBackendTransportError
from clients.agent_backend.workspace_files_client import WorkspaceFilesBackendClient


def _client(handler: Callable[[httpx.Request], httpx.Response]) -> WorkspaceFilesBackendClient:
    return WorkspaceFilesBackendClient("http://backend", transport=httpx.MockTransport(handler))


def test_list_files_parses_entries() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/workspaces/abc1234/files"
        assert request.url.params.get("path") == "sub"
        return httpx.Response(
            200,
            json={
                "path": "sub",
                "entries": [{"name": "a.txt", "type": "file", "size": 3, "mtime": 10}],
                "truncated": False,
            },
        )

    result = _client(handler).list_files("abc1234", "sub")

    assert result.path == "sub"
    assert result.entries[0].name == "a.txt"
    assert result.entries[0].type == "file"
    assert result.truncated is False


def test_preview_parses_text() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/workspaces/abc1234/files/preview"
        return httpx.Response(200, json={"path": "n.txt", "size": 5, "truncated": False, "binary": False, "text": "hello"})

    result = _client(handler).preview("abc1234", "n.txt")

    assert result.binary is False
    assert result.text == "hello"


def test_download_decodes_base64_to_bytes() -> None:
    raw = bytes(range(64))

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/workspaces/abc1234/files/download"
        return httpx.Response(
            200,
            json={"path": "b.bin", "size": len(raw), "truncated": False, "content_base64": base64.b64encode(raw).decode()},
        )

    result = _client(handler).download("abc1234", "b.bin")

    assert result.content == raw
    assert result.size == 64


def test_http_error_preserves_status_and_detail() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(404, json={"detail": {"code": "not_found", "message": "path not found in workspace"}})

    with pytest.raises(AgentBackendHTTPError) as exc_info:
        _client(handler).list_files("abc1234", "missing")

    assert exc_info.value.status_code == 404
    assert exc_info.value.detail == {"code": "not_found", "message": "path not found in workspace"}


def test_transport_failure_becomes_transport_error() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused")

    with pytest.raises(AgentBackendTransportError):
        _client(handler).list_files("abc1234", ".")


def test_download_without_content_is_502() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"path": "b.bin", "size": 0, "truncated": False})

    with pytest.raises(AgentBackendHTTPError) as exc_info:
        _client(handler).download("abc1234", "b.bin")

    assert exc_info.value.status_code == 502


def test_non_object_body_is_502() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=json.dumps([1, 2, 3]), headers={"content-type": "application/json"})

    with pytest.raises(AgentBackendHTTPError) as exc_info:
        _client(handler).list_files("abc1234", ".")

    assert exc_info.value.status_code == 502
