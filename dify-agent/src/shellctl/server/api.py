"""FastAPI wiring for shellctl server endpoints."""

from __future__ import annotations

from contextlib import asynccontextmanager
from typing import Annotated, cast

from fastapi import Depends, FastAPI, Header, Query, Request
from fastapi.responses import JSONResponse

from shellctl.server.config import ShellctlConfig
from shellctl.server.errors import ShellctlServerError
from shellctl.server.service import ShellctlService
from shellctl.shared.constants import (
    DEFAULT_HEALTH_STATUS,
    DEFAULT_LIST_LIMIT,
    DEFAULT_OUTPUT_LIMIT_BYTES,
    DEFAULT_TERMINATE_GRACE_SECONDS,
    MAX_LIST_LIMIT,
    MAX_OUTPUT_LIMIT_BYTES,
)
from shellctl.shared.schemas import (
    DeleteJobResponse,
    ErrorDetail,
    ErrorResponse,
    HealthResponse,
    InputJobRequest,
    JobResult,
    JobStatusName,
    JobStatusView,
    ListJobsResponse,
    RunJobRequest,
    TerminateJobRequest,
    WaitJobRequest,
)


def create_app(
    config: ShellctlConfig | None = None,
    *,
    service: ShellctlService | None = None,
) -> FastAPI:
    """Create the FastAPI application used by `shellctl serve`."""

    resolved_config = config or ShellctlConfig()
    resolved_service = service or ShellctlService(resolved_config)

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        await resolved_service.initialize()
        resolved_service.start_background_gc()
        resolved_service.start_background_pipe_monitor()
        try:
            yield
        finally:
            await resolved_service.shutdown()

    app = FastAPI(title="shellctl", version="0.1.0", lifespan=lifespan)
    app.state.shellctl_service = resolved_service

    @app.exception_handler(ShellctlServerError)
    async def handle_shellctl_error(
        _request: Request,
        exc: ShellctlServerError,
    ) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content=ErrorResponse(error=ErrorDetail(code=exc.code, message=exc.message)).model_dump(mode="json"),
        )

    @app.exception_handler(RuntimeError)
    async def handle_runtime_error(_request: Request, exc: RuntimeError) -> JSONResponse:
        return JSONResponse(
            status_code=500,
            content=ErrorResponse(
                error=ErrorDetail(
                    code="internal_error",
                    message=str(exc) or "internal server error",
                )
            ).model_dump(mode="json"),
        )

    def get_service() -> ShellctlService:
        return cast(ShellctlService, app.state.shellctl_service)

    def verify_auth(
        authorization: Annotated[str | None, Header()] = None,
    ) -> None:
        token = resolved_config.auth_token
        if token is None:
            return
        expected = f"Bearer {token}"
        if authorization != expected:
            raise ShellctlServerError(401, "unauthorized", "Missing or invalid bearer token")

    @app.get("/healthz", response_model=HealthResponse)
    async def healthz() -> HealthResponse:
        return HealthResponse(status=DEFAULT_HEALTH_STATUS)

    @app.post(
        "/v1/jobs/run",
        response_model=JobResult,
        dependencies=[Depends(verify_auth)],
    )
    async def run_job(
        payload: RunJobRequest,
        svc: ShellctlService = Depends(get_service),
    ) -> JobResult:
        return await svc.run_job(payload)

    @app.post(
        "/v1/jobs/{job_id}/wait",
        response_model=JobResult,
        dependencies=[Depends(verify_auth)],
    )
    async def wait_job(
        job_id: str,
        payload: WaitJobRequest,
        svc: ShellctlService = Depends(get_service),
    ) -> JobResult:
        return await svc.wait_job(job_id, payload)

    @app.get(
        "/v1/jobs/{job_id}/log/tail",
        response_model=JobResult,
        dependencies=[Depends(verify_auth)],
    )
    async def tail_job(
        job_id: str,
        output_limit: Annotated[int, Query(ge=1, le=MAX_OUTPUT_LIMIT_BYTES)] = DEFAULT_OUTPUT_LIMIT_BYTES,
        svc: ShellctlService = Depends(get_service),
    ) -> JobResult:
        return await svc.tail_job(job_id, output_limit=output_limit)

    @app.get(
        "/v1/jobs/{job_id}",
        response_model=JobStatusView,
        dependencies=[Depends(verify_auth)],
    )
    async def job_status(
        job_id: str,
        svc: ShellctlService = Depends(get_service),
    ) -> JobStatusView:
        return await svc.get_job_status(job_id)

    @app.get(
        "/v1/jobs",
        response_model=ListJobsResponse,
        dependencies=[Depends(verify_auth)],
    )
    async def list_jobs(
        status: Annotated[JobStatusName | None, Query()] = None,
        limit: Annotated[int, Query(ge=1, le=MAX_LIST_LIMIT)] = DEFAULT_LIST_LIMIT,
        svc: ShellctlService = Depends(get_service),
    ) -> ListJobsResponse:
        return await svc.list_jobs(status=status, limit=limit)

    @app.post(
        "/v1/jobs/{job_id}/input",
        response_model=JobResult,
        dependencies=[Depends(verify_auth)],
    )
    async def input_job(
        job_id: str,
        payload: InputJobRequest,
        svc: ShellctlService = Depends(get_service),
    ) -> JobResult:
        return await svc.send_input(job_id, payload)

    @app.post(
        "/v1/jobs/{job_id}/terminate",
        response_model=JobStatusView,
        dependencies=[Depends(verify_auth)],
    )
    async def terminate_job(
        job_id: str,
        payload: TerminateJobRequest,
        svc: ShellctlService = Depends(get_service),
    ) -> JobStatusView:
        return await svc.terminate_job(job_id, payload)

    @app.delete(
        "/v1/jobs/{job_id}",
        response_model=DeleteJobResponse,
        dependencies=[Depends(verify_auth)],
    )
    async def delete_job(
        job_id: str,
        force: bool = False,
        grace_seconds: float = DEFAULT_TERMINATE_GRACE_SECONDS,
        svc: ShellctlService = Depends(get_service),
    ) -> DeleteJobResponse:
        return await svc.delete_job(job_id, force=force, grace_seconds=grace_seconds)

    return app


__all__ = ["create_app"]
