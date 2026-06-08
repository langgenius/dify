from __future__ import annotations

import base64
import secrets
import time
from typing import cast

from fastapi import FastAPI
from fastapi.testclient import TestClient

from dify_agent.agent_stub.protocol.back_proxy import BackProxyFileDownloadResponse, BackProxyFileUploadResponse
from dify_agent.agent_stub.server.back_proxy_files import BackProxyFileRequestError, BackProxyFileRequestHandler
from dify_agent.agent_stub.server.routes.back_proxy import create_back_proxy_router
from dify_agent.agent_stub.server.tokens.back_proxy import BackProxyTokenCodec
from dify_agent.layers.execution_context import DifyExecutionContextLayerConfig


def _base64url_secret(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def _token_codec() -> BackProxyTokenCodec:
    return BackProxyTokenCodec.from_server_secret(_base64url_secret(secrets.token_bytes(32)))


def _execution_context() -> DifyExecutionContextLayerConfig:
    return DifyExecutionContextLayerConfig(
        tenant_id="tenant-1",
        user_id="user-1",
        user_from="account",
        agent_mode="workflow_run",
        invoke_from="service-api",
    )


def _reference(record_id: str) -> str:
    encoded = base64.urlsafe_b64encode(f'{{"record_id":"{record_id}"}}'.encode()).decode()
    return f"dify-file-ref:{encoded}"


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


def test_back_proxy_file_upload_route_forwards_authenticated_request() -> None:
    codec = _token_codec()
    token = codec.encode_connection_token(_execution_context(), now=int(time.time()) - 1)

    class FakeHandler:
        async def create_upload_request(self, *, principal, request):
            assert principal.execution_context.tenant_id == "tenant-1"
            assert request.filename == "report.pdf"
            return BackProxyFileUploadResponse(upload_url="https://files.example.com/upload")

        async def create_download_request(self, *, principal, request):
            del principal, request
            raise AssertionError("unexpected download request")

    handler = cast(BackProxyFileRequestHandler, cast(object, FakeHandler()))
    app = FastAPI()
    app.include_router(create_back_proxy_router(lambda: codec, lambda: handler))
    client = TestClient(app)

    response = client.post(
        "/back-proxy/files/upload-request",
        headers={"Authorization": f"Bearer {token}"},
        json={"filename": "report.pdf", "mimetype": "application/pdf"},
    )

    assert response.status_code == 200
    assert response.json() == {"upload_url": "https://files.example.com/upload"}


def test_back_proxy_file_download_route_forwards_authenticated_request() -> None:
    codec = _token_codec()
    token = codec.encode_connection_token(_execution_context(), now=int(time.time()) - 1)

    class FakeHandler:
        async def create_download_request(self, *, principal, request):
            assert principal.execution_context.user_id == "user-1"
            assert request.file.transfer_method == "tool_file"
            return BackProxyFileDownloadResponse(
                filename="report.pdf",
                mime_type="application/pdf",
                size=123,
                download_url="https://files.example.com/download",
            )

        async def create_upload_request(self, *, principal, request):
            del principal, request
            raise AssertionError("unexpected upload request")

    handler = cast(BackProxyFileRequestHandler, cast(object, FakeHandler()))
    app = FastAPI()
    app.include_router(create_back_proxy_router(lambda: codec, lambda: handler))
    client = TestClient(app)

    response = client.post(
        "/back-proxy/files/download-request",
        headers={"Authorization": f"Bearer {token}"},
        json={"file": {"transfer_method": "tool_file", "reference": _reference("tool-file-1")}},
    )

    assert response.status_code == 200
    assert response.json() == {
        "filename": "report.pdf",
        "mime_type": "application/pdf",
        "size": 123,
        "download_url": "https://files.example.com/download",
    }


def test_back_proxy_file_routes_return_503_when_file_api_is_unconfigured() -> None:
    codec = _token_codec()
    token = codec.encode_connection_token(_execution_context(), now=int(time.time()) - 1)
    app = FastAPI()
    app.include_router(create_back_proxy_router(lambda: codec, lambda: None))
    client = TestClient(app)

    upload_response = client.post(
        "/back-proxy/files/upload-request",
        headers={"Authorization": f"Bearer {token}"},
        json={"filename": "report.pdf", "mimetype": "application/pdf"},
    )
    download_response = client.post(
        "/back-proxy/files/download-request",
        headers={"Authorization": f"Bearer {token}"},
        json={"file": {"transfer_method": "tool_file", "reference": _reference("tool-file-1")}},
    )

    assert upload_response.status_code == 503
    assert download_response.status_code == 503
    assert upload_response.json()["detail"] == "shell back proxy file API is not configured"
    assert download_response.json()["detail"] == "shell back proxy file API is not configured"


def test_back_proxy_file_route_maps_handler_errors_to_http_errors() -> None:
    codec = _token_codec()
    token = codec.encode_connection_token(_execution_context(), now=int(time.time()) - 1)

    class FakeHandler:
        async def create_upload_request(self, *, principal, request):
            del principal, request
            raise BackProxyFileRequestError(400, "bad request")

        async def create_download_request(self, *, principal, request):
            del principal, request
            raise AssertionError("unexpected download request")

    handler = cast(BackProxyFileRequestHandler, cast(object, FakeHandler()))
    app = FastAPI()
    app.include_router(create_back_proxy_router(lambda: codec, lambda: handler))
    client = TestClient(app)

    response = client.post(
        "/back-proxy/files/upload-request",
        headers={"Authorization": f"Bearer {token}"},
        json={"filename": "report.pdf", "mimetype": "application/pdf"},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "bad request"
