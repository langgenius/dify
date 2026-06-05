from __future__ import annotations

import asyncio
import base64
import json

import httpx

from dify_agent.layers.execution_context import DifyExecutionContextLayerConfig
from dify_agent.protocol.back_proxy import BackProxyFileDownloadRequest, BackProxyFileMapping, BackProxyFileUploadRequest
from dify_agent.server.back_proxy_files import BackProxyFileRequestError, DifyApiBackProxyFileRequestHandler
from dify_agent.server.tokens.back_proxy import BackProxyPrincipal


def _principal() -> BackProxyPrincipal:
    return BackProxyPrincipal(
        execution_context=DifyExecutionContextLayerConfig(
            tenant_id="tenant-1",
            user_id="user-1",
            user_from="account",
            workflow_id="workflow-1",
            agent_mode="workflow_run",
            invoke_from="service-api",
        ),
        session_id="session-1",
        scope=["shell_back_proxy:connect"],
        token_id="token-1",
    )


def _patch_async_client(monkeypatch, handler) -> None:
    original_async_client = httpx.AsyncClient
    monkeypatch.setattr(
        "dify_agent.server.back_proxy_files.httpx.AsyncClient",
        lambda **kwargs: original_async_client(transport=httpx.MockTransport(handler), **kwargs),
    )


def _reference(record_id: str) -> str:
    payload = base64.urlsafe_b64encode(json.dumps({"record_id": record_id}, separators=(",", ":")).encode()).decode()
    return f"dify-file-ref:{payload}"


def test_dify_api_back_proxy_file_handler_injects_execution_context_for_upload(
    monkeypatch,
) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert str(request.url) == "https://api.example.com/inner/api/upload/file/request"
        assert request.headers["X-Inner-Api-Key"] == "inner-secret"
        assert json.loads(request.content) == {
            "tenant_id": "tenant-1",
            "user_id": "user-1",
            "filename": "report.pdf",
            "mimetype": "application/pdf",
        }
        return httpx.Response(200, json={"data": {"url": "https://files.example.com/upload"}})

    _patch_async_client(monkeypatch, handler)
    file_handler = DifyApiBackProxyFileRequestHandler(
        dify_api_base_url="https://api.example.com",
        dify_api_inner_api_key="inner-secret",
    )

    async def scenario() -> None:
        response = await file_handler.create_upload_request(
            principal=_principal(),
            request=BackProxyFileUploadRequest(filename="report.pdf", mimetype="application/pdf"),
        )

        assert response.upload_url == "https://files.example.com/upload"

    asyncio.run(scenario())


def test_dify_api_back_proxy_file_handler_injects_execution_context_for_download(
    monkeypatch,
) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert str(request.url) == "https://api.example.com/inner/api/download/file/request"
        assert json.loads(request.content) == {
            "tenant_id": "tenant-1",
            "user_id": "user-1",
            "user_from": "account",
            "invoke_from": "service-api",
            "file": {"transfer_method": "tool_file", "reference": _reference("tool-file-1")},
        }
        return httpx.Response(
            200,
            json={
                "data": {
                    "filename": "report.pdf",
                    "mime_type": "application/pdf",
                    "size": 123,
                    "download_url": "https://files.example.com/download",
                }
            },
        )

    _patch_async_client(monkeypatch, handler)
    file_handler = DifyApiBackProxyFileRequestHandler(
        dify_api_base_url="https://api.example.com",
        dify_api_inner_api_key="inner-secret",
    )

    async def scenario() -> None:
        response = await file_handler.create_download_request(
            principal=_principal(),
            request=BackProxyFileDownloadRequest(
                file=BackProxyFileMapping(transfer_method="tool_file", reference=_reference("tool-file-1"))
            ),
        )

        assert response.download_url == "https://files.example.com/download"

    asyncio.run(scenario())


def test_dify_api_back_proxy_file_handler_rejects_missing_user_id() -> None:
    file_handler = DifyApiBackProxyFileRequestHandler(
        dify_api_base_url="https://api.example.com",
        dify_api_inner_api_key="inner-secret",
    )
    principal = _principal()
    principal.execution_context = principal.execution_context.model_copy(update={"user_id": None})

    async def scenario() -> None:
        try:
            await file_handler.create_upload_request(
                principal=principal,
                request=BackProxyFileUploadRequest(filename="report.pdf", mimetype="application/pdf"),
            )
        except BackProxyFileRequestError as exc:
            assert "user_id" in str(exc)
        else:
            raise AssertionError("expected BackProxyFileRequestError")

    asyncio.run(scenario())


def test_dify_api_back_proxy_file_handler_maps_non_2xx_response(monkeypatch) -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(403, json={"detail": "forbidden"})

    _patch_async_client(monkeypatch, handler)
    file_handler = DifyApiBackProxyFileRequestHandler(
        dify_api_base_url="https://api.example.com",
        dify_api_inner_api_key="inner-secret",
    )

    async def scenario() -> None:
        try:
            await file_handler.create_upload_request(
                principal=_principal(),
                request=BackProxyFileUploadRequest(filename="report.pdf", mimetype="application/pdf"),
            )
        except BackProxyFileRequestError as exc:
            assert exc.status_code == 403
            assert exc.detail == "forbidden"
        else:
            raise AssertionError("expected BackProxyFileRequestError")

    asyncio.run(scenario())


def test_dify_api_back_proxy_file_handler_maps_error_envelope(monkeypatch) -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"error": "bad request"})

    _patch_async_client(monkeypatch, handler)
    file_handler = DifyApiBackProxyFileRequestHandler(
        dify_api_base_url="https://api.example.com",
        dify_api_inner_api_key="inner-secret",
    )

    async def scenario() -> None:
        try:
            await file_handler.create_download_request(
                principal=_principal(),
                request=BackProxyFileDownloadRequest(
                    file=BackProxyFileMapping(transfer_method="tool_file", reference=_reference("tool-file-1"))
                ),
            )
        except BackProxyFileRequestError as exc:
            assert exc.status_code == 400
            assert exc.detail == "bad request"
        else:
            raise AssertionError("expected BackProxyFileRequestError")

    asyncio.run(scenario())


def test_dify_api_back_proxy_file_handler_rejects_upload_response_missing_url(monkeypatch) -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"data": {}})

    _patch_async_client(monkeypatch, handler)
    file_handler = DifyApiBackProxyFileRequestHandler(
        dify_api_base_url="https://api.example.com",
        dify_api_inner_api_key="inner-secret",
    )

    async def scenario() -> None:
        try:
            await file_handler.create_upload_request(
                principal=_principal(),
                request=BackProxyFileUploadRequest(filename="report.pdf", mimetype="application/pdf"),
            )
        except BackProxyFileRequestError as exc:
            assert exc.status_code == 502
            assert exc.detail == "Dify API upload request response is missing url"
        else:
            raise AssertionError("expected BackProxyFileRequestError")

    asyncio.run(scenario())


def test_dify_api_back_proxy_file_handler_rejects_invalid_download_response_schema(monkeypatch) -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"data": {"filename": "report.pdf"}})

    _patch_async_client(monkeypatch, handler)
    file_handler = DifyApiBackProxyFileRequestHandler(
        dify_api_base_url="https://api.example.com",
        dify_api_inner_api_key="inner-secret",
    )

    async def scenario() -> None:
        try:
            await file_handler.create_download_request(
                principal=_principal(),
                request=BackProxyFileDownloadRequest(
                    file=BackProxyFileMapping(transfer_method="tool_file", reference=_reference("tool-file-1"))
                ),
            )
        except BackProxyFileRequestError as exc:
            assert exc.status_code == 502
            assert exc.detail == "Dify API download request response is invalid"
        else:
            raise AssertionError("expected BackProxyFileRequestError")

    asyncio.run(scenario())
