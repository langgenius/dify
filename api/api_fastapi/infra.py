"""FastAPI infrastructure assembly for the standalone API v2 process.

Builds DB engines, sync/async session makers, Redis, and the Flask extension
host required by shared services. Engine and sessionmaker construction belongs
to ``core.db.session_factory`` so API v2 and existing service code share one
connection policy.

TODO: remove the Flask extension host after shared services no longer depend on
Flask extension state for database, storage, Redis, sessions, and cookies.
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

    Provides extension initialization only. Do not register HTTP routes,
    request hooks, Socket.IO handlers, or controller modules here.

    TODO: replace Flask extension contracts with framework-neutral providers.
    """

    app = DifyApp("fastapi_infra")
    app.config.from_mapping(dify_config.model_dump())

    from extensions import ext_database, ext_redis, ext_session_factory, ext_set_secretkey, ext_storage

    for extension in (
        ext_database,
        ext_redis,
        # Generated SECRET_KEY values are persisted through storage, so storage
        # must exist before ext_set_secretkey resolves an empty SECRET_KEY.
        ext_storage,
        ext_set_secretkey,
        ext_session_factory,
    ):
        extension.init_app(app)

    return app
