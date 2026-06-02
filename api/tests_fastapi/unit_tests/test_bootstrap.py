"""Lightweight bootstrap tests for FastAPI/API v2 app construction."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from api_fastapi.factory import create_fastapi_app
from api_fastapi.infra import FastAPIInfra
from configs import dify_config
from core.db.session_factory import session_factory
from tests_fastapi.helpers import apptest_get


def test_fastapi_v2_allows_console_cors_preflight(
    fake_infra: FastAPIInfra,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Browser preflights for console-authenticated v2 routes must match Flask console CORS."""

    monkeypatch.setattr(dify_config, "inner_CONSOLE_CORS_ALLOW_ORIGINS", "http://127.0.0.1:3000,*")
    app = create_fastapi_app(infra=fake_infra)

    response = TestClient(app).options(
        "/api/v2/apps/example/workflows/draft",
        headers={
            "Origin": "http://127.0.0.1:3000",
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "Authorization,X-CSRF-Token",
        },
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://127.0.0.1:3000"
    assert response.headers["access-control-allow-credentials"] == "true"
    assert "Authorization" in response.headers["access-control-allow-headers"]
    assert "X-CSRF-Token" in response.headers["access-control-allow-headers"]


def test_health_endpoint_touches_new_redis_and_db_infra(fake_infra: FastAPIInfra) -> None:
    app = create_fastapi_app(infra=fake_infra)

    response = apptest_get(app, "/api/v2/system/health")

    assert response.status_code == 200
    assert response.json() == {"redis": True, "sync_db": True, "async_db": True}


def test_fastapi_openapi_documents_system_probe_routes(fake_infra: FastAPIInfra) -> None:
    app = create_fastapi_app(infra=fake_infra)

    response = apptest_get(app, "/api/v2/openapi.json")

    assert response.status_code == 200
    schema = response.json()
    assert "/api/v2/system/health" in schema["paths"]
    assert "/api/v2/system/ping" in schema["paths"]
    assert "InfraHealthResponse" in schema["components"]["schemas"]


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
