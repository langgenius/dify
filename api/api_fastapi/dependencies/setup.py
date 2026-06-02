"""Setup guard dependencies for protected API v2 routes."""

from __future__ import annotations

from collections.abc import Callable
from inspect import isawaitable
from typing import Annotated, Any, cast

from fastapi import Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Session

from api_fastapi.dependencies.infra import get_async_session, get_sync_session
from api_fastapi.exceptions import NotSetupError
from configs import dify_config
from models.model import DifySetup


async def require_setup_for_session(session: Session | AsyncSession) -> None:
    """Require completed self-hosted setup using a caller-owned session."""

    if dify_config.EDITION != "SELF_HOSTED":
        return

    setup = cast(Any, session).scalar(select(DifySetup).limit(1))
    if isawaitable(setup):
        setup = await setup
    if not setup:
        raise NotSetupError()


def require_setup(session: Session) -> None:
    """Require completed self-hosted setup using a caller-owned sync session."""

    if dify_config.EDITION == "SELF_HOSTED" and not session.scalar(select(DifySetup).limit(1)):
        raise NotSetupError()


async def require_setup_async(session: AsyncSession) -> None:
    """Require completed self-hosted setup using a caller-owned async session."""

    await require_setup_for_session(session)


def setup_required(session_dependency: Callable[..., Any]) -> Any:
    """Build a setup dependency from the route's session provider."""

    session_dep = Depends(session_dependency)

    async def dependency(session: Session | AsyncSession = session_dep) -> None:
        await require_setup_for_session(session)

    return Depends(dependency)


SetupDep = Annotated[None, setup_required(get_sync_session)]
AsyncSetupDep = Annotated[None, setup_required(get_async_session)]
