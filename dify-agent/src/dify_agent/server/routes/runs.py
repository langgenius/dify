"""FastAPI routes for asynchronous agent runs.

Controllers translate known validation and shutdown errors into HTTP status codes.
Unexpected scheduler or storage failures are intentionally left for FastAPI's
server-error handling so infrastructure problems are not reported as client input
errors. Created runs are scheduled in the current process and observed through
status polling or SSE replay backed by Redis event streams.
"""

from collections.abc import Callable
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from fastapi.responses import StreamingResponse

from dify_agent.protocol.schemas import CreateRunRequest, CreateRunResponse, RunEventsResponse, RunStatusResponse
from dify_agent.runtime.run_scheduler import RunRequestValidationError, RunScheduler, SchedulerStoppingError
from dify_agent.server.sse import sse_event_stream
from dify_agent.storage.redis_run_store import RedisRunStore, RunNotFoundError


def create_runs_router(
    get_store: Callable[[], RedisRunStore],
    get_scheduler: Callable[[], RunScheduler],
) -> APIRouter:
    """Create routes bound to the application's store dependency provider."""
    router = APIRouter(prefix="/runs", tags=["runs"])

    async def store_dep() -> RedisRunStore:
        return get_store()

    async def scheduler_dep() -> RunScheduler:
        return get_scheduler()

    @router.post("", response_model=CreateRunResponse, status_code=202)
    async def create_run(
        request: CreateRunRequest,
        scheduler: Annotated[RunScheduler, Depends(scheduler_dep)],
    ) -> CreateRunResponse:
        try:
            record = await scheduler.create_run(request)
        except RunRequestValidationError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
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
        )

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
