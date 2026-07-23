"""Private Workspace file routes used by Dify API."""

from collections.abc import Callable
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException

from dify_agent.protocol import (
    WorkspaceListRequest,
    WorkspaceListResponse,
    WorkspaceReadRequest,
    WorkspaceReadResponse,
    WorkspaceUploadRequest,
    WorkspaceUploadResponse,
)
from dify_agent.server.workspace_files import WorkspaceFileError, WorkspaceFileService


def create_workspace_files_router(get_service: Callable[[], WorkspaceFileService | None]) -> APIRouter:
    router = APIRouter(prefix="/workspace", tags=["workspace"])

    def service_dep() -> WorkspaceFileService:
        service = get_service()
        if service is None:
            raise HTTPException(
                status_code=503,
                detail={"code": "runtime_backend_unavailable", "message": "Workspace service is not configured"},
            )
        return service

    def raise_http(exc: WorkspaceFileError) -> HTTPException:
        return HTTPException(status_code=exc.status_code, detail={"code": exc.code, "message": exc.message})

    @router.post("/files/list", response_model=WorkspaceListResponse)
    async def list_files(
        request: WorkspaceListRequest,
        service: Annotated[WorkspaceFileService, Depends(service_dep)],
    ) -> WorkspaceListResponse:
        try:
            return await service.list_files(request)
        except WorkspaceFileError as exc:
            raise raise_http(exc) from exc

    @router.post("/files/read", response_model=WorkspaceReadResponse)
    async def read_file(
        request: WorkspaceReadRequest,
        service: Annotated[WorkspaceFileService, Depends(service_dep)],
    ) -> WorkspaceReadResponse:
        try:
            return await service.read_file(request)
        except WorkspaceFileError as exc:
            raise raise_http(exc) from exc

    @router.post("/files/upload", response_model=WorkspaceUploadResponse)
    async def upload_file(
        request: WorkspaceUploadRequest,
        service: Annotated[WorkspaceFileService, Depends(service_dep)],
    ) -> WorkspaceUploadResponse:
        try:
            return await service.upload_file(request)
        except WorkspaceFileError as exc:
            raise raise_http(exc) from exc

    return router


__all__ = ["create_workspace_files_router"]
