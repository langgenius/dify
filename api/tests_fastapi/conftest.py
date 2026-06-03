"""Shared pytest fixtures for FastAPI/API v2 tests."""

from __future__ import annotations

import asyncio
from collections.abc import Generator
from typing import TYPE_CHECKING, Any, cast

import pytest
from fastapi.testclient import TestClient
from flask import Flask
from sqlalchemy import create_engine
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.orm import sessionmaker

from api_fastapi.infra import FastAPIInfra
from extensions.ext_redis import RedisClientWrapper

if TYPE_CHECKING:
    from tests_fastapi.container_setup import DifyFastAPITestContainers, FastAPIContainerApp


@pytest.fixture
def fake_infra() -> Generator[FastAPIInfra, None, None]:
    """Provide lightweight infra that exercises real sync and async SQLAlchemy session contracts."""

    extension_host = Flask("fastapi-test")
    sync_engine = create_engine("sqlite:///:memory:")
    async_engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async_session_maker = async_sessionmaker(bind=async_engine, expire_on_commit=False)
    try:
        yield FastAPIInfra(
            extension_host=extension_host,
            sync_engine=sync_engine,
            sync_session_maker=sessionmaker(bind=sync_engine, expire_on_commit=False),
            async_engine=async_engine,
            async_session_maker=async_session_maker,
            redis=cast(RedisClientWrapper, _Redis()),
        )
    finally:
        sync_engine.dispose()
        asyncio.run(async_engine.dispose())


@pytest.fixture(scope="session")
def fastapi_containers() -> Generator[DifyFastAPITestContainers, None, None]:
    from tests_fastapi.container_setup import DifyFastAPITestContainers

    containers = DifyFastAPITestContainers()
    containers.start()
    try:
        yield containers
    finally:
        containers.stop()


@pytest.fixture(scope="session")
def fastapi_app_with_containers(fastapi_containers: DifyFastAPITestContainers) -> FastAPIContainerApp:
    from tests_fastapi.container_setup import create_fastapi_app_with_containers

    del fastapi_containers  # Define fixture dependency: starts containers before app creation.
    return create_fastapi_app_with_containers()


@pytest.fixture
def fastapi_client_with_containers(
    fastapi_app_with_containers: FastAPIContainerApp,
) -> Generator[TestClient, None, None]:
    with TestClient(fastapi_app_with_containers.app) as client:
        yield client


class _Redis:
    _values: dict[str, Any]

    def __init__(self) -> None:
        self._values = {}

    def set(self, name: str, value: Any, **_kwargs: Any) -> None:
        self._values[name] = value

    def get(self, name: str) -> Any | None:
        return self._values.get(name)

    def delete(self, name: str) -> None:
        self._values.pop(name, None)
