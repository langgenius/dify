"""FastAPI routes for authenticated shell back proxy control-plane calls.

The router validates compact-JWE bearer tokens, reconstructs the Dify execution
context principal for each request, and then serves either shell connection
setup or file upload/download request endpoints. File routes remain control
plane only: the server returns signed URLs plus metadata and never proxies file
bytes.
"""

from __future__ import annotations

from collections.abc import Callable
from uuid import uuid4

from fastapi import APIRouter, Header, HTTPException

from dify_agent.agent_stub.protocol.back_proxy import (
    BackProxyConnectRequest,
    BackProxyConnectResponse,
    BackProxyFileDownloadRequest,
    BackProxyFileDownloadResponse,
    BackProxyFileUploadRequest,
    BackProxyFileUploadResponse,
)
from dify_agent.agent_stub.server.back_proxy_files import BackProxyFileRequestError, BackProxyFileRequestHandler
from dify_agent.agent_stub.server.tokens.back_proxy import BackProxyTokenCodec, BackProxyTokenError


def create_back_proxy_router(
    get_token_codec: Callable[[], BackProxyTokenCodec | None],
    get_file_request_handler: Callable[[], BackProxyFileRequestHandler | None] | None = None,
) -> APIRouter:
    """Create routes bound to the application's shell back proxy token codec."""
    router = APIRouter(prefix="/back-proxy", tags=["back-proxy"])

    @router.post("/connections", response_model=BackProxyConnectResponse)
    async def create_connection(
        request: BackProxyConnectRequest,
        authorization: str | None = Header(default=None, alias="Authorization"),
    ) -> BackProxyConnectResponse:
        principal = _authenticate_request(get_token_codec, authorization)
        del request, principal
        return BackProxyConnectResponse(connection_id=str(uuid4()), status="connected")

    @router.post("/files/upload-request", response_model=BackProxyFileUploadResponse)
    async def create_file_upload_request(
        request: BackProxyFileUploadRequest,
        authorization: str | None = Header(default=None, alias="Authorization"),
    ) -> BackProxyFileUploadResponse:
        principal = _authenticate_request(get_token_codec, authorization)
        handler = _require_file_request_handler(get_file_request_handler)
        try:
            return await handler.create_upload_request(principal=principal, request=request)
        except BackProxyFileRequestError as exc:
            raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    @router.post("/files/download-request", response_model=BackProxyFileDownloadResponse)
    async def create_file_download_request(
        request: BackProxyFileDownloadRequest,
        authorization: str | None = Header(default=None, alias="Authorization"),
    ) -> BackProxyFileDownloadResponse:
        principal = _authenticate_request(get_token_codec, authorization)
        handler = _require_file_request_handler(get_file_request_handler)
        try:
            return await handler.create_download_request(principal=principal, request=request)
        except BackProxyFileRequestError as exc:
            raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    return router


def _authenticate_request(
    get_token_codec: Callable[[], BackProxyTokenCodec | None],
    authorization: str | None,
):
    token_codec = get_token_codec()
    if token_codec is None:
        raise HTTPException(status_code=503, detail="shell back proxy is not configured")
    try:
        return token_codec.decode_authorization_header(authorization)
    except BackProxyTokenError as exc:
        raise HTTPException(status_code=401, detail="invalid or missing back proxy authorization") from exc


def _require_file_request_handler(
    get_file_request_handler: Callable[[], BackProxyFileRequestHandler | None] | None,
) -> BackProxyFileRequestHandler:
    if get_file_request_handler is None:
        raise HTTPException(status_code=503, detail="shell back proxy file API is not configured")
    handler = get_file_request_handler()
    if handler is None:
        raise HTTPException(status_code=503, detail="shell back proxy file API is not configured")
    return handler


__all__ = ["create_back_proxy_router"]
