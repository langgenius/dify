"""FastAPI dependency providers for shared API v2 infrastructure."""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import Depends, Request
from flask import Flask
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Session

from extensions.ext_redis import RedisClientWrapper

from .infra import FastAPIInfra


def get_fastapi_infra(request: Request) -> FastAPIInfra:
    return request.app.state.infra


FastAPIInfraDep = Annotated[FastAPIInfra, Depends(get_fastapi_infra)]


def get_extension_host(infra: FastAPIInfraDep) -> Flask:
    return infra.extension_host


ExtensionHostDep = Annotated[Flask, Depends(get_extension_host)]


def get_redis(infra: FastAPIInfraDep) -> RedisClientWrapper:
    return infra.redis


RedisDep = Annotated[RedisClientWrapper, Depends(get_redis)]


async def get_sync_session(infra: FastAPIInfraDep) -> AsyncIterator[Session]:
    """Yield a request-scoped sync session with an explicit transaction boundary."""

    with infra.sync_session_maker() as session:
        with session.begin():
            yield session


SyncSessionDep = Annotated[Session, Depends(get_sync_session)]


async def get_async_session(infra: FastAPIInfraDep) -> AsyncIterator[AsyncSession]:
    """Yield a request-scoped async session with an explicit transaction boundary."""

    async with infra.async_session_maker() as session:
        async with session.begin():
            yield session


AsyncSessionDep = Annotated[AsyncSession, Depends(get_async_session)]
