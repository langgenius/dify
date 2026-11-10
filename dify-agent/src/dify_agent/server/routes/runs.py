"""FastAPI routes for asynchronous agent runs.

Controllers translate shutdown errors into HTTP status codes. Runtime request
failures are intentionally not pre-mapped here: once a request passes DTO
validation it is accepted for background execution, and bad compositions or
snapshots fail later through normal run events/status. Unexpected scheduler or
storage failures are intentionally left for FastAPI's server-error handling so
infrastructure problems are not reported as client input errors. Created runs
are scheduled in the current process and observed through status polling or SSE
replay backed by Redis event streams.
"""

from collections.abc import Callable
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, Response
from fastapi.responses import StreamingResponse
from pydantic import ValidationError

from dify_agent.protocol.native_testing import (
    NATIVE_TEST_CAPABILITIES,
    ContinueRunRequest,
    ContinuationClaim,
    NativeTestCapabilities,
    NativeTestProtocolUnsupported,
    require_native_test_capabilities,
)
from dify_agent.protocol.run_recovery import LookupRunRequest
from dify_agent.protocol.schemas import (
    CancelRunRequest,
    CancelRunResponse,
    CreateRunRequest,
    CreateRunResponse,
    RunEventsResponse,
    RunStatusResponse,
)
from dify_agent.runtime.native_continuation import NativeContinuationConflict, NativePolicyStopped
from dify_agent.runtime.run_scheduler import RunCancellationConflictError, RunScheduler, SchedulerStoppingError
from dify_agent.server.sse import sse_event_stream
from dify_agent.storage.redis_run_store import RedisRunStore, RunCreateConflictError, RunNotFoundError


def create_runs_router(
    get_store: Callable[[], RedisRunStore],
    get_scheduler: Callable[[], RunScheduler],
    get_capabilities: Callable[[], NativeTestCapabilities] = lambda: NATIVE_TEST_CAPABILITIES,
    *,
    enable_lookup: bool = False,
) -> APIRouter:
    router = APIRouter(prefix="/runs", tags=["runs"])

    async def store_dep() -> RedisRunStore:
        return get_store()

    async def scheduler_dep() -> RunScheduler:
        return get_scheduler()

    def require_capabilities(*, profile: Literal["isolated", "confirmed"] = "isolated") -> None:
        try:
            require_native_test_capabilities(get_capabilities(), profile=profile)
        except NativeTestProtocolUnsupported as exc:
            raise HTTPException(status_code=409, detail={"code": exc.code}) from exc

    @router.get("/capabilities", response_model=NativeTestCapabilities)
    async def capabilities() -> NativeTestCapabilities:
        return get_capabilities()

    if enable_lookup:

        @router.post("/lookup", response_model=CreateRunResponse)
        async def lookup_run(
            request: Request,
            response: Response,
            store: Annotated[RedisRunStore, Depends(store_dep)],
        ) -> CreateRunResponse:
            """Recover retained acceptance without configuration reads or dispatch."""
            response.headers["Cache-Control"] = "no-store"
            body = bytearray()
            async for chunk in request.stream():
                if len(body) + len(chunk) > 4096:
                    raise HTTPException(413, "lookup request too large", headers={"Cache-Control": "no-store"})
                body.extend(chunk)
            try:
                selection = LookupRunRequest.model_validate_json(body)
            except ValidationError:
                # Default FastAPI errors echo rejected input, which could include
                # private configuration even though this DTO forbids that input.
                raise HTTPException(
                    422, "invalid create identity selection", headers={"Cache-Control": "no-store"}
                ) from None
            try:
                return await store.lookup_run(selection)
            except RunNotFoundError as exc:
                raise HTTPException(404, "run not found", headers={"Cache-Control": "no-store"}) from exc
            except RunCreateConflictError as exc:
                raise HTTPException(409, "create identity unavailable", headers={"Cache-Control": "no-store"}) from exc

    @router.post("/{run_id}/continue", response_model=ContinuationClaim, status_code=202)
    async def continue_run(
        run_id: str,
        request: ContinueRunRequest,
        scheduler: Annotated[RunScheduler, Depends(scheduler_dep)],
    ) -> ContinuationClaim:
        # The scheduler checks the durable checkpoint's exact profile. The
        # request carries no profile; preserve isolated clients' old contract.
        capabilities = get_capabilities()
        if capabilities.protocol_version != 1 or not {"pending-call-v1", "policy-gate-v1"}.issubset(
            capabilities.features
        ):
            raise HTTPException(status_code=409, detail={"code": "native_test_protocol_unsupported"})
        try:
            return await scheduler.continue_run(run_id, request)
        except NativeTestProtocolUnsupported as exc:
            raise HTTPException(status_code=409, detail={"code": exc.code}) from exc
        except RunNotFoundError as exc:
            raise HTTPException(status_code=404, detail="run not found") from exc
        except NativePolicyStopped as exc:
            raise HTTPException(
                status_code=409, detail={"code": "native_policy_stopped", "reason_code": exc.reason_code}
            ) from exc
        except NativeContinuationConflict as exc:
            raise HTTPException(status_code=409, detail={"code": "native_continuation_conflict"}) from exc
        except SchedulerStoppingError as exc:
            raise HTTPException(status_code=503, detail="run scheduler is shutting down") from exc

    @router.post("", response_model=CreateRunResponse, status_code=202)
    async def create_run(
        request: CreateRunRequest,
        scheduler: Annotated[RunScheduler, Depends(scheduler_dep)],
    ) -> CreateRunResponse:
        if request.execution_mode == "builder_test":
            require_capabilities(profile=request.native_test_profile)
        try:
            record = await scheduler.create_run(request)
        except NativePolicyStopped as exc:
            raise HTTPException(
                status_code=409, detail={"code": "native_policy_stopped", "reason_code": exc.reason_code}
            ) from exc
        except NativeTestProtocolUnsupported as exc:
            raise HTTPException(status_code=409, detail={"code": exc.code}) from exc
        except RunCreateConflictError as exc:
            raise HTTPException(status_code=409, detail="create identity unavailable") from exc
        except SchedulerStoppingError as exc:
            raise HTTPException(status_code=503, detail="run scheduler is shutting down") from exc
        return CreateRunResponse(run_id=record.run_id, status=record.status)

    @router.get("/{run_id}", response_model=RunStatusResponse)
    async def get_run_status(run_id: str, store: Annotated[RedisRunStore, Depends(store_dep)]) -> RunStatusResponse:
        try:
            record = await store.get_run(run_id)
        except RunNotFoundError as exc:
            raise HTTPException(status_code=404, detail="run not found") from exc
        return RunStatusResponse(
            run_id=record.run_id,
            status=record.status,
            created_at=record.created_at,
            updated_at=record.updated_at,
            error=record.error,
            error_type=record.error_type,
        )

    @router.post("/{run_id}/cancel", response_model=CancelRunResponse)
    async def cancel_run(
        run_id: str,
        request: CancelRunRequest,
        scheduler: Annotated[RunScheduler, Depends(scheduler_dep)],
    ) -> CancelRunResponse:
        """Persist cancellation; the owner process observes it and stops its runner."""
        try:
            return await scheduler.cancel_run(run_id, request)
        except RunNotFoundError as exc:
            raise HTTPException(status_code=404, detail="run not found") from exc
        except RunCancellationConflictError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc

    @router.get("/{run_id}/events", response_model=RunEventsResponse)
    async def get_run_events(
        run_id: str,
        store: Annotated[RedisRunStore, Depends(store_dep)],
        after: str = Query(default="0-0"),
        limit: int = Query(default=100, ge=1, le=500),
    ) -> RunEventsResponse:
        try:
            return await store.get_events(run_id, after=after, limit=limit)
        except RunNotFoundError as exc:
            raise HTTPException(status_code=404, detail="run not found") from exc

    @router.get("/{run_id}/events/sse")
    async def stream_run_events(
        run_id: str,
        store: Annotated[RedisRunStore, Depends(store_dep)],
        last_event_id: Annotated[str | None, Header(alias="Last-Event-ID")] = None,
        after: str | None = Query(default=None),
    ) -> StreamingResponse:
        cursor = after or last_event_id or "0-0"
        try:
            _ = await store.get_run(run_id)
            events = store.iter_events(run_id, after=cursor)
            return StreamingResponse(sse_event_stream(events), media_type="text/event-stream")
        except RunNotFoundError as exc:
            raise HTTPException(status_code=404, detail="run not found") from exc

    return router


__all__ = ["create_runs_router"]
