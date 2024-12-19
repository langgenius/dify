from flask_login import current_user

from configs import dify_config
from extensions.ext_database import db
from models.account import Tenant, TenantAccountJoin, TenantAccountJoinRole
from services.account_service import TenantService
from services.feature_service import FeatureService


class WorkspaceService:
    @classmethod
    def get_tenant_info(cls, tenant: Tenant):
        if not tenant:
            return None
        tenant_info = {
            "id": tenant.id,
            "name": tenant.name,
            "plan": tenant.plan,
            "status": tenant.status,
            "created_at": tenant.created_at,
            "in_trail": True,
            "trial_end_reason": None,
            "role": "normal",
        }

        # Get role of user
        tenant_account_join = (
            db.session.query(TenantAccountJoin)
            .filter(TenantAccountJoin.tenant_id == tenant.id, TenantAccountJoin.account_id == current_user.id)
            .first()
        )
        tenant_info["role"] = tenant_account_join.role

        can_replace_logo = FeatureService.get_features(tenant_info["id"]).can_replace_logo

        if can_replace_logo and TenantService.has_roles(
            tenant, [TenantAccountJoinRole.OWNER, TenantAccountJoinRole.ADMIN]
        ):
            base_url = dify_config.FILES_URL
            replace_webapp_logo = (
                f"{base_url}/files/workspaces/{tenant.id}/webapp-logo"
                if tenant.custom_config_dict.get("replace_webapp_logo")
                else None
            )
            remove_webapp_brand = tenant.custom_config_dict.get("remove_webapp_brand", False)

            tenant_info["custom_config"] = {
                "remove_webapp_brand": remove_webapp_brand,
                "replace_webapp_logo": replace_webapp_logo,
            }

        return tenant_info
