"""Lightweight bootstrap tests for FastAPI/API v2 app construction."""

from __future__ import annotations

import pytest

from api_fastapi.factory import create_fastapi_app
from api_fastapi.infra import FastAPIInfra
from core.db.session_factory import session_factory
from tests_fastapi.helpers import apptest_get


def test_smoke_endpoint_touches_new_redis_and_db_infra(fake_infra: FastAPIInfra) -> None:
    app = create_fastapi_app(infra=fake_infra)

    response = apptest_get(app, "/api/v2/system/smoke")

    assert response.status_code == 200
    assert response.json() == {"redis": True, "sync_db": True, "async_db": True}


def test_fastapi_openapi_documents_smoke_route(fake_infra: FastAPIInfra) -> None:
    app = create_fastapi_app(infra=fake_infra)

    response = apptest_get(app, "/api/v2/openapi.json")

    assert response.status_code == 200
    schema = response.json()
    assert "/api/v2/system/smoke" in schema["paths"]
    assert "InfraSmokeResponse" in schema["components"]["schemas"]


@pytest.mark.parametrize(
    ("sync_uri", "async_uri"),
    [
        ("postgresql://user:pass@db:5432/dify", "postgresql+asyncpg://user:pass@db:5432/dify"),
        ("postgresql+psycopg2://user:pass@db/dify", "postgresql+asyncpg://user:pass@db/dify"),
        ("mysql+pymysql://user:pass@db/dify", "mysql+aiomysql://user:pass@db/dify"),
        ("sqlite:///:memory:", "sqlite+aiosqlite:///:memory:"),
    ],
)
def test_build_async_database_uri(sync_uri: str, async_uri: str) -> None:
    assert session_factory.build_async_database_uri(sync_uri) == async_uri


def test_build_async_database_uri_rejects_unsupported_driver() -> None:
    with pytest.raises(ValueError, match="Unsupported async database driver"):
        session_factory.build_async_database_uri("oracle://user:pass@db/dify")


def test_create_async_database_engine_accepts_string_false_echo() -> None:
    engine = session_factory.create_async_database_engine("postgresql://user:pass@db:5432/dify", echo="false")
    try:
        assert engine.echo is False
    finally:
        import asyncio

        asyncio.run(engine.dispose())
