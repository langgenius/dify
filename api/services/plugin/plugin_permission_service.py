from sqlalchemy import select
from sqlalchemy.orm import Session

from extensions.ext_database import db
from models.account import TenantPluginPermission


class PluginPermissionService:
    @staticmethod
    def get_permission(tenant_id: str) -> TenantPluginPermission | None:
        with Session(db.engine) as session:
            return session.scalars(
                select(TenantPluginPermission).where(TenantPluginPermission.tenant_id == tenant_id).limit(1)
            ).first()

    @staticmethod
    def change_permission(
        tenant_id: str,
        install_permission: TenantPluginPermission.InstallPermission,
        debug_permission: TenantPluginPermission.DebugPermission,
    ):
        with Session(db.engine) as session:
            permission = session.scalars(
                select(TenantPluginPermission).where(TenantPluginPermission.tenant_id == tenant_id).limit(1)
            ).first()
            if not permission:
                permission = TenantPluginPermission(
                    tenant_id=tenant_id, install_permission=install_permission, debug_permission=debug_permission
                )

                session.add(permission)
            else:
                permission.install_permission = install_permission
                permission.debug_permission = debug_permission

            session.commit()
            return True
