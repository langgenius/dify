"""Integration checks for the FastAPI testcontainers bootstrap.

The savepoint tests intentionally commit inside request handlers. The override
must make those commits visible during the test while still rolling everything
back when the override context exits.
"""

from __future__ import annotations

import asyncio
from uuid import uuid4

from fastapi.testclient import TestClient
from httpx import ASGITransport, AsyncClient
from sqlalchemy import Select, func, select
from sqlalchemy.orm import Session

from api_fastapi.dependencies import AsyncSessionDep, SyncSessionDep
from models.model import DifySetup
from tests_fastapi.container_setup import (
    FastAPIContainerApp,
    async_session_savepoint_override,
    sync_session_savepoint_override,
)


def test_health_route_uses_fastapi_testcontainers(fastapi_client_with_containers: TestClient) -> None:
    response = fastapi_client_with_containers.get("/api/v2/system/health")

    assert response.status_code == 200
    assert response.json() == {"redis": True, "sync_db": True, "async_db": True}


def test_sync_dependency_commit_is_rolled_back_by_savepoint_override(
    fastapi_app_with_containers: FastAPIContainerApp,
) -> None:
    version = f"fastapi-poc-{uuid4()}"

    @fastapi_app_with_containers.app.post("/api/v2/test-only/dify-setup/{version}")
    async def create_sync_setup(version: str, session: SyncSessionDep) -> dict[str, str]:
        record = DifySetup(version=version)
        session.add(record)
        session.flush()
        session.commit()
        return {"version": record.version}

    with sync_session_savepoint_override(fastapi_app_with_containers) as savepoint_override:
        with TestClient(savepoint_override.app) as client:
            response = client.post(f"/api/v2/test-only/dify-setup/{version}")

        assert response.status_code == 200
        assert response.json() == {"version": version}

        with savepoint_override.session_maker() as session:
            saved_version = session.execute(select(DifySetup.version).where(DifySetup.version == version)).scalar_one()
            assert saved_version == version

    assert _count_dify_setup_versions(fastapi_app_with_containers, version) == 0


def test_async_dependency_commit_is_rolled_back_by_savepoint_override(
    fastapi_app_with_containers: FastAPIContainerApp,
) -> None:
    asyncio.run(_assert_async_dependency_commit_is_rolled_back_by_savepoint_override(fastapi_app_with_containers))


async def _assert_async_dependency_commit_is_rolled_back_by_savepoint_override(
    fastapi_app_with_containers: FastAPIContainerApp,
) -> None:
    version = f"fastapi-async-poc-{uuid4()}"

    @fastapi_app_with_containers.app.post("/api/v2/test-only/async-dify-setup/{version}")
    async def create_async_setup(version: str, session: AsyncSessionDep) -> dict[str, str]:
        record = DifySetup(version=version)
        session.add(record)
        await session.flush()
        await session.commit()
        return {"version": record.version}

    async with async_session_savepoint_override(fastapi_app_with_containers) as savepoint_override:
        transport = ASGITransport(app=savepoint_override.app)
        async with AsyncClient(transport=transport, base_url="http://testserver") as client:
            response = await client.post(f"/api/v2/test-only/async-dify-setup/{version}")

        assert response.status_code == 200
        assert response.json() == {"version": version}

        async with savepoint_override.session_maker() as session:
            result = await session.execute(select(DifySetup.version).where(DifySetup.version == version))
            saved_version = result.scalar_one()
            assert saved_version == version

    assert _count_dify_setup_versions(fastapi_app_with_containers, version) == 0


def _count_dify_setup_versions(container_app: FastAPIContainerApp, version: str) -> int:
    stmt: Select[tuple[int]] = select(func.count()).select_from(DifySetup).where(DifySetup.version == version)
    with Session(container_app.infra.sync_engine, expire_on_commit=False) as session:
        return session.execute(stmt).scalar_one()
