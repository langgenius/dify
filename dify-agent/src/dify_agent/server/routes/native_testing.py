"""Private selected-wait read; composed only behind configured service auth."""

from collections.abc import Callable

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response
from pydantic import ValidationError

from dify_agent.protocol.native_continuation import (
    MAX_CHECKPOINT_REQUEST_BYTES,
    MAX_CHECKPOINT_RESPONSE_BYTES,
    ReadNativeCheckpointRequest,
    SelectedNativeCheckpoint,
)
from dify_agent.runtime.native_continuation import NativeContinuationConflict
from dify_agent.storage.redis_run_store import RedisRunStore, RunNotFoundError


def create_native_testing_router(get_store: Callable[[], RedisRunStore]) -> APIRouter:
    router = APIRouter(prefix="/runs", tags=["native-testing-private"])

    @router.post("/{run_id}/native-checkpoint", response_model=SelectedNativeCheckpoint)
    async def read_native_checkpoint(run_id: str, request: Request) -> Response:
        body = bytearray()
        async for chunk in request.stream():
            if len(body) + len(chunk) > MAX_CHECKPOINT_REQUEST_BYTES:
                raise HTTPException(status_code=413, detail="native checkpoint request too large")
            body.extend(chunk)
        try:
            selection = ReadNativeCheckpointRequest.model_validate_json(body)
        except ValidationError:
            raise HTTPException(status_code=422, detail="invalid native checkpoint selection") from None
        try:
            selected = await get_store().read_native_checkpoint(run_id=run_id, request=selection)
            content = selected.model_dump_json().encode()
            if len(content) > MAX_CHECKPOINT_RESPONSE_BYTES:
                raise NativeContinuationConflict("selected native checkpoint unavailable")
        except RunNotFoundError:
            raise HTTPException(status_code=404, detail="run not found") from None
        except NativeContinuationConflict:
            raise HTTPException(status_code=409, detail="selected native checkpoint unavailable") from None
        return Response(content=content, media_type="application/json", headers={"Cache-Control": "no-store"})

    return router
