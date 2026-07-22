from __future__ import annotations

from uuid import uuid4

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from models.account import TenantPluginDebugPermission, TenantPluginInstallPermission, TenantPluginPermission
from services.plugin.plugin_permission_service import PluginPermissionService


def _tenant_id() -> str:
    return str(uuid4())


def _get_permission(session: Session, tenant_id: str) -> TenantPluginPermission | None:
    session.expire_all()
    stmt = select(TenantPluginPermission).where(TenantPluginPermission.tenant_id == tenant_id)
    return session.scalars(stmt).one_or_none()


def _count_permissions(session: Session, tenant_id: str) -> int:
    stmt = select(func.count()).select_from(TenantPluginPermission).where(TenantPluginPermission.tenant_id == tenant_id)
    return session.scalar(stmt) or 0


class TestGetPermission:
    """Integration tests for PluginPermissionService.get_permission using testcontainers."""

    def test_returns_permission_when_found(self, container_session: Session) -> None:
        tenant_id = _tenant_id()
        permission = TenantPluginPermission(
            tenant_id=tenant_id,
            install_permission=TenantPluginInstallPermission.ADMINS,
            debug_permission=TenantPluginDebugPermission.EVERYONE,
        )
        container_session.add(permission)
        container_session.commit()

        result = PluginPermissionService.get_permission(tenant_id, session=container_session)

        assert result is not None
        assert result.id == permission.id
        assert result.tenant_id == tenant_id
        assert result.install_permission == TenantPluginInstallPermission.ADMINS
        assert result.debug_permission == TenantPluginDebugPermission.EVERYONE

    def test_returns_none_when_not_found(self, container_session: Session) -> None:
        result = PluginPermissionService.get_permission(_tenant_id(), session=container_session)

        assert result is None


class TestChangePermission:
    """Integration tests for PluginPermissionService.change_permission using testcontainers."""

    def test_creates_new_permission_when_not_exists(self, container_session: Session) -> None:
        tenant_id = _tenant_id()

        result = PluginPermissionService.change_permission(
            tenant_id,
            TenantPluginInstallPermission.EVERYONE,
            TenantPluginDebugPermission.EVERYONE,
            session=container_session,
        )

        permission = _get_permission(container_session, tenant_id)
        assert result is True
        assert permission is not None
        assert permission.install_permission == TenantPluginInstallPermission.EVERYONE
        assert permission.debug_permission == TenantPluginDebugPermission.EVERYONE

    def test_updates_existing_permission(self, container_session: Session) -> None:
        tenant_id = _tenant_id()
        existing = TenantPluginPermission(
            tenant_id=tenant_id,
            install_permission=TenantPluginInstallPermission.EVERYONE,
            debug_permission=TenantPluginDebugPermission.EVERYONE,
        )
        container_session.add(existing)
        container_session.commit()

        result = PluginPermissionService.change_permission(
            tenant_id,
            TenantPluginInstallPermission.ADMINS,
            TenantPluginDebugPermission.ADMINS,
            session=container_session,
        )

        permission = _get_permission(container_session, tenant_id)
        assert result is True
        assert permission is not None
        assert permission.id == existing.id
        assert permission.install_permission == TenantPluginInstallPermission.ADMINS
        assert permission.debug_permission == TenantPluginDebugPermission.ADMINS
        assert _count_permissions(container_session, tenant_id) == 1
