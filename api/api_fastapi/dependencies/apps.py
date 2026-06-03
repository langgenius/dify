"""App row injection dependencies for API v2 console routes."""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any
from uuid import UUID

from fastapi import Depends
from sqlalchemy import select

from api_fastapi.dependencies.auth import CurrentAccountDep, EditorAccountDep
from api_fastapi.dependencies.infra import SyncSessionDep
from api_fastapi.dependencies.setup import SetupDep
from api_fastapi.exceptions import AppNotFoundError
from models import App
from models.model import AppMode


def app_model_dependency(*, modes: AppMode | Sequence[AppMode] | None = None) -> Any:
    """Build a tenant-scoped app dependency for routes with an ``app_id`` path parameter."""

    allowed_modes = _normalize_modes(modes)

    def dependency(
        app_id: UUID,
        session: SyncSessionDep,
        current_account: CurrentAccountDep,
        _setup: SetupDep,
    ) -> App:
        del _setup
        return _load_app_model(
            session=session,
            app_id=str(app_id),
            tenant_id=current_account.tenant_id,
            modes=allowed_modes,
        )

    return Depends(dependency)


def editable_app_model_dependency(*, modes: AppMode | Sequence[AppMode] | None = None) -> Any:
    """Build a tenant-scoped app dependency for routes that require editing access."""

    allowed_modes = _normalize_modes(modes)

    def dependency(
        app_id: UUID,
        session: SyncSessionDep,
        current_account: EditorAccountDep,
        _setup: SetupDep,
    ) -> App:
        del _setup
        return _load_app_model(
            session=session,
            app_id=str(app_id),
            tenant_id=current_account.tenant_id,
            modes=allowed_modes,
        )

    return Depends(dependency)


def _load_app_model(
    *,
    session: SyncSessionDep,
    app_id: str,
    tenant_id: str,
    modes: tuple[AppMode, ...] | None,
) -> App:
    stmt = select(App).where(App.id == app_id, App.tenant_id == tenant_id, App.status == "normal").limit(1)
    app_model = session.scalar(stmt)
    if app_model is None:
        raise AppNotFoundError()

    app_mode = AppMode.value_of(app_model.mode)
    if modes is not None and app_mode not in modes:
        mode_values = {mode.value for mode in modes}
        raise AppNotFoundError(f"App mode is not in the supported list: {mode_values}")

    return app_model


def _normalize_modes(modes: AppMode | Sequence[AppMode] | None) -> tuple[AppMode, ...] | None:
    if modes is None:
        return None
    if isinstance(modes, AppMode):
        return (modes,)
    return tuple(modes)
