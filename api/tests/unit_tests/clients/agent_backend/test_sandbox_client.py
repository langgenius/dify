"""Unit tests for the API-side sandbox backend client."""

from __future__ import annotations

from collections.abc import Callable

import httpx
import pytest
from agenton.compositor import CompositorSessionSnapshot
from agenton.compositor.schemas import LayerSessionSnapshot
from agenton.layers.base import LifecycleState
from dify_agent.layers.execution_context import DifyExecutionContextLayerConfig
from dify_agent.protocol import RunComposition, RunLayerSpec, SandboxLocator

from clients.agent_backend.errors import AgentBackendHTTPError, AgentBackendTransportError
from clients.agent_backend.sandbox_client import SandboxBackendClient


def _locator() -> SandboxLocator:
    return SandboxLocator(
        composition=RunComposition(
            layers=[
                RunLayerSpec(
                    name="execution_context",
                    type="dify.execution_context",
                    config=DifyExecutionContextLayerConfig(
                        tenant_id="tenant-1",
                        user_from="account",
                        agent_mode="agent_app",
                        invoke_from="service-api",
                    ),
                ),
                RunLayerSpec(
                    name="shell",
                    type="dify.shell",
                    deps={"execution_context": "execution_context"},
                    config={},
                ),
            ]
        ),
        session_snapshot=CompositorSessionSnapshot(
            layers=[
                LayerSessionSnapshot(name="execution_context", lifecycle_state=LifecycleState.SUSPENDED, runtime_state={}),
                LayerSessionSnapshot(
                    name="shell",
                    lifecycle_state=LifecycleState.SUSPENDED,
                    runtime_state={"session_id": "abc12ff", "workspace_cwd": "~/workspace/abc12ff"},
                ),
            ]
        ),
    )


def _client(handler: Callable[[httpx.Request], httpx.Response]) -> SandboxBackendClient:
    return SandboxBackendClient("http://backend", transport=httpx.MockTransport(handler))


def test_list_files_posts_locator_without_session_id() -> None:
    locator = _locator()

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/sandbox/files/list"
        body = request.read().decode()
        assert '"locator"' in body
        assert "/workspaces/" not in str(request.url)
        return httpx.Response(200, json={"path": ".", "entries": [], "truncated": False})

    result = _client(handler).list_files(locator=locator, path=".")

    assert result.path == "."


def test_read_file_parses_text_payload() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/sandbox/files/read"
        return httpx.Response(200, json={"path": "note.txt", "size": 5, "truncated": False, "binary": False, "text": "hello"})

    result = _client(handler).read_file(locator=_locator(), path="note.txt")

    assert result.text == "hello"


def test_upload_file_parses_tool_file_mapping() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/sandbox/files/upload"
        return httpx.Response(
            200,
            json={"path": "report.txt", "file": {"transfer_method": "tool_file", "reference": "dify-file-ref:file-1"}},
        )

    result = _client(handler).upload_file(locator=_locator(), path="report.txt")

    assert result.file.reference == "dify-file-ref:file-1"


def test_http_error_preserves_status_and_detail() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(404, json={"detail": {"code": "sandbox_path_not_found", "message": "missing"}})

    with pytest.raises(AgentBackendHTTPError) as exc_info:
        _client(handler).list_files(locator=_locator(), path="missing")

    assert exc_info.value.status_code == 404
    assert exc_info.value.detail == {"code": "sandbox_path_not_found", "message": "missing"}


def test_transport_failure_becomes_transport_error() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused")

    with pytest.raises(AgentBackendTransportError):
        _client(handler).list_files(locator=_locator(), path=".")


def test_success_response_with_invalid_json_is_normalized_to_http_error() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, text="not-json")

    with pytest.raises(AgentBackendHTTPError) as exc_info:
        _client(handler).read_file(locator=_locator(), path="note.txt")

    assert exc_info.value.status_code == 502
    assert exc_info.value.detail == "not-json"
