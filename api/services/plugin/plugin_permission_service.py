from sqlalchemy import select
from sqlalchemy.orm import Session

from models.account import TenantPluginPermission


class PluginPermissionService:
    @staticmethod
    def get_permission(tenant_id: str, *, session: Session) -> TenantPluginPermission | None:
        return session.scalar(
            select(TenantPluginPermission).where(TenantPluginPermission.tenant_id == tenant_id).limit(1)
        )
