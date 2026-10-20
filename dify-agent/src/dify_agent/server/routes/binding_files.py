"""Private Binding file routes used by Dify API."""

from collections.abc import Callable, Coroutine
from typing import Annotated, Any, override

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.routing import APIRoute
from starlette.responses import Response

from dify_agent.protocol import (
    BindingFileDownloadRequest,
    BindingFileDownloadResponse,
    BindingFileListRequest,
    BindingFileListResponse,
    BindingFileReadRequest,
    BindingFileReadResponse,
)
from dify_agent.server.binding_files import BindingFileError, BindingFileService

_INVALID_BINDING_PATH_MESSAGE = "Binding file path or payload is invalid"
_BROWSE_PATHS = frozenset(
    {
        "/execution-bindings/files/list",
        "/execution-bindings/files/read",
    }
)


class _BindingFileValidationRoute(APIRoute):
    @override
    def get_route_handler(self) -> Callable[[Request], Coroutine[Any, Any, Response]]:
        route_handler = super().get_route_handler()

        async def handle(request: Request) -> Response:
            try:
                return await route_handler(request)
            except RequestValidationError:
                if self.path not in _BROWSE_PATHS:
                    raise
                return JSONResponse(
                    status_code=400,
                    content={
                        "detail": {
                            "code": "invalid_binding_path",
                            "message": _INVALID_BINDING_PATH_MESSAGE,
                        }
                    },
                )

        return handle


def create_binding_files_router(get_service: Callable[[], BindingFileService | None]) -> APIRouter:
    router = APIRouter(
        prefix="/execution-bindings/files",
        tags=["execution-bindings"],
        route_class=_BindingFileValidationRoute,
    )

    def service_dep() -> BindingFileService:
        service = get_service()
        if service is None:
            raise HTTPException(
                status_code=503,
                detail={"code": "runtime_backend_unavailable", "message": "Binding file service is not configured"},
            )
        return service

    def raise_http(exc: BindingFileError) -> HTTPException:
        return HTTPException(status_code=exc.status_code, detail={"code": exc.code, "message": exc.message})

    @router.post("/list", response_model=BindingFileListResponse)
    async def list_files(
        request: BindingFileListRequest,
        service: Annotated[BindingFileService, Depends(service_dep)],
    ) -> BindingFileListResponse:
        try:
            return await service.list_files(request)
        except BindingFileError as exc:
            raise raise_http(exc) from exc

    @router.post("/read", response_model=BindingFileReadResponse)
    async def read_file(
        request: BindingFileReadRequest,
        service: Annotated[BindingFileService, Depends(service_dep)],
    ) -> BindingFileReadResponse:
        try:
            return await service.read_file(request)
        except BindingFileError as exc:
            raise raise_http(exc) from exc

    @router.post("/download", response_model=BindingFileDownloadResponse)
    async def download_file(
        request: BindingFileDownloadRequest,
        service: Annotated[BindingFileService, Depends(service_dep)],
    ) -> BindingFileDownloadResponse:
        try:
            return await service.download_file(request)
        except BindingFileError as exc:
            raise raise_http(exc) from exc

    return router


__all__ = ["create_binding_files_router"]
