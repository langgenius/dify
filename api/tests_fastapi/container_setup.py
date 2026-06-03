"""Reusable FastAPI testcontainers bootstrap for API v2 integration tests.

Includes testcontainers for PostgreSQL and Redis.
"""

from __future__ import annotations

import os
from collections.abc import AsyncGenerator, AsyncIterator, Generator, Iterator, Sequence
from contextlib import asynccontextmanager, contextmanager
from dataclasses import dataclass
from typing import TYPE_CHECKING, Protocol

import psycopg2
from fastapi import FastAPI
from pydantic_settings import BaseSettings
from sqlalchemy import Engine, Table, inspect, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from sqlalchemy.orm import Session, sessionmaker
from testcontainers.postgres import PostgresContainer
from testcontainers.redis import RedisContainer

if TYPE_CHECKING:
    from api_fastapi.infra import FastAPIInfra


@dataclass(frozen=True)
class FastAPIContainerApp:
    app: FastAPI
    infra: FastAPIInfra


@dataclass(frozen=True)
class SyncSavepointOverride:
    """Sync dependency override bound to a transaction rolled back after the test."""

    app: FastAPI
    session_maker: sessionmaker[Session]


@dataclass(frozen=True)
class AsyncSavepointOverride:
    """Async dependency override bound to a transaction rolled back after the test."""

    app: FastAPI
    session_maker: async_sessionmaker[AsyncSession]


class DifyFastAPITestContainers:
    """FastAPI-focused container manager for API v2 integration tests."""

    postgres: PostgresContainer | None
    redis: RedisContainer | None
    _containers_started: bool

    def __init__(self) -> None:
        self.postgres = None
        self.redis = None
        self._containers_started = False

    def start(self) -> None:
        if self._containers_started:
            return

        try:
            self.postgres = PostgresContainer(image=_POSTGRES_IMAGE)
            self.postgres.start()

            db_host = self.postgres.get_container_host_ip()
            db_port = self.postgres.get_exposed_port(5432)
            os.environ["DB_TYPE"] = "postgresql"
            os.environ["DB_HOST"] = db_host
            os.environ["DB_PORT"] = str(db_port)
            os.environ["DB_USERNAME"] = self.postgres.username
            os.environ["DB_PASSWORD"] = self.postgres.password
            os.environ["DB_DATABASE"] = self.postgres.dbname
            _install_postgres_extensions(
                host=db_host,
                port=db_port,
                username=self.postgres.username,
                password=self.postgres.password,
                database=self.postgres.dbname,
            )

            self.redis = RedisContainer(image=_REDIS_IMAGE, port=6379)
            self.redis.start()
            os.environ["REDIS_HOST"] = self.redis.get_container_host_ip()
            os.environ["REDIS_PORT"] = str(self.redis.get_exposed_port(6379))
            os.environ["REDIS_USERNAME"] = ""
            os.environ["REDIS_PASSWORD"] = ""

            os.environ.setdefault("STORAGE_TYPE", "opendal")
            os.environ.setdefault("OPENDAL_SCHEME", "fs")
            os.environ.setdefault("OPENDAL_FS_ROOT", "/tmp/dify-fastapi-storage")

            self._containers_started = True
        except Exception:
            self.stop()
            raise

    def stop(self) -> None:
        for container in (self.redis, self.postgres):
            if container is not None:
                container.stop()
        self.redis = None
        self.postgres = None
        self._containers_started = False


def create_fastapi_app_with_containers() -> FastAPIContainerApp:
    """Create a FastAPI app backed by the FastAPI testcontainers stack."""

    _reset_runtime_config()

    from api_fastapi.factory import create_fastapi_app
    from api_fastapi.infra import create_fastapi_infra

    infra = create_fastapi_infra()
    _initialize_database_schema(infra)
    return FastAPIContainerApp(app=create_fastapi_app(infra=infra), infra=infra)


@contextmanager
def sync_session_savepoint_override(
    container_app: FastAPIContainerApp,
) -> Generator[SyncSavepointOverride, None, None]:
    """Override sync DB dependency with sessions joined to one rollbackable transaction."""

    from api_fastapi.dependencies import get_sync_session

    connection = container_app.infra.sync_engine.connect()
    transaction = connection.begin()

    sync_session_maker = sessionmaker(
        bind=connection,
        expire_on_commit=False,
        join_transaction_mode="create_savepoint",
    )

    def override_get_sync_session() -> Iterator[Session]:
        with sync_session_maker() as session:
            with session.begin():
                yield session

    container_app.app.dependency_overrides[get_sync_session] = override_get_sync_session
    try:
        yield SyncSavepointOverride(app=container_app.app, session_maker=sync_session_maker)
    finally:
        container_app.app.dependency_overrides.pop(get_sync_session, None)
        transaction.rollback()
        connection.close()


@asynccontextmanager
async def async_session_savepoint_override(
    container_app: FastAPIContainerApp,
) -> AsyncGenerator[AsyncSavepointOverride, None]:
    """Override async DB dependency with sessions joined to one rollbackable transaction."""

    from api_fastapi.dependencies import get_async_session

    connection = await container_app.infra.async_engine.connect()
    transaction = await connection.begin()

    async_session_maker = async_sessionmaker(
        bind=connection,
        expire_on_commit=False,
        join_transaction_mode="create_savepoint",
    )

    async def override_get_async_session() -> AsyncIterator[AsyncSession]:
        async with async_session_maker() as session:
            async with session.begin():
                yield session

    container_app.app.dependency_overrides[get_async_session] = override_get_async_session
    try:
        yield AsyncSavepointOverride(app=container_app.app, session_maker=async_session_maker)
    finally:
        container_app.app.dependency_overrides.pop(get_async_session, None)
        await transaction.rollback()
        await connection.close()


_POSTGRES_IMAGE = "postgres:15-alpine"
_REDIS_IMAGE = "redis:6-alpine"


class _CloserProtocol(Protocol):
    def close(self) -> None:
        pass


@contextmanager
def _auto_close[T: _CloserProtocol](closer: T) -> Generator[T, None, None]:
    try:
        yield closer
    finally:
        closer.close()


# Taken from api/migrations/versions/2025_07_02_2332-1c9ba48be8e4_add_uuidv7_function_in_sql.py
_UUIDv7SQL = r"""
CREATE OR REPLACE FUNCTION uuidv7() RETURNS uuid
AS
$$
SELECT encode(
               set_bit(
                       set_bit(
                               overlay(uuid_send(gen_random_uuid()) placing
                                       substring(int8send((extract(epoch from clock_timestamp()) * 1000)::bigint) from
                                                 3)
                                       from 1 for 6),
                               52, 1),
                       53, 1), 'hex')::uuid;
$$ LANGUAGE SQL VOLATILE PARALLEL SAFE;

COMMENT ON FUNCTION uuidv7 IS
    'Generate a uuid-v7 value with a 48-bit timestamp (millisecond precision) and 74 bits of randomness';

CREATE OR REPLACE FUNCTION uuidv7_boundary(timestamptz) RETURNS uuid
AS
$$
SELECT encode(
               overlay('\x00000000000070008000000000000000'::bytea
                       placing substring(int8send(floor(extract(epoch from $1) * 1000)::bigint) from 3)
                       from 1 for 6),
               'hex')::uuid;
$$ LANGUAGE SQL STABLE STRICT PARALLEL SAFE;

COMMENT ON FUNCTION uuidv7_boundary(timestamptz) IS
    'Generate a non-random uuidv7 with the given timestamp and all random bits to 0';
"""


def _install_postgres_extensions(*, host: str, port: int, username: str, password: str, database: str) -> None:
    conn = psycopg2.connect(host=host, port=port, user=username, password=password, database=database)
    conn.autocommit = True
    with _auto_close(conn):
        with conn.cursor() as cursor:
            cursor.execute('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";')
            cursor.execute('CREATE EXTENSION IF NOT EXISTS "pgcrypto";')


def _reset_runtime_config() -> None:
    from configs import dify_config
    from extensions import ext_redis

    ext_redis.redis_client._client = None
    dify_config.__dict__.clear()
    BaseSettings.__init__(dify_config)


def _initialize_database_schema(infra: FastAPIInfra) -> None:
    import models  # noqa: F401
    from extensions.ext_database import db

    with infra.extension_host.app_context():
        with db.engine.connect() as connection, connection.begin():
            connection.execute(text(_UUIDv7SQL))
        db.create_all()
        _assert_schema_ready(db.engine, db.metadata.sorted_tables)


def _assert_schema_ready(engine: Engine, expected_tables: Sequence[Table]) -> None:
    checks = {
        "uuidv7": "SELECT uuidv7() IS NOT NULL",
        "accounts table": "SELECT to_regclass('public.accounts') IS NOT NULL",
        "dify_setups table": "SELECT to_regclass('public.dify_setups') IS NOT NULL",
    }
    with engine.connect() as connection:
        for name, sql in checks.items():
            if not connection.execute(text(sql)).scalar_one():
                raise RuntimeError(f"FastAPI test database schema check failed: {name}")

    inspector = inspect(engine)
    actual_table_names = set(inspector.get_table_names(schema="public"))
    expected_table_names = {table.name for table in expected_tables}
    missing_tables = sorted(expected_table_names - actual_table_names)
    if missing_tables:
        raise RuntimeError(f"FastAPI test database schema is missing tables: {missing_tables}")

    missing_columns: dict[str, list[str]] = {}
    for table in expected_tables:
        actual_column_names = {column["name"] for column in inspector.get_columns(table.name, schema="public")}
        expected_column_names = {column.name for column in table.columns}
        table_missing_columns = sorted(expected_column_names - actual_column_names)
        if table_missing_columns:
            missing_columns[table.name] = table_missing_columns
    if missing_columns:
        raise RuntimeError(f"FastAPI test database schema is missing columns: {missing_columns}")
