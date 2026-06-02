"""System probe endpoints for API v2 process and dependency readiness."""

from uuid import uuid4

from fastapi import APIRouter
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Session

from api_fastapi.dependencies import AsyncSessionDep, RedisDep, SyncSessionDep
from extensions.ext_redis import RedisClientWrapper

router = APIRouter(prefix="/system", tags=["system"])


class InfraHealthResponse(BaseModel):
    redis: bool
    sync_db: bool
    async_db: bool


class HealthResponse(BaseModel):
    status: str


@router.get("/ping")
async def ping() -> HealthResponse:
    """Unauthenticated process health probe that avoids external dependencies."""

    return HealthResponse(status="ok")


@router.get("/health")
async def health(
    redis: RedisDep,
    sync_session: SyncSessionDep,
    async_session: AsyncSessionDep,
) -> InfraHealthResponse:
    """Unauthenticated dependency health probe for new FastAPI infrastructure."""

    redis_ok = _touch_redis(redis)
    sync_db_ok = _touch_sync_db(sync_session)
    async_db_ok = await _touch_async_db(async_session)
    return InfraHealthResponse(redis=redis_ok, sync_db=sync_db_ok, async_db=async_db_ok)


def _touch_redis(redis: RedisClientWrapper) -> bool:
    key = f"fastapi:health:{uuid4()}"
    redis.set(key, "1", ex=30)
    value = redis.get(key)
    redis.delete(key)
    return value in {b"1", "1", 1}


def _touch_sync_db(session: Session) -> bool:
    return session.execute(text("SELECT 1")).scalar_one() == 1


async def _touch_async_db(session: AsyncSession) -> bool:
    result = await session.execute(text("SELECT 1"))
    return result.scalar_one() == 1
