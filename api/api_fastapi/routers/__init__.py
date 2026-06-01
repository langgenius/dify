"""Router aggregation for API v2 endpoints."""

from fastapi import APIRouter

from .smoke import router as smoke_router

router = APIRouter(prefix="/api/v2")
router.include_router(smoke_router)
