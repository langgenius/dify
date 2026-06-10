"""FastAPI routes for authenticated Agent Stub control-plane calls.

The router is a thin HTTP adapter around ``AgentStubControlPlaneService``. It
keeps FastAPI-specific request parsing and HTTPException translation here while
sharing auth, DTO validation, connection-id generation, and file delegation with
the gRPC transport.
"""

from __future__ import annotations

from fastapi import APIRouter, Header, HTTPException

from dify_agent.agent_stub.protocol.agent_stub import (
    AgentStubConnectRequest,
    AgentStubConnectResponse,
    AgentStubFileDownloadRequest,
    AgentStubFileDownloadResponse,
    AgentStubFileUploadRequest,
    AgentStubFileUploadResponse,
)
from dify_agent.agent_stub.server.agent_stub_files import AgentStubFileRequestHandler
from dify_agent.agent_stub.server.control_plane import AgentStubControlPlaneError, AgentStubControlPlaneService
from dify_agent.agent_stub.server.tokens.agent_stub import AgentStubTokenCodec


def create_agent_stub_http_router(
    token_codec: AgentStubTokenCodec | None,
    file_request_handler: AgentStubFileRequestHandler | None = None,
) -> APIRouter:
    """Create HTTP routes bound to the application's Agent Stub dependencies."""
    router = APIRouter(prefix="/agent-stub", tags=["agent-stub"])
    service = AgentStubControlPlaneService(token_codec, file_request_handler)

    @router.post("/connections", response_model=AgentStubConnectResponse)
    async def create_connection(
        request: AgentStubConnectRequest,
        authorization: str | None = Header(default=None, alias="Authorization"),
    ) -> AgentStubConnectResponse:
        del request
        try:
            return await service.connect(authorization=authorization)
        except AgentStubControlPlaneError as exc:
            raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    @router.post("/files/upload-request", response_model=AgentStubFileUploadResponse)
    async def create_file_upload_request(
        request: AgentStubFileUploadRequest,
        authorization: str | None = Header(default=None, alias="Authorization"),
    ) -> AgentStubFileUploadResponse:
        try:
            return await service.create_file_upload_request(request=request, authorization=authorization)
        except AgentStubControlPlaneError as exc:
            raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    @router.post("/files/download-request", response_model=AgentStubFileDownloadResponse)
    async def create_file_download_request(
        request: AgentStubFileDownloadRequest,
        authorization: str | None = Header(default=None, alias="Authorization"),
    ) -> AgentStubFileDownloadResponse:
        try:
            return await service.create_file_download_request(request=request, authorization=authorization)
        except AgentStubControlPlaneError as exc:
            raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    return router


__all__ = ["create_agent_stub_http_router"]
