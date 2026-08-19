from __future__ import annotations

import base64
import secrets
import time
from typing import cast

from fastapi import FastAPI
from fastapi.testclient import TestClient

from dify_agent.agent_stub.protocol.agent_stub import AgentStubFileDownloadResponse, AgentStubFileUploadResponse
from dify_agent.agent_stub.server.agent_stub_files import AgentStubFileRequestError, AgentStubFileRequestHandler
from dify_agent.agent_stub.server.routes.agent_stub import create_agent_stub_http_router
from dify_agent.agent_stub.server.tokens.agent_stub import AGENT_STUB_TOKEN_TTL_SECONDS, AgentStubTokenCodec
from dify_agent.layers.execution_context import DifyExecutionContextLayerConfig


def _base64url_secret(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def _token_codec() -> AgentStubTokenCodec:
    return AgentStubTokenCodec.from_server_secret(_base64url_secret(secrets.token_bytes(32)))


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


def test_agent_stub_connections_route_returns_connected_for_valid_bearer_jwe() -> None:
    codec = _token_codec()
    token = codec.encode_connection_token(_execution_context(), session_id="abc12ff", now=int(time.time()) - 1)
    app = FastAPI()
    app.include_router(create_agent_stub_http_router(codec))
    client = TestClient(app)

    response = client.post(
        "/agent-stub/connections",
        headers={"Authorization": f"Bearer {token}"},
        json={"protocol_version": 1, "argv": ["connect", "--", "echo", "hello"], "metadata": {"source": "cli"}},
    )

    assert response.status_code == 200
    assert response.json()["status"] == "connected"
    assert isinstance(response.json()["connection_id"], str)


def test_agent_stub_connections_route_returns_401_for_missing_authorization() -> None:
    codec = _token_codec()
    app = FastAPI()
    app.include_router(create_agent_stub_http_router(codec))
    client = TestClient(app)

    response = client.post("/agent-stub/connections", json={"protocol_version": 1, "argv": []})

    assert response.status_code == 401
    assert response.json()["detail"] == "invalid or missing Agent Stub authorization"


def test_agent_stub_connections_route_returns_401_for_invalid_bearer_token() -> None:
    codec = _token_codec()
    app = FastAPI()
    app.include_router(create_agent_stub_http_router(codec))
    client = TestClient(app)

    response = client.post(
        "/agent-stub/connections",
        headers={"Authorization": "Bearer invalid-token"},
        json={"protocol_version": 1, "argv": []},
    )

    assert response.status_code == 401
    assert response.json()["detail"] == "invalid or missing Agent Stub authorization"


def test_agent_stub_connections_route_returns_structured_401_for_expired_bearer_token() -> None:
    codec = _token_codec()
    token = codec.encode_connection_token(
        _execution_context(),
        now=int(time.time()) - AGENT_STUB_TOKEN_TTL_SECONDS - 1,
    )
    app = FastAPI()
    app.include_router(create_agent_stub_http_router(codec))
    client = TestClient(app)

    response = client.post(
        "/agent-stub/connections",
        headers={"Authorization": f"Bearer {token}"},
        json={"protocol_version": 1, "argv": []},
    )

    assert response.status_code == 401
    assert response.json()["detail"] == {
        "code": "agent_stub_authorization_expired",
        "message": "Agent Stub authorization expired after 5 minutes; start a new shell tool call and retry the command.",
    }


def test_agent_stub_file_upload_route_exposes_expiration_when_requested() -> None:
    codec = _token_codec()
    token = codec.encode_connection_token(
        _execution_context(),
        now=int(time.time()) - AGENT_STUB_TOKEN_TTL_SECONDS - 1,
    )
    app = FastAPI()
    app.include_router(create_agent_stub_http_router(codec))
    client = TestClient(app)
    headers = {"Authorization": f"Bearer {token}"}
    payload = {"filename": "report.pdf", "mimetype": "application/pdf"}

    opted_in_response = client.post(
        "/agent-stub/files/upload-request",
        headers=headers,
        params={"expose_expiration": "true"},
        json=payload,
    )

    assert opted_in_response.status_code == 401
    assert opted_in_response.json()["detail"]["code"] == "agent_stub_authorization_expired"


def test_agent_stub_file_download_and_config_routes_return_structured_401_for_expired_token() -> None:
    codec = _token_codec()
    token = codec.encode_connection_token(
        _execution_context(),
        now=int(time.time()) - AGENT_STUB_TOKEN_TTL_SECONDS - 1,
    )
    app = FastAPI()
    app.include_router(create_agent_stub_http_router(codec))
    client = TestClient(app)
    headers = {"Authorization": f"Bearer {token}"}
    expected_detail = {
        "code": "agent_stub_authorization_expired",
        "message": "Agent Stub authorization expired after 5 minutes; start a new shell tool call and retry the command.",
    }

    responses = [
        client.post(
            "/agent-stub/files/download-request",
            headers=headers,
            json={"file": {"transfer_method": "tool_file", "reference": _reference("tool-file-1")}},
        ),
        client.get("/agent-stub/config/manifest", headers=headers),
    ]

    for response in responses:
        assert response.status_code == 401
        assert response.json()["detail"] == expected_detail


def test_agent_stub_connections_route_returns_503_when_server_has_no_token_codec() -> None:
    app = FastAPI()
    app.include_router(create_agent_stub_http_router(None))
    client = TestClient(app)

    response = client.post(
        "/agent-stub/connections",
        headers={"Authorization": "Bearer token"},
        json={"protocol_version": 1, "argv": []},
    )

    assert response.status_code == 503
    assert response.json()["detail"] == "Agent Stub is not configured"


def test_agent_stub_connections_route_returns_422_for_invalid_request_body() -> None:
    codec = _token_codec()
    token = codec.encode_connection_token(_execution_context(), session_id="abc12ff", now=int(time.time()) - 1)
    app = FastAPI()
    app.include_router(create_agent_stub_http_router(codec))
    client = TestClient(app)

    response = client.post(
        "/agent-stub/connections",
        headers={"Authorization": f"Bearer {token}"},
        json={"protocol_version": 2, "argv": "not-a-list"},
    )

    assert response.status_code == 422


def test_agent_stub_file_upload_route_forwards_authenticated_request() -> None:
    codec = _token_codec()
    token = codec.encode_connection_token(_execution_context(), now=int(time.time()) - 1)

    class FakeHandler:
        async def create_upload_request(self, *, principal, request):
            assert principal.execution_context.tenant_id == "tenant-1"
            assert request.filename == "report.pdf"
            return AgentStubFileUploadResponse(upload_url="https://files.example.com/upload")

        async def create_download_request(self, *, principal, request):
            del principal, request
            raise AssertionError("unexpected download request")

    handler = cast(AgentStubFileRequestHandler, cast(object, FakeHandler()))
    app = FastAPI()
    app.include_router(create_agent_stub_http_router(codec, handler))
    client = TestClient(app)

    response = client.post(
        "/agent-stub/files/upload-request",
        headers={"Authorization": f"Bearer {token}"},
        json={"filename": "report.pdf", "mimetype": "application/pdf"},
    )

    assert response.status_code == 200
    assert response.json() == {"upload_url": "https://files.example.com/upload"}


def test_agent_stub_file_download_route_forwards_authenticated_request() -> None:
    codec = _token_codec()
    token = codec.encode_connection_token(_execution_context(), now=int(time.time()) - 1)

    class FakeHandler:
        async def create_download_request(self, *, principal, request):
            assert principal.execution_context.user_id == "user-1"
            assert request.file is not None
            assert request.file.transfer_method == "tool_file"
            return AgentStubFileDownloadResponse(
                filename="report.pdf",
                mime_type="application/pdf",
                size=123,
                download_url="https://files.example.com/download",
            )

        async def create_upload_request(self, *, principal, request):
            del principal, request
            raise AssertionError("unexpected upload request")

    handler = cast(AgentStubFileRequestHandler, cast(object, FakeHandler()))
    app = FastAPI()
    app.include_router(create_agent_stub_http_router(codec, handler))
    client = TestClient(app)

    response = client.post(
        "/agent-stub/files/download-request",
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


def test_agent_stub_file_routes_return_503_when_file_api_is_unconfigured() -> None:
    codec = _token_codec()
    token = codec.encode_connection_token(_execution_context(), now=int(time.time()) - 1)
    app = FastAPI()
    app.include_router(create_agent_stub_http_router(codec, None))
    client = TestClient(app)

    upload_response = client.post(
        "/agent-stub/files/upload-request",
        headers={"Authorization": f"Bearer {token}"},
        json={"filename": "report.pdf", "mimetype": "application/pdf"},
    )
    download_response = client.post(
        "/agent-stub/files/download-request",
        headers={"Authorization": f"Bearer {token}"},
        json={"file": {"transfer_method": "tool_file", "reference": _reference("tool-file-1")}},
    )

    assert upload_response.status_code == 503
    assert download_response.status_code == 503
    assert upload_response.json()["detail"] == "Agent Stub file API is not configured"
    assert download_response.json()["detail"] == "Agent Stub file API is not configured"


def test_agent_stub_file_route_maps_handler_errors_to_http_errors() -> None:
    codec = _token_codec()
    token = codec.encode_connection_token(_execution_context(), now=int(time.time()) - 1)

    class FakeHandler:
        async def create_upload_request(self, *, principal, request):
            del principal, request
            raise AgentStubFileRequestError(400, "bad request")

        async def create_download_request(self, *, principal, request):
            del principal, request
            raise AssertionError("unexpected download request")

    handler = cast(AgentStubFileRequestHandler, cast(object, FakeHandler()))
    app = FastAPI()
    app.include_router(create_agent_stub_http_router(codec, handler))
    client = TestClient(app)

    response = client.post(
        "/agent-stub/files/upload-request",
        headers={"Authorization": f"Bearer {token}"},
        json={"filename": "report.pdf", "mimetype": "application/pdf"},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "bad request"


def test_agent_stub_file_route_preserves_structured_handler_error_details() -> None:
    codec = _token_codec()
    token = codec.encode_connection_token(_execution_context(), now=int(time.time()) - 1)

    class FakeHandler:
        async def create_upload_request(self, *, principal, request):
            del principal, request
            raise AgentStubFileRequestError(400, {"detail": "bad request", "code": "inner_api_error"})

        async def create_download_request(self, *, principal, request):
            del principal, request
            raise AssertionError("unexpected download request")

    handler = cast(AgentStubFileRequestHandler, cast(object, FakeHandler()))
    app = FastAPI()
    app.include_router(create_agent_stub_http_router(codec, handler))
    client = TestClient(app)

    response = client.post(
        "/agent-stub/files/upload-request",
        headers={"Authorization": f"Bearer {token}"},
        json={"filename": "report.pdf", "mimetype": "application/pdf"},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == {"detail": "bad request", "code": "inner_api_error"}
