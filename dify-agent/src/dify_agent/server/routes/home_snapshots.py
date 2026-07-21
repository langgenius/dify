"""Private Home Snapshot control-plane routes used by Dify API."""

from collections.abc import Callable
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status

from dify_agent.protocol.home_snapshot import (
    CreateHomeSnapshotFromSandboxRequest,
    HomeSnapshotResponse,
    InitializeHomeSnapshotRequest,
)
from dify_agent.server.home_snapshots import HomeSnapshotService, HomeSnapshotServiceError


def create_home_snapshots_router(get_service: Callable[[], HomeSnapshotService | None]) -> APIRouter:
    router = APIRouter(prefix="/home-snapshots", tags=["home-snapshots"])

    def service_dep() -> HomeSnapshotService:
        service = get_service()
        if service is None:
            raise HTTPException(
                status_code=503,
                detail={"code": "runtime_backend_unavailable", "message": "runtime backend is not configured"},
            )
        return service

    @router.post("/initialize", response_model=HomeSnapshotResponse, status_code=status.HTTP_201_CREATED)
    async def initialize_snapshot(
        request: InitializeHomeSnapshotRequest,
        service: Annotated[HomeSnapshotService, Depends(service_dep)],
    ) -> HomeSnapshotResponse:
        try:
            return await service.initialize(request)
        except HomeSnapshotServiceError as exc:
            raise HTTPException(
                status_code=exc.status_code,
                detail={"code": exc.code, "message": exc.message},
            ) from exc

    @router.post("/from-sandbox", response_model=HomeSnapshotResponse, status_code=status.HTTP_201_CREATED)
    async def create_snapshot_from_sandbox(
        request: CreateHomeSnapshotFromSandboxRequest,
        service: Annotated[HomeSnapshotService, Depends(service_dep)],
    ) -> HomeSnapshotResponse:
        try:
            return await service.create_from_sandbox(request)
        except HomeSnapshotServiceError as exc:
            raise HTTPException(
                status_code=exc.status_code,
                detail={"code": exc.code, "message": exc.message},
            ) from exc

    @router.delete("/{snapshot_ref:path}", status_code=status.HTTP_204_NO_CONTENT)
    async def delete_snapshot(
        snapshot_ref: str,
        service: Annotated[HomeSnapshotService, Depends(service_dep)],
    ) -> Response:
        try:
            await service.delete(snapshot_ref)
        except HomeSnapshotServiceError as exc:
            raise HTTPException(
                status_code=exc.status_code,
                detail={"code": exc.code, "message": exc.message},
            ) from exc
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    return router


__all__ = ["create_home_snapshots_router"]
