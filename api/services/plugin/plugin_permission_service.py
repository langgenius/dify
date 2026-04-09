from sqlalchemy import select
from sqlalchemy.orm import sessionmaker

from extensions.ext_database import db
from models.account import TenantPluginPermission


class PluginPermissionService:
    @staticmethod
    def get_permission(tenant_id: str) -> TenantPluginPermission | None:
        with sessionmaker(bind=db.engine).begin() as session:
            return session.scalar(
                select(TenantPluginPermission).where(TenantPluginPermission.tenant_id == tenant_id).limit(1)
            )

    @staticmethod
    def change_permission(
        tenant_id: str,
        install_permission: TenantPluginPermission.InstallPermission,
        debug_permission: TenantPluginPermission.DebugPermission,
    ):
        with sessionmaker(bind=db.engine).begin() as session:
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
