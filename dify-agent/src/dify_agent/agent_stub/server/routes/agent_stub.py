"""FastAPI routes for authenticated Agent Stub control-plane calls.

The router is a thin HTTP adapter around ``AgentStubControlPlaneService``. It
keeps FastAPI-specific request parsing and HTTPException translation here while
the service owns auth and file/config delegation.
"""

from __future__ import annotations

import asyncio

from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import ValidationError

from dify_agent.agent_stub.protocol.agent_stub import (
    AgentStubConnectRequest,
    AgentStubConnectResponse,
    AgentStubConfigEnvUpdateRequest,
    AgentStubConfigManifestResponse,
    AgentStubConfigNoteUpdateRequest,
    AgentStubConfigPushRequest,
    AgentStubConfigPushResponse,
    AgentStubFileDownloadRequest,
    AgentStubFileDownloadResponse,
    AgentStubFileUploadRequest,
    AgentStubFileUploadResponse,
)
from dify_agent.agent_stub.server.agent_stub_config import AgentStubConfigRequestHandler
from dify_agent.agent_stub.server.agent_stub_files import AgentStubFileRequestHandler
from dify_agent.agent_stub.server.control_plane import AgentStubControlPlaneError, AgentStubControlPlaneService
from dify_agent.agent_stub.server.tokens.agent_stub import AgentStubTokenCodec
from dify_agent.agent_stub.server.knowledge import AgentStubKnowledgeHandler
from dify_agent.protocol.knowledge_fs import KnowledgeFsCommand, KnowledgeFsCommandResult, KnowledgeFsError


def create_agent_stub_http_router(
    token_codec: AgentStubTokenCodec | None,
    file_request_handler: AgentStubFileRequestHandler | None = None,
    config_request_handler: AgentStubConfigRequestHandler | None = None,
    knowledge_request_handler: AgentStubKnowledgeHandler | None = None,
) -> APIRouter:
    """Create HTTP routes bound to the application's Agent Stub dependencies."""
    router = APIRouter(prefix="/agent-stub", tags=["agent-stub"])
    service = AgentStubControlPlaneService(
        token_codec=token_codec,
        file_request_handler=file_request_handler,
        config_request_handler=config_request_handler,
    )

    @router.post(
        "/knowledge/commands",
        response_model=KnowledgeFsCommandResult,
        openapi_extra={
            "requestBody": {
                "required": True,
                "content": {"application/json": {"schema": KnowledgeFsCommand.model_json_schema()}},
            }
        },
    )
    async def knowledge_command(
        request: Request,
        authorization: str | None = Header(default=None, alias="Authorization"),
    ) -> KnowledgeFsCommandResult:
        try:
            principal = service.authenticate(authorization=authorization)
            # Authenticate before accepting the body. The shell can bypass the
            # Go CLI, so enforce the input byte/time bounds at the HTTP boundary.
            body = bytearray()
            async with asyncio.timeout(15):
                async for chunk in request.stream():
                    if len(body) + len(chunk) > 24 * 1024:
                        raise KnowledgeFsError("KNOWLEDGE_INPUT_TOO_LARGE", "Knowledge input exceeds 24 KiB.", 413)
                    body.extend(chunk)
            command = KnowledgeFsCommand.model_validate_json(body)
            if knowledge_request_handler is None:
                raise KnowledgeFsError(
                    "KNOWLEDGE_UNAVAILABLE", "Deploy a knowledge-enabled Agent Stub with shared run storage.", 503
                )
            return await knowledge_request_handler.execute(principal, command, request.is_disconnected)
        except AgentStubControlPlaneError as exc:
            raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
        except KnowledgeFsError as exc:
            raise HTTPException(status_code=exc.status_code, detail={"code": exc.code, "message": exc.message}) from exc
        except (ValidationError, ValueError, RecursionError) as exc:
            raise HTTPException(
                status_code=422,
                detail={"code": "KNOWLEDGE_INVALID_COMMAND", "message": "Invalid read-only knowledge command."},
            ) from exc
        except TimeoutError as exc:
            raise HTTPException(
                status_code=408, detail={"code": "KNOWLEDGE_INPUT_TIMEOUT", "message": "Knowledge input timed out."}
            ) from exc

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
        expose_expiration: bool = False,
    ) -> AgentStubFileUploadResponse:
        try:
            return await service.create_file_upload_request(
                request=request,
                authorization=authorization,
                expose_expiration=expose_expiration,
            )
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

    @router.get("/config/manifest", response_model=AgentStubConfigManifestResponse)
    async def get_config_manifest(
        authorization: str | None = Header(default=None, alias="Authorization"),
    ) -> AgentStubConfigManifestResponse:
        try:
            return await service.get_config_manifest(authorization=authorization)
        except AgentStubControlPlaneError as exc:
            raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    @router.get("/config/skills/{name}/inspect")
    async def inspect_config_skill(
        name: str,
        authorization: str | None = Header(default=None, alias="Authorization"),
    ) -> dict[str, object]:
        try:
            return await service.inspect_config_skill(name=name, authorization=authorization)
        except AgentStubControlPlaneError as exc:
            raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    @router.post("/config/push", response_model=AgentStubConfigPushResponse)
    async def push_config(
        request: AgentStubConfigPushRequest,
        authorization: str | None = Header(default=None, alias="Authorization"),
    ) -> AgentStubConfigPushResponse:
        try:
            return await service.push_config(request=request, authorization=authorization)
        except AgentStubControlPlaneError as exc:
            raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    @router.patch("/config/env")
    async def update_config_env(
        request: AgentStubConfigEnvUpdateRequest,
        authorization: str | None = Header(default=None, alias="Authorization"),
    ) -> dict[str, object]:
        try:
            return await service.update_config_env(env_text=request.env_text, authorization=authorization)
        except AgentStubControlPlaneError as exc:
            raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    @router.put("/config/note")
    async def update_config_note(
        request: AgentStubConfigNoteUpdateRequest,
        authorization: str | None = Header(default=None, alias="Authorization"),
    ) -> dict[str, object]:
        try:
            return await service.update_config_note(note=request.note, authorization=authorization)
        except AgentStubControlPlaneError as exc:
            raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    return router


__all__ = ["create_agent_stub_http_router"]
