from sqlalchemy import select

from core.db.session_factory import session_factory
from models.account import TenantPluginPermission


class PluginPermissionService:
    @staticmethod
    def get_permission(tenant_id: str) -> TenantPluginPermission | None:
        with session_factory.create_session() as session:
            return session.scalar(
                select(TenantPluginPermission).where(TenantPluginPermission.tenant_id == tenant_id).limit(1)
            )

    @staticmethod
    def change_permission(
        tenant_id: str,
        install_permission: TenantPluginPermission.InstallPermission,
        debug_permission: TenantPluginPermission.DebugPermission,
    ):
        with session_factory.create_session() as session, session.begin():
            permission = session.scalar(
                select(TenantPluginPermission).where(TenantPluginPermission.tenant_id == tenant_id).limit(1)
            )
            if not permission:
                permission = TenantPluginPermission(
                    tenant_id=tenant_id, install_permission=install_permission, debug_permission=debug_permission
                )

                session.add(permission)
            else:
                permission.install_permission = install_permission
                permission.debug_permission = debug_permission

            return True
