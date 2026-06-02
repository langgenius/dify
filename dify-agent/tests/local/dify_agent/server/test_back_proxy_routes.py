from __future__ import annotations

import base64
import secrets
import time

from fastapi import FastAPI
from fastapi.testclient import TestClient

from dify_agent.layers.execution_context import DifyExecutionContextLayerConfig
from dify_agent.server.routes.back_proxy import create_back_proxy_router
from dify_agent.server.tokens.back_proxy import BackProxyTokenCodec


def _base64url_secret(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def _token_codec() -> BackProxyTokenCodec:
    return BackProxyTokenCodec.from_server_secret(_base64url_secret(secrets.token_bytes(32)))


def _execution_context() -> DifyExecutionContextLayerConfig:
    return DifyExecutionContextLayerConfig(tenant_id="tenant-1", user_id="user-1", invoke_from="workflow_run")


def test_back_proxy_connections_route_returns_connected_for_valid_bearer_jwe() -> None:
    codec = _token_codec()
    token = codec.encode_connection_token(_execution_context(), session_id="abc12ff", now=int(time.time()) - 1)
    app = FastAPI()
    app.include_router(create_back_proxy_router(lambda: codec))
    client = TestClient(app)

    response = client.post(
        "/back-proxy/connections",
        headers={"Authorization": f"Bearer {token}"},
        json={"protocol_version": 1, "argv": ["connect", "--", "echo", "hello"], "metadata": {"source": "cli"}},
    )

    assert response.status_code == 200
    assert response.json()["status"] == "connected"
    assert isinstance(response.json()["connection_id"], str)


def test_back_proxy_connections_route_returns_401_for_missing_authorization() -> None:
    codec = _token_codec()
    app = FastAPI()
    app.include_router(create_back_proxy_router(lambda: codec))
    client = TestClient(app)

    response = client.post("/back-proxy/connections", json={"protocol_version": 1, "argv": []})

    assert response.status_code == 401
    assert response.json()["detail"] == "invalid or missing back proxy authorization"


def test_back_proxy_connections_route_returns_401_for_invalid_bearer_token() -> None:
    codec = _token_codec()
    app = FastAPI()
    app.include_router(create_back_proxy_router(lambda: codec))
    client = TestClient(app)

    response = client.post(
        "/back-proxy/connections",
        headers={"Authorization": "Bearer invalid-token"},
        json={"protocol_version": 1, "argv": []},
    )

    assert response.status_code == 401
    assert response.json()["detail"] == "invalid or missing back proxy authorization"


def test_back_proxy_connections_route_returns_503_when_server_has_no_back_proxy_key() -> None:
    app = FastAPI()
    app.include_router(create_back_proxy_router(lambda: None))
    client = TestClient(app)

    response = client.post(
        "/back-proxy/connections",
        headers={"Authorization": "Bearer token"},
        json={"protocol_version": 1, "argv": []},
    )

    assert response.status_code == 503
    assert response.json()["detail"] == "shell back proxy is not configured"


def test_back_proxy_connections_route_returns_422_for_invalid_request_body() -> None:
    codec = _token_codec()
    token = codec.encode_connection_token(_execution_context(), session_id="abc12ff", now=int(time.time()) - 1)
    app = FastAPI()
    app.include_router(create_back_proxy_router(lambda: codec))
    client = TestClient(app)

    response = client.post(
        "/back-proxy/connections",
        headers={"Authorization": f"Bearer {token}"},
        json={"protocol_version": 2, "argv": "not-a-list"},
    )

    assert response.status_code == 422
