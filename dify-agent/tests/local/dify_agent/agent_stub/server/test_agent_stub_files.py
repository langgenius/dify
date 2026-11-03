from __future__ import annotations

import asyncio
import base64
import json

import httpx
import pytest

from dify_agent.agent_stub.protocol.agent_stub import (
    AgentStubFileDownloadRequest,
    AgentStubFileMapping,
    AgentStubFileUploadRequest,
)
from dify_agent.agent_stub.server.agent_stub_files import AgentStubFileRequestError, DifyApiAgentStubFileRequestHandler
from dify_agent.agent_stub.server.tokens.agent_stub import AgentStubPrincipal
from dify_agent.layers.execution_context import DifyExecutionContextLayerConfig


def _principal() -> AgentStubPrincipal:
    return AgentStubPrincipal(
        execution_context=DifyExecutionContextLayerConfig(
            tenant_id="tenant-1",
            user_id="user-1",
            user_from="account",
            workflow_id="workflow-1",
            conversation_id="conversation-1",
            agent_mode="workflow_run",
            invoke_from="service-api",
        ),
        session_id="session-1",
        scope=["agent_stub:connect"],
        token_id="token-1",
    )


def _patch_async_client(monkeypatch: pytest.MonkeyPatch, handler) -> None:
    original_async_client = httpx.AsyncClient
    monkeypatch.setattr(
        "dify_agent.agent_stub.server.agent_stub_files.httpx.AsyncClient",
        lambda **kwargs: original_async_client(transport=httpx.MockTransport(handler), **kwargs),
    )


def _file_handler(*, sandbox_files_base_url: str = "https://sandbox-files.example.com/dify"):
    return DifyApiAgentStubFileRequestHandler(
        inner_api_url="https://api.internal.example.com",
        inner_api_key="inner-secret",
        sandbox_files_base_url=sandbox_files_base_url,
        max_upload_size_bytes=50 * 1024 * 1024,
    )


def _reference(record_id: str) -> str:
    payload = base64.urlsafe_b64encode(json.dumps({"record_id": record_id}, separators=(",", ":")).encode()).decode()
    return f"dify-file-ref:{payload}"


def test_upload_request_uses_agent_inner_endpoint_and_binds_sandbox_base(monkeypatch: pytest.MonkeyPatch) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert str(request.url) == "https://api.internal.example.com/inner/api/agent/files/upload-request"
        assert request.headers["X-Inner-Api-Key"] == "inner-secret"
        assert json.loads(request.content) == {
            "tenant_id": "tenant-1",
            "user_id": "user-1",
            "user_from": "account",
            "filename": "report.pdf",
            "mimetype": "application/pdf",
            "conversation_id": "conversation-1",
            "max_size": 50 * 1024 * 1024,
        }
        return httpx.Response(200, json={"upload_uri": "/files/upload/for-plugin?signed=yes"})

    _patch_async_client(monkeypatch, handler)

    async def scenario() -> None:
        response = await _file_handler().create_upload_request(
            principal=_principal(),
            request=AgentStubFileUploadRequest(filename="report.pdf", mimetype="application/pdf"),
        )
        assert response.upload_url == "https://sandbox-files.example.com/dify/files/upload/for-plugin?signed=yes"

    asyncio.run(scenario())


def test_sandbox_download_request_binds_origin_free_uri(monkeypatch: pytest.MonkeyPatch) -> None:
    reference = _reference("tool-file-1")

    def handler(request: httpx.Request) -> httpx.Response:
        assert str(request.url) == "https://api.internal.example.com/inner/api/agent/files/download-request"
        assert json.loads(request.content) == {
            "tenant_id": "tenant-1",
            "user_id": "user-1",
            "user_from": "account",
            "invoke_from": "service-api",
            "file": {"transfer_method": "tool_file", "reference": reference},
            "for_frontend": False,
        }
        return httpx.Response(
            200,
            json={
                "filename": "report.pdf",
                "mime_type": "application/pdf",
                "size": 123,
                "download_uri": "/files/tools/tool-file-1.pdf?sign=1",
            },
        )

    _patch_async_client(monkeypatch, handler)

    async def scenario() -> None:
        response = await _file_handler().create_download_request(
            principal=_principal(),
            request=AgentStubFileDownloadRequest(
                file=AgentStubFileMapping(transfer_method="tool_file", reference=reference),
                for_frontend=False,
            ),
        )
        assert response.download_url == "https://sandbox-files.example.com/dify/files/tools/tool-file-1.pdf?sign=1"

    asyncio.run(scenario())


@pytest.mark.parametrize(
    "download_uri",
    [
        "https://dify.example.com/files/tools/tool-file-1.pdf?sign=1",
        "/files/tools/tool-file-1.pdf?sign=1",
    ],
)
def test_frontend_download_request_preserves_public_or_relative_uri(
    monkeypatch: pytest.MonkeyPatch,
    download_uri: str,
) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert json.loads(request.content)["for_frontend"] is True
        return httpx.Response(
            200,
            json={"filename": "report.pdf", "mime_type": "application/pdf", "size": 123, "download_uri": download_uri},
        )

    _patch_async_client(monkeypatch, handler)

    async def scenario() -> None:
        response = await _file_handler().create_download_request(
            principal=_principal(),
            request=AgentStubFileDownloadRequest(
                file=AgentStubFileMapping(transfer_method="tool_file", reference=_reference("tool-file-1")),
                for_frontend=True,
            ),
        )
        assert response.download_url == download_uri

    asyncio.run(scenario())


def test_remote_download_url_is_never_rewritten(monkeypatch: pytest.MonkeyPatch) -> None:
    remote_url = "https://remote.example.com/report.pdf"

    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={"filename": "report.pdf", "mime_type": "application/pdf", "size": 123, "download_uri": remote_url},
        )

    _patch_async_client(monkeypatch, handler)

    async def scenario() -> None:
        response = await _file_handler().create_download_request(
            principal=_principal(),
            request=AgentStubFileDownloadRequest(
                file=AgentStubFileMapping(transfer_method="remote_url", url=remote_url),
                for_frontend=False,
            ),
        )
        assert response.download_url == remote_url

    asyncio.run(scenario())


def test_remote_download_rejects_relative_uri_for_frontend_audience(monkeypatch: pytest.MonkeyPatch) -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={"filename": "report.pdf", "mime_type": "application/pdf", "size": 123, "download_uri": "/files/x"},
        )

    _patch_async_client(monkeypatch, handler)

    async def scenario() -> None:
        with pytest.raises(AgentStubFileRequestError, match="invalid remote download URL"):
            await _file_handler().create_download_request(
                principal=_principal(),
                request=AgentStubFileDownloadRequest(
                    file=AgentStubFileMapping(
                        transfer_method="remote_url", url="https://remote.example.com/report.pdf"
                    ),
                    for_frontend=True,
                ),
            )

    asyncio.run(scenario())


@pytest.mark.parametrize(
    "unsafe_uri",
    [
        "//attacker.example/files/x",
        "/files/../admin",
        "/files/%252e%252e/admin",
        "http://api:5001/files/tools/x",
        "/not-files/x",
    ],
)
def test_sandbox_download_rejects_unsafe_dify_file_uri(
    monkeypatch: pytest.MonkeyPatch,
    unsafe_uri: str,
) -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={"filename": "x", "mime_type": None, "size": 1, "download_uri": unsafe_uri},
        )

    _patch_async_client(monkeypatch, handler)

    async def scenario() -> None:
        with pytest.raises(AgentStubFileRequestError, match="unsafe Dify file URI"):
            await _file_handler().create_download_request(
                principal=_principal(),
                request=AgentStubFileDownloadRequest(
                    file=AgentStubFileMapping(transfer_method="tool_file", reference=_reference("tool-file-1")),
                    for_frontend=False,
                ),
            )

    asyncio.run(scenario())


def test_handler_rejects_missing_execution_user_before_network() -> None:
    principal = _principal()
    principal.execution_context = principal.execution_context.model_copy(update={"user_id": None})

    async def scenario() -> None:
        with pytest.raises(AgentStubFileRequestError, match="user_id"):
            await _file_handler().create_upload_request(
                principal=principal,
                request=AgentStubFileUploadRequest(filename="report.pdf", mimetype="application/pdf"),
            )

    asyncio.run(scenario())


def test_handler_preserves_inner_api_error_status(monkeypatch: pytest.MonkeyPatch) -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(403, json={"detail": "forbidden"})

    _patch_async_client(monkeypatch, handler)

    async def scenario() -> None:
        with pytest.raises(AgentStubFileRequestError) as exc_info:
            await _file_handler().create_upload_request(
                principal=_principal(),
                request=AgentStubFileUploadRequest(filename="report.pdf", mimetype="application/pdf"),
            )
        assert exc_info.value.status_code == 403
        assert exc_info.value.detail == "forbidden"

    asyncio.run(scenario())


def test_handler_rejects_missing_download_uri(monkeypatch: pytest.MonkeyPatch) -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"filename": "report.pdf", "size": 1})

    _patch_async_client(monkeypatch, handler)

    async def scenario() -> None:
        with pytest.raises(AgentStubFileRequestError, match="missing download_uri"):
            await _file_handler().create_download_request(
                principal=_principal(),
                request=AgentStubFileDownloadRequest(
                    file=AgentStubFileMapping(transfer_method="tool_file", reference=_reference("tool-file-1")),
                    for_frontend=False,
                ),
            )

    asyncio.run(scenario())
