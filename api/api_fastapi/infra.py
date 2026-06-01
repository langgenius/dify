"""FastAPI infrastructure assembly for the standalone API v2 process.

Provides PostgreSQL and Redis, also the legacy Flask extension host.
Database engine and sessionmaker construction lives in ``core.db.session_factory``.

This module still creates a minimal Flask extension host because shared services
depend on Flask extension state during the migration.
"""

from __future__ import annotations

from dataclasses import dataclass

from flask import Flask
from sqlalchemy import Engine
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import Session, sessionmaker

from configs import dify_config
from core.db.session_factory import session_factory
from dify_app import DifyApp
from extensions.ext_redis import RedisClientWrapper, redis_client


@dataclass(frozen=True)
class FastAPIInfra:
    """Infrastructure handles exposed through FastAPI dependency injection."""

    extension_host: Flask
    sync_engine: Engine
    sync_session_maker: sessionmaker[Session]
    async_engine: AsyncEngine
    async_session_maker: async_sessionmaker[AsyncSession]
    redis: RedisClientWrapper


def create_fastapi_infra() -> FastAPIInfra:
    """Initialize infrastructure owned by the standalone FastAPI process."""

    extension_host = _create_extension_host_app()
    sync_engine = session_factory.get_engine()
    sync_session_maker = session_factory.get_session_maker()
    async_engine, async_session_maker = session_factory.configure_async_from_uri(
        dify_config.SQLALCHEMY_DATABASE_URI,
        echo=dify_config.SQLALCHEMY_ECHO,
    )

    return FastAPIInfra(
        extension_host=extension_host,
        sync_engine=sync_engine,
        sync_session_maker=sync_session_maker,
        async_engine=async_engine,
        async_session_maker=async_session_maker,
        redis=redis_client,
    )


def _create_extension_host_app() -> DifyApp:
    """Create the minimal Flask extension host required by shared services.

    Some existing service-layer code still depends on Flask extension state
    such as Flask-SQLAlchemy's scoped session and Flask's cookie serializer.
    This app intentionally does not register HTTP routes, controllers, request
    hooks, or Socket.IO handlers.

    TODO: ultimately remove these
    """

    app = DifyApp("fastapi_infra")
    app.config.from_mapping(dify_config.model_dump())

    from extensions import ext_database, ext_redis, ext_session_factory, ext_set_secretkey

    for extension in (
        ext_database,
        ext_redis,
        ext_set_secretkey,
        ext_session_factory,
    ):
        extension.init_app(app)

    return app
