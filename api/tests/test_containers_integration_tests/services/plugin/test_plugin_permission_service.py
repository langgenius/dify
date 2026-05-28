from __future__ import annotations

from uuid import uuid4

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from models.account import TenantPluginPermission
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

    def test_returns_permission_when_found(self, db_session_with_containers: Session):
        tenant_id = _tenant_id()
        permission = TenantPluginPermission(
            tenant_id=tenant_id,
            install_permission=TenantPluginPermission.InstallPermission.ADMINS,
            debug_permission=TenantPluginPermission.DebugPermission.EVERYONE,
        )
        db_session_with_containers.add(permission)
        db_session_with_containers.commit()

        result = PluginPermissionService.get_permission(tenant_id)

        assert result is not None
        assert result.id == permission.id
        assert result.tenant_id == tenant_id
        assert result.install_permission == TenantPluginPermission.InstallPermission.ADMINS
        assert result.debug_permission == TenantPluginPermission.DebugPermission.EVERYONE

    def test_returns_none_when_not_found(self, db_session_with_containers: Session):
        result = PluginPermissionService.get_permission(_tenant_id())

        assert result is None


class TestChangePermission:
    """Integration tests for PluginPermissionService.change_permission using testcontainers."""

    def test_creates_new_permission_when_not_exists(self, db_session_with_containers: Session):
        tenant_id = _tenant_id()

        result = PluginPermissionService.change_permission(
            tenant_id,
            TenantPluginPermission.InstallPermission.EVERYONE,
            TenantPluginPermission.DebugPermission.EVERYONE,
        )

        permission = _get_permission(db_session_with_containers, tenant_id)
        assert result is True
        assert permission is not None
        assert permission.install_permission == TenantPluginPermission.InstallPermission.EVERYONE
        assert permission.debug_permission == TenantPluginPermission.DebugPermission.EVERYONE

    def test_updates_existing_permission(self, db_session_with_containers: Session):
        tenant_id = _tenant_id()
        existing = TenantPluginPermission(
            tenant_id=tenant_id,
            install_permission=TenantPluginPermission.InstallPermission.EVERYONE,
            debug_permission=TenantPluginPermission.DebugPermission.EVERYONE,
        )
        db_session_with_containers.add(existing)
        db_session_with_containers.commit()

        result = PluginPermissionService.change_permission(
            tenant_id,
            TenantPluginPermission.InstallPermission.ADMINS,
            TenantPluginPermission.DebugPermission.ADMINS,
        )

        permission = _get_permission(db_session_with_containers, tenant_id)
        assert result is True
        assert permission is not None
        assert permission.id == existing.id
        assert permission.install_permission == TenantPluginPermission.InstallPermission.ADMINS
        assert permission.debug_permission == TenantPluginPermission.DebugPermission.ADMINS
        assert _count_permissions(db_session_with_containers, tenant_id) == 1
