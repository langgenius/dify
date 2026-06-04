"""FastAPI routes for read-only inspection of shell-layer workspaces.

These endpoints back the Dify "sandbox file system" inspector. They are
read-only and scoped to a single ``~/workspace/<session_id>`` directory; the
heavy lifting (path containment, PTY-safe transport) lives in
``WorkspaceFileService``. Like the runs router, they rely on network isolation
rather than per-request auth.
"""

from collections.abc import Callable
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query

from dify_agent.server.workspace_files import (
    WorkspaceDownloadResponse,
    WorkspaceFileError,
    WorkspaceFileService,
    WorkspaceListResponse,
    WorkspacePreviewResponse,
)


def create_workspace_files_router(
    get_service: Callable[[], WorkspaceFileService | None],
) -> APIRouter:
    """Create read-only workspace file routes bound to the app's service provider."""
    router = APIRouter(prefix="/workspaces", tags=["workspaces"])

    def service_dep() -> WorkspaceFileService:
        service = get_service()
        if service is None:
            raise HTTPException(
                status_code=503,
                detail="workspace inspector is not configured (no shellctl entrypoint)",
            )
        return service

    def _raise_http(exc: WorkspaceFileError) -> HTTPException:
        return HTTPException(status_code=exc.status_code, detail={"code": exc.code, "message": exc.message})

    @router.get("/{session_id}/files", response_model=WorkspaceListResponse)
    async def list_files(
        session_id: str,
        service: Annotated[WorkspaceFileService, Depends(service_dep)],
        path: str = Query(default="."),
    ) -> WorkspaceListResponse:
        try:
            return await service.list_dir(session_id, path)
        except WorkspaceFileError as exc:
            raise _raise_http(exc) from exc

    @router.get("/{session_id}/files/preview", response_model=WorkspacePreviewResponse)
    async def preview_file(
        session_id: str,
        service: Annotated[WorkspaceFileService, Depends(service_dep)],
        path: str = Query(...),
    ) -> WorkspacePreviewResponse:
        try:
            return await service.preview(session_id, path)
        except WorkspaceFileError as exc:
            raise _raise_http(exc) from exc

    @router.get("/{session_id}/files/download", response_model=WorkspaceDownloadResponse)
    async def download_file(
        session_id: str,
        service: Annotated[WorkspaceFileService, Depends(service_dep)],
        path: str = Query(...),
    ) -> WorkspaceDownloadResponse:
        try:
            return await service.download(session_id, path)
        except WorkspaceFileError as exc:
            raise _raise_http(exc) from exc

    return router


__all__ = ["create_workspace_files_router"]
