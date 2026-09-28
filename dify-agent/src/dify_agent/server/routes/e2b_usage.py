"""One-shot provider accounting endpoint, invoked by the API's Celery task.

The E2B credential stays in its existing service. Collection owns separate HTTP
clients, has no Redis leader or recurring task, and never touches runtime leases.
Invalid optional accounting configuration fails only this endpoint.
"""

import asyncio
import logging

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from dify_agent.server.auth import create_bearer_token_dependency
from dify_agent.server.e2b_usage_client import E2BUsageApiClient
from dify_agent.server.e2b_usage_collector import E2BUsageCollector
from dify_agent.server.settings import ServerSettings

logger = logging.getLogger(__name__)
_COLLECTION_TIMEOUT_SECONDS = 240.0


class E2BUsageCollectRequest(BaseModel):
    project_id: str = Field(min_length=1, max_length=128)
    model_config = ConfigDict(extra="forbid")


class E2BUsageCollectResponse(BaseModel):
    completed: bool


class _CollectionOptions(BaseModel):
    overlap_seconds: int = Field(ge=1)
    full_scan_interval_seconds: int = Field(ge=1)
    max_pages: int = Field(ge=1, le=10000)


def create_e2b_usage_router(settings: ServerSettings) -> APIRouter:
    async def require_configured_auth() -> None:
        # Other legacy control-plane routes may permit a missing token. New
        # collection requests must never expose the project key without auth.
        if not settings.api_token:
            raise HTTPException(status_code=503, detail="e2b_usage_collection_auth_unconfigured")

    router = APIRouter(
        prefix="/internal/e2b/usage",
        dependencies=[Depends(require_configured_auth), create_bearer_token_dependency(settings.api_token)],
    )

    @router.post("/collect", response_model=E2BUsageCollectResponse)
    async def collect(request: E2BUsageCollectRequest) -> E2BUsageCollectResponse:
        project_id = settings.e2b_project_id.strip()
        if (
            not settings.sandbox_metering_enabled
            or settings.runtime_backend != "e2b"
            or not settings.e2b_api_key
            or not project_id
            or not settings.inner_api_key
        ):
            raise HTTPException(status_code=503, detail="e2b_usage_collection_unavailable")
        if request.project_id != project_id:
            raise HTTPException(status_code=403, detail="e2b_usage_project_mismatch")
        try:
            options = _CollectionOptions.model_validate(
                {
                    "overlap_seconds": settings.sandbox_metering_overlap_seconds,
                    "full_scan_interval_seconds": settings.sandbox_metering_full_scan_interval_seconds,
                    "max_pages": settings.sandbox_metering_max_pages,
                }
            )
            async with (
                asyncio.timeout(_COLLECTION_TIMEOUT_SECONDS),
                httpx.AsyncClient(timeout=15.0, trust_env=False) as provider_client,
                httpx.AsyncClient(timeout=15.0, trust_env=False) as inner_client,
            ):
                collector = E2BUsageCollector(
                    provider_client=provider_client,
                    usage_client=E2BUsageApiClient(
                        client=inner_client,
                        base_url=settings.inner_api_url,
                        api_key=settings.inner_api_key,
                        project_id=project_id,
                    ),
                    api_key=settings.e2b_api_key,
                    project_id=project_id,
                    overlap_seconds=options.overlap_seconds,
                    full_scan_interval_seconds=options.full_scan_interval_seconds,
                    max_pages=options.max_pages,
                )
                return E2BUsageCollectResponse(completed=await collector.collect_once())
        except TimeoutError as exc:
            logger.warning("E2B usage collection exceeded its deadline")
            raise HTTPException(status_code=504, detail="e2b_usage_collection_timed_out") from exc
        except Exception as exc:
            logger.warning("E2B usage collection failed", extra={"error_type": type(exc).__name__})
            raise HTTPException(status_code=503, detail="e2b_usage_collection_failed") from exc

    return router
