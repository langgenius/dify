"""SQLAlchemy persistence adapter for workspace plugin permission settings."""

from typing import override

from sqlalchemy import CursorResult, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker

from models.account import TenantPluginPermission
from services.plugin.plugin_permission_settings_service import (
    PluginPermissionSettings,
    PluginPermissionSettingsStore,
)


class SQLAlchemyPluginPermissionRepository(PluginPermissionSettingsStore):
    """Store one ``account_plugin_permissions`` row per workspace.

    Every statement filters by ``tenant_id``. Rows become immutable records before
    the session closes. The existence probe is a plain read, not a locking read, so
    a missing MySQL unique key takes no gap lock before the insert.
    """

    def __init__(self, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

    @override
    def get_settings(self, workspace_id: str) -> PluginPermissionSettings | None:
        """Read the workspace row in a short session; ``None`` when absent."""
        stmt = (
            select(TenantPluginPermission.install_permission, TenantPluginPermission.debug_permission)
            .where(TenantPluginPermission.tenant_id == workspace_id)
            .limit(1)
        )
        with self._session_factory() as session:
            row = session.execute(stmt).one_or_none()
        if row is None:
            return None
        return PluginPermissionSettings(install_permission=row[0], debug_permission=row[1])

    @override
    def save_settings(self, workspace_id: str, settings: PluginPermissionSettings) -> None:
        """Insert or replace the workspace row and commit.

        Postconditions: on return exactly one committed row for ``workspace_id``
        holds ``settings``. On failure the session is rolled back and closed, and
        the stored row is unchanged.
        Raises ``RuntimeError`` when a probed row disappears before its update.
        """
        with self._session_factory() as session:
            if self._row_exists(session, workspace_id):
                self._replace(session, workspace_id, settings)
            else:
                self._insert_or_replace(session, workspace_id, settings)

    def _insert_or_replace(self, session: Session, workspace_id: str, settings: PluginPermissionSettings) -> None:
        session.add(
            TenantPluginPermission(
                tenant_id=workspace_id,
                install_permission=settings.install_permission,
                debug_permission=settings.debug_permission,
            )
        )
        try:
            session.commit()
        except IntegrityError:
            # unique_tenant_plugin: a concurrent first write committed this
            # workspace's row after the probe. Replace it; the last write wins.
            session.rollback()
            if not self._update(session, workspace_id, settings):
                raise
            session.commit()

    def _replace(self, session: Session, workspace_id: str, settings: PluginPermissionSettings) -> None:
        if not self._update(session, workspace_id, settings):
            session.rollback()
            raise RuntimeError("Plugin permission settings disappeared before they could be replaced")
        session.commit()

    @staticmethod
    def _update(session: Session, workspace_id: str, settings: PluginPermissionSettings) -> bool:
        """Overwrite the workspace row in the open transaction; ``False`` when absent."""
        result = session.execute(
            update(TenantPluginPermission)
            .where(TenantPluginPermission.tenant_id == workspace_id)
            .values(
                install_permission=settings.install_permission,
                debug_permission=settings.debug_permission,
            )
            .execution_options(synchronize_session=False)
        )
        if not isinstance(result, CursorResult):
            raise RuntimeError("Plugin permission update did not return a row count")
        return result.rowcount == 1

    @staticmethod
    def _row_exists(session: Session, workspace_id: str) -> bool:
        stmt = select(TenantPluginPermission.id).where(TenantPluginPermission.tenant_id == workspace_id).limit(1)
        return session.scalar(stmt) is not None
