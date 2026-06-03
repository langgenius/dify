"""Router aggregation for API v2 endpoints."""

from fastapi import APIRouter

from .smoke import router as system_router
from .workflows import router as workflows_router

router = APIRouter(prefix="/api/v2")
router.include_router(system_router)
router.include_router(workflows_router)
