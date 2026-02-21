from models.account import TenantPluginPermission


class PluginPermissionService:
    @staticmethod
    def get_permission(tenant_id: str) -> TenantPluginPermission | None:
        with SessionLocal.begin() as session:
            return session.query(TenantPluginPermission).where(TenantPluginPermission.tenant_id == tenant_id).first()

    @staticmethod
    def change_permission(
        tenant_id: str,
        install_permission: TenantPluginPermission.InstallPermission,
        debug_permission: TenantPluginPermission.DebugPermission,
    ):
        with SessionLocal.begin() as session:
            permission = (
                session.query(TenantPluginPermission).where(TenantPluginPermission.tenant_id == tenant_id).first()
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
