"""SQLite-backed behavior of the workspace plugin permission repository."""

from typing import override
from uuid import uuid4

import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker

from enums.plugin_permission import TenantPluginDebugPermission, TenantPluginInstallPermission
from models.account import TenantPluginPermission
from repositories.plugin_permission_repository import SQLAlchemyPluginPermissionRepository
from services.plugin.plugin_permission_settings_service import PluginPermissionSettings

_ADMINS_EVERYONE = PluginPermissionSettings(
    install_permission=TenantPluginInstallPermission.ADMINS,
    debug_permission=TenantPluginDebugPermission.EVERYONE,
)
_EVERYONE_ADMINS = PluginPermissionSettings(
    install_permission=TenantPluginInstallPermission.EVERYONE,
    debug_permission=TenantPluginDebugPermission.ADMINS,
)


class _StaleMissingProbeRepository(SQLAlchemyPluginPermissionRepository):
    """Simulate a concurrent first write committed after this request's probe."""

    @staticmethod
    @override
    def _row_exists(session: Session, workspace_id: str) -> bool:
        return False


class _StalePresentProbeRepository(SQLAlchemyPluginPermissionRepository):
    """Simulate a row deleted concurrently after this request's probe."""

    @staticmethod
    @override
    def _row_exists(session: Session, workspace_id: str) -> bool:
        return True


def _rows(factory: sessionmaker[Session], workspace_id: str) -> list[tuple[str, str, str]]:
    with factory() as session:
        return [
            (row.id, row.install_permission, row.debug_permission)
            for row in session.scalars(
                select(TenantPluginPermission).where(TenantPluginPermission.tenant_id == workspace_id)
            )
        ]


def _store(factory: sessionmaker[Session], workspace_id: str, settings: PluginPermissionSettings) -> str:
    with factory.begin() as session:
        row = TenantPluginPermission(
            tenant_id=workspace_id,
            install_permission=settings.install_permission,
            debug_permission=settings.debug_permission,
        )
        session.add(row)
        session.flush()
        return row.id


def test_get_settings_returns_none_without_row(sqlite_session_factory: sessionmaker[Session]) -> None:
    repository = SQLAlchemyPluginPermissionRepository(session_factory=sqlite_session_factory)
    _store(sqlite_session_factory, str(uuid4()), _EVERYONE_ADMINS)

    assert repository.get_settings(str(uuid4())) is None


def test_save_settings_creates_row_and_preserves_other_workspace(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    repository = SQLAlchemyPluginPermissionRepository(session_factory=sqlite_session_factory)
    workspace_id, other_id = str(uuid4()), str(uuid4())
    other_row_id = _store(sqlite_session_factory, other_id, _ADMINS_EVERYONE)

    repository.save_settings(workspace_id, _EVERYONE_ADMINS)

    assert repository.get_settings(workspace_id) == _EVERYONE_ADMINS
    assert [(install, debug) for _, install, debug in _rows(sqlite_session_factory, workspace_id)] == [
        ("everyone", "admins")
    ]
    assert _rows(sqlite_session_factory, other_id) == [(other_row_id, "admins", "everyone")]


def test_save_settings_updates_existing_row_in_place(sqlite_session_factory: sessionmaker[Session]) -> None:
    repository = SQLAlchemyPluginPermissionRepository(session_factory=sqlite_session_factory)
    workspace_id = str(uuid4())
    row_id = _store(sqlite_session_factory, workspace_id, _ADMINS_EVERYONE)

    repository.save_settings(workspace_id, _EVERYONE_ADMINS)

    assert _rows(sqlite_session_factory, workspace_id) == [(row_id, "everyone", "admins")]


def test_save_settings_commit_is_visible_after_caller_rollback(sqlite_session: Session) -> None:
    factory = sessionmaker(bind=sqlite_session.get_bind(), expire_on_commit=False)
    repository = SQLAlchemyPluginPermissionRepository(session_factory=factory)
    workspace_id = str(uuid4())

    repository.save_settings(workspace_id, _EVERYONE_ADMINS)
    sqlite_session.rollback()

    stored = sqlite_session.scalar(
        select(TenantPluginPermission).where(TenantPluginPermission.tenant_id == workspace_id)
    )
    assert stored is not None
    assert (stored.install_permission, stored.debug_permission) == (
        TenantPluginInstallPermission.EVERYONE,
        TenantPluginDebugPermission.ADMINS,
    )


def test_save_unchanged_settings_preserves_single_row(sqlite_session_factory: sessionmaker[Session]) -> None:
    repository = SQLAlchemyPluginPermissionRepository(session_factory=sqlite_session_factory)
    workspace_id = str(uuid4())
    row_id = _store(sqlite_session_factory, workspace_id, _ADMINS_EVERYONE)

    repository.save_settings(workspace_id, _ADMINS_EVERYONE)

    assert _rows(sqlite_session_factory, workspace_id) == [(row_id, "admins", "everyone")]


def test_concurrent_first_write_replaces_committed_row(sqlite_session_factory: sessionmaker[Session]) -> None:
    repository = _StaleMissingProbeRepository(session_factory=sqlite_session_factory)
    workspace_id = str(uuid4())
    winner_id = _store(sqlite_session_factory, workspace_id, _ADMINS_EVERYONE)

    repository.save_settings(workspace_id, _EVERYONE_ADMINS)

    assert _rows(sqlite_session_factory, workspace_id) == [(winner_id, "everyone", "admins")]


def test_replace_of_vanished_row_fails_without_writing(sqlite_session_factory: sessionmaker[Session]) -> None:
    repository = _StalePresentProbeRepository(session_factory=sqlite_session_factory)
    workspace_id = str(uuid4())

    with pytest.raises(RuntimeError, match="disappeared"):
        repository.save_settings(workspace_id, _EVERYONE_ADMINS)

    with sqlite_session_factory() as session:
        count = session.scalar(
            select(func.count())
            .select_from(TenantPluginPermission)
            .where(TenantPluginPermission.tenant_id == workspace_id)
        )
    assert count == 0
