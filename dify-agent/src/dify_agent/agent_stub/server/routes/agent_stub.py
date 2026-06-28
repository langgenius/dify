"""FastAPI routes for authenticated Agent Stub control-plane calls.

The router is a thin HTTP adapter around ``AgentStubControlPlaneService``. It
keeps FastAPI-specific request parsing and HTTPException translation here while
sharing auth, DTO validation, connection-id generation, and file/config/drive
delegation with the gRPC transport.
"""

from __future__ import annotations

from fastapi import APIRouter, Header, HTTPException, Response

from dify_agent.agent_stub.protocol.agent_stub import (
    AgentStubConnectRequest,
    AgentStubConnectResponse,
    AgentStubConfigEnvUpdateRequest,
    AgentStubConfigManifestResponse,
    AgentStubConfigNoteUpdateRequest,
    AgentStubConfigPushRequest,
    AgentStubConfigPushResponse,
    AgentStubDriveCommitRequest,
    AgentStubDriveCommitResponse,
    AgentStubDriveManifestResponse,
    AgentStubFileDownloadRequest,
    AgentStubFileDownloadResponse,
    AgentStubFileUploadRequest,
    AgentStubFileUploadResponse,
)
from dify_agent.agent_stub.server.agent_stub_config import AgentStubConfigRequestHandler
from dify_agent.agent_stub.server.agent_stub_drive import AgentStubDriveRequestHandler
from dify_agent.agent_stub.server.agent_stub_files import AgentStubFileRequestHandler
from dify_agent.agent_stub.server.control_plane import AgentStubControlPlaneError, AgentStubControlPlaneService
from dify_agent.agent_stub.server.tokens.agent_stub import AgentStubTokenCodec


def create_agent_stub_http_router(
    token_codec: AgentStubTokenCodec | None,
    file_request_handler: AgentStubFileRequestHandler | None = None,
    drive_request_handler: AgentStubDriveRequestHandler | None = None,
    config_request_handler: AgentStubConfigRequestHandler | None = None,
) -> APIRouter:
    """Create HTTP routes bound to the application's Agent Stub dependencies."""
    router = APIRouter(prefix="/agent-stub", tags=["agent-stub"])
    service = AgentStubControlPlaneService(token_codec, file_request_handler, config_request_handler, drive_request_handler)

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

    @router.get("/config/manifest", response_model=AgentStubConfigManifestResponse)
    async def get_config_manifest(
        authorization: str | None = Header(default=None, alias="Authorization"),
    ) -> AgentStubConfigManifestResponse:
        try:
            return await service.get_config_manifest(authorization=authorization)
        except AgentStubControlPlaneError as exc:
            raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    @router.get("/config/skills/{name}/pull")
    async def pull_config_skill(
        name: str,
        authorization: str | None = Header(default=None, alias="Authorization"),
    ) -> Response:
        try:
            payload = await service.pull_config_skill(name=name, authorization=authorization)
            return Response(content=payload, media_type="application/zip")
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

    @router.get("/config/files/{name}/pull")
    async def pull_config_file(
        name: str,
        authorization: str | None = Header(default=None, alias="Authorization"),
    ) -> Response:
        try:
            payload = await service.pull_config_file(name=name, authorization=authorization)
            return Response(content=payload, media_type="application/octet-stream")
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

    @router.get("/drive/manifest", response_model=AgentStubDriveManifestResponse)
    async def get_drive_manifest(
        prefix: str = "",
        include_download_url: bool = False,
        authorization: str | None = Header(default=None, alias="Authorization"),
    ) -> AgentStubDriveManifestResponse:
        try:
            return await service.get_drive_manifest(
                prefix=prefix,
                include_download_url=include_download_url,
                authorization=authorization,
            )
        except AgentStubControlPlaneError as exc:
            raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    @router.post("/drive/commit", response_model=AgentStubDriveCommitResponse)
    async def commit_drive(
        request: AgentStubDriveCommitRequest,
        authorization: str | None = Header(default=None, alias="Authorization"),
    ) -> AgentStubDriveCommitResponse:
        try:
            return await service.commit_drive(request=request, authorization=authorization)
        except AgentStubControlPlaneError as exc:
            raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    return router


__all__ = ["create_agent_stub_http_router"]
