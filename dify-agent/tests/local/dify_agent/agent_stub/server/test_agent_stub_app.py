from __future__ import annotations

import base64
import importlib
import time

import httpx
from fastapi.testclient import TestClient

from dify_agent.agent_stub.server.app import create_agent_stub_app
from dify_agent.layers.execution_context import DifyExecutionContextLayerConfig
from dify_agent.server.settings import ServerSettings


def _base64url_secret(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def _execution_context() -> DifyExecutionContextLayerConfig:
    return DifyExecutionContextLayerConfig(
        tenant_id="tenant-1",
        user_id="user-1",
        user_from="account",
        agent_mode="workflow_run",
        invoke_from="service-api",
    )


def test_create_agent_stub_app_exposes_same_stub_routes_as_module_app() -> None:
    stub_app_module = importlib.import_module("dify_agent.agent_stub.server.app")
    settings = ServerSettings(
        agent_stub_url="https://agent.example.com/agent-stub",
        server_secret_key=_base64url_secret(b"1" * 32),
    )

    created_paths = {getattr(route, "path", None) for route in create_agent_stub_app(settings).routes}
    module_paths = {getattr(route, "path", None) for route in stub_app_module.app.routes}

    assert "/agent-stub/connections" in created_paths
    assert "/agent-stub/files/upload-request" in created_paths
    assert "/agent-stub/files/download-request" in created_paths
    assert created_paths == module_paths


def test_create_agent_stub_app_can_serve_requests() -> None:
    app = create_agent_stub_app(ServerSettings())
    client = TestClient(app)

    response = client.post(
        "/agent-stub/connections",
        headers={"Authorization": "Bearer token"},
        json={"protocol_version": 1, "argv": []},
    )

    assert response.status_code == 503
    assert response.json()["detail"] == "Agent Stub is not configured"


def test_create_agent_stub_app_wires_configured_file_handler_for_upload_requests(monkeypatch) -> None:
    settings = ServerSettings(
        agent_stub_url="https://agent.example.com/agent-stub",
        server_secret_key=_base64url_secret(b"1" * 32),
        dify_api_base_url="https://api.example.com",
        dify_api_inner_api_key="inner-secret",
    )
    token_codec = settings.create_agent_stub_token_codec()
    assert token_codec is not None
    token = token_codec.encode_connection_token(_execution_context(), now=int(time.time()) - 1)

    original_async_client = httpx.AsyncClient

    def handler(request: httpx.Request) -> httpx.Response:
        assert str(request.url) == "https://api.example.com/inner/api/upload/file/request"
        assert request.headers["X-Inner-Api-Key"] == "inner-secret"
        return httpx.Response(200, json={"data": {"url": "https://files.example.com/upload"}})

    monkeypatch.setattr(
        "dify_agent.agent_stub.server.agent_stub_files.httpx.AsyncClient",
        lambda **kwargs: original_async_client(transport=httpx.MockTransport(handler), **kwargs),
    )

    client = TestClient(create_agent_stub_app(settings))
    response = client.post(
        "/agent-stub/files/upload-request",
        headers={"Authorization": f"Bearer {token}"},
        json={"filename": "report.pdf", "mimetype": "application/pdf"},
    )

    assert response.status_code == 200
    assert response.json() == {"upload_url": "https://files.example.com/upload"}
