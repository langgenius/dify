"""FastAPI routes for sandbox file operations.

The agent backend receives a structured ``SandboxLocator`` rather than a raw
shell session id. Routes stay private-network only like ``/runs`` and forward
all sandbox work to ``SandboxFileService``.
"""

from collections.abc import Callable
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException

from dify_agent.protocol import (
    SandboxListRequest,
    SandboxListResponse,
    SandboxReadRequest,
    SandboxReadResponse,
    SandboxUploadRequest,
    SandboxUploadResponse,
)
from dify_agent.server.sandbox_files import SandboxFileError, SandboxFileService


def create_sandbox_files_router(get_service: Callable[[], SandboxFileService | None]) -> APIRouter:
    """Create sandbox file routes bound to the app's service provider."""
    router = APIRouter(prefix="/sandbox", tags=["sandbox"])

    def service_dep() -> SandboxFileService:
        service = get_service()
        if service is None:
            raise HTTPException(
                status_code=503,
                detail={"code": "sandbox_backend_unavailable", "message": "sandbox service is not configured"},
            )
        return service

    def raise_http(exc: SandboxFileError) -> HTTPException:
        return HTTPException(status_code=exc.status_code, detail={"code": exc.code, "message": exc.message})

    @router.post("/files/list", response_model=SandboxListResponse)
    async def list_files(
        request: SandboxListRequest,
        service: Annotated[SandboxFileService, Depends(service_dep)],
    ) -> SandboxListResponse:
        try:
            return await service.list_files(request)
        except SandboxFileError as exc:
            raise raise_http(exc) from exc

    @router.post("/files/read", response_model=SandboxReadResponse)
    async def read_file(
        request: SandboxReadRequest,
        service: Annotated[SandboxFileService, Depends(service_dep)],
    ) -> SandboxReadResponse:
        try:
            return await service.read_file(request)
        except SandboxFileError as exc:
            raise raise_http(exc) from exc

    @router.post("/files/upload", response_model=SandboxUploadResponse)
    async def upload_file(
        request: SandboxUploadRequest,
        service: Annotated[SandboxFileService, Depends(service_dep)],
    ) -> SandboxUploadResponse:
        try:
            return await service.upload_file(request)
        except SandboxFileError as exc:
            raise raise_http(exc) from exc

    return router


__all__ = ["create_sandbox_files_router"]
