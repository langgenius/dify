"""Private Execution Binding control-plane routes used by Dify API."""

from collections.abc import Callable
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status

from dify_agent.protocol import (
    CreateExecutionBindingRequest,
    CreateExecutionBindingResponse,
    DestroyExecutionBindingRequest,
)
from dify_agent.server.execution_bindings import ExecutionBindingService, ExecutionBindingServiceError


def create_execution_bindings_router(get_service: Callable[[], ExecutionBindingService | None]) -> APIRouter:
    router = APIRouter(prefix="/execution-bindings", tags=["execution-bindings"])

    def service_dep() -> ExecutionBindingService:
        service = get_service()
        if service is None:
            raise HTTPException(
                status_code=503,
                detail={"code": "runtime_backend_unavailable", "message": "runtime backend is not configured"},
            )
        return service

    def raise_http(exc: ExecutionBindingServiceError) -> HTTPException:
        return HTTPException(status_code=exc.status_code, detail={"code": exc.code, "message": exc.message})

    @router.post("", response_model=CreateExecutionBindingResponse, status_code=status.HTTP_201_CREATED)
    async def create_binding(
        request: CreateExecutionBindingRequest,
        service: Annotated[ExecutionBindingService, Depends(service_dep)],
    ) -> CreateExecutionBindingResponse:
        try:
            return await service.create_binding(request)
        except ExecutionBindingServiceError as exc:
            raise raise_http(exc) from exc

    @router.post("/destroy", status_code=status.HTTP_204_NO_CONTENT)
    async def destroy_binding(
        request: DestroyExecutionBindingRequest,
        service: Annotated[ExecutionBindingService, Depends(service_dep)],
    ) -> Response:
        try:
            await service.destroy_binding(request)
        except ExecutionBindingServiceError as exc:
            raise raise_http(exc) from exc
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    return router


__all__ = ["create_execution_bindings_router"]
