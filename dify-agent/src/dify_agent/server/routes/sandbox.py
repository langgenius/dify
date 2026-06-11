"""FastAPI routes for resumable sandbox file operations.

The public sandbox API is intentionally narrow: callers submit a typed
``SandboxLocator`` plus operation parameters, and the server translates service
errors into a consistent ``{code, message}`` body. Runtime sandbox behaviour
stays in ``SandboxService`` so the route layer remains HTTP-only.
"""

from collections.abc import Callable
from typing import Annotated

from fastapi import APIRouter, Body, Depends, FastAPI, Request
from fastapi.exception_handlers import request_validation_exception_handler
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import ValidationError

from dify_agent.protocol import (
    SandboxListFilesRequest,
    SandboxListResult,
    SandboxReadFileRequest,
    SandboxReadResult,
    SandboxUploadFileRequest,
    SandboxUploadResult,
)
from dify_agent.server.sandbox_service import SandboxService, SandboxServiceError

_SANDBOX_REQUEST_INVALID_CODE = "sandbox_request_invalid"


def install_sandbox_exception_handlers(app: FastAPI) -> None:
    """Install sandbox-specific validation error mapping on the FastAPI app."""

    @app.exception_handler(RequestValidationError)
    async def handle_request_validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
        if request.url.path.startswith("/sandbox"):
            return _sandbox_validation_error_response(_format_validation_error(exc))
        return await request_validation_exception_handler(request, exc)


def create_sandbox_router(get_service: Callable[[], SandboxService]) -> APIRouter:
    """Create the ``/sandbox`` router bound to an application service provider."""
    router = APIRouter(prefix="/sandbox", tags=["sandbox"])

    async def service_dep() -> SandboxService:
        return get_service()

    @router.post("/files/list", response_model=SandboxListResult)
    async def list_files(
        service: Annotated[SandboxService, Depends(service_dep)],
        payload: object = Body(...),
    ) -> SandboxListResult | JSONResponse:
        try:
            request = SandboxListFilesRequest.model_validate(payload)
            return await service.list_files(request)
        except ValidationError as exc:
            return _sandbox_validation_error_response(_format_validation_error(exc))
        except SandboxServiceError as exc:
            return JSONResponse(status_code=exc.status_code, content={"code": exc.code, "message": exc.message})

    @router.post("/files/read", response_model=SandboxReadResult)
    async def read_file(
        service: Annotated[SandboxService, Depends(service_dep)],
        payload: object = Body(...),
    ) -> SandboxReadResult | JSONResponse:
        try:
            request = SandboxReadFileRequest.model_validate(payload)
            return await service.read_file(request)
        except ValidationError as exc:
            return _sandbox_validation_error_response(_format_validation_error(exc))
        except SandboxServiceError as exc:
            return JSONResponse(status_code=exc.status_code, content={"code": exc.code, "message": exc.message})

    @router.post("/files/upload", response_model=SandboxUploadResult)
    async def upload_file(
        service: Annotated[SandboxService, Depends(service_dep)],
        payload: object = Body(...),
    ) -> SandboxUploadResult | JSONResponse:
        try:
            request = SandboxUploadFileRequest.model_validate(payload)
            return await service.upload_file(request)
        except ValidationError as exc:
            return _sandbox_validation_error_response(_format_validation_error(exc))
        except SandboxServiceError as exc:
            return JSONResponse(status_code=exc.status_code, content={"code": exc.code, "message": exc.message})

    return router


def _sandbox_validation_error_response(message: str) -> JSONResponse:
    return JSONResponse(status_code=422, content={"code": _SANDBOX_REQUEST_INVALID_CODE, "message": message})


def _format_validation_error(exc: ValidationError | RequestValidationError) -> str:
    errors = exc.errors()
    if not errors:
        return "Sandbox request validation failed."
    first_error = errors[0]
    location = ".".join(str(part) for part in first_error.get("loc", ()))
    message = first_error.get("msg", "Sandbox request validation failed.")
    if location:
        return f"{location}: {message}"
    return str(message)


__all__ = ["create_sandbox_router", "install_sandbox_exception_handlers"]
