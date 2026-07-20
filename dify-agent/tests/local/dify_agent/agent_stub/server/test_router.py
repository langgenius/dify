from __future__ import annotations

import base64
import time

from fastapi import FastAPI
from fastapi.testclient import TestClient

from dify_agent.agent_stub.server.router import create_agent_stub_router
from dify_agent.agent_stub.server.tokens.agent_stub import AgentStubTokenCodec
from dify_agent.layers.execution_context import DifyExecutionContextLayerConfig


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


def _token_codec() -> AgentStubTokenCodec:
    return AgentStubTokenCodec.from_server_secret(_base64url_secret(b"1" * 32))


def test_create_agent_stub_router_mounts_all_agent_stub_routes() -> None:
    app = FastAPI()
    app.include_router(create_agent_stub_router(token_codec=None))

    paths = {getattr(route, "path", None) for route in app.routes}

    assert "/agent-stub/connections" in paths
    assert "/agent-stub/files/upload-request" in paths
    assert "/agent-stub/files/download-request" in paths


def test_create_agent_stub_router_returns_503_for_unconfigured_services() -> None:
    app = FastAPI()
    app.include_router(create_agent_stub_router(token_codec=None))
    client = TestClient(app)

    response = client.post(
        "/agent-stub/connections",
        headers={"Authorization": "Bearer token"},
        json={"protocol_version": 1, "argv": []},
    )

    assert response.status_code == 503
    assert response.json()["detail"] == "Agent Stub is not configured"


def test_create_agent_stub_router_wires_configured_token_codec_for_connections() -> None:
    token_codec = _token_codec()
    token = token_codec.encode_connection_token(_execution_context(), now=int(time.time()) - 1)

    app = FastAPI()
    app.include_router(create_agent_stub_router(token_codec=token_codec))
    client = TestClient(app)

    response = client.post(
        "/agent-stub/connections",
        headers={"Authorization": f"Bearer {token}"},
        json={"protocol_version": 1, "argv": ["connect"]},
    )

    assert response.status_code == 200
    assert response.json()["status"] == "connected"
    assert isinstance(response.json()["connection_id"], str)
