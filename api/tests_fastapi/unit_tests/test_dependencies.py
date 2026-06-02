"""Unit tests for API v2 dependency helpers."""

from __future__ import annotations

import asyncio
from typing import Any, cast

import pytest
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Session

from api_fastapi.dependencies import require_setup, require_setup_async, require_setup_for_session
from api_fastapi.exceptions import NotSetupError
from configs import dify_config


class _SyncScalarSession:
    def __init__(self, value: object | None) -> None:
        self.value = value

    def scalar(self, statement: Any) -> object | None:
        return self.value


class _AsyncScalarSession:
    def __init__(self, value: object | None) -> None:
        self.value = value

    async def scalar(self, statement: Any) -> object | None:
        return self.value


def test_require_setup_raises_when_self_hosted_setup_is_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(dify_config, "EDITION", "SELF_HOSTED")

    with pytest.raises(NotSetupError):
        require_setup(cast(Session, _SyncScalarSession(None)))


def test_require_setup_accepts_caller_owned_sync_session(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(dify_config, "EDITION", "SELF_HOSTED")

    require_setup(cast(Session, _SyncScalarSession(object())))


def test_require_setup_async_accepts_caller_owned_async_session(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(dify_config, "EDITION", "SELF_HOSTED")

    asyncio.run(require_setup_async(cast(AsyncSession, _AsyncScalarSession(object()))))


def test_require_setup_for_session_adapts_to_async_scalar(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(dify_config, "EDITION", "SELF_HOSTED")

    asyncio.run(require_setup_for_session(cast(AsyncSession, _AsyncScalarSession(object()))))
