from flask_login import current_user

from configs import dify_config
from extensions.ext_database import db
from models.account import Tenant, TenantAccountJoin, TenantAccountRole
from services.account_service import TenantService
from services.feature_service import FeatureService


class WorkspaceService:
    @classmethod
    def get_tenant_info(cls, tenant: Tenant):
        if not tenant:
            return None
        tenant_info: dict[str, object] = {
            "id": tenant.id,
            "name": tenant.name,
            "plan": tenant.plan,
            "status": tenant.status,
            "created_at": tenant.created_at,
            "trial_end_reason": None,
            "role": "normal",
        }

        # Get role of user
        tenant_account_join = (
            db.session.query(TenantAccountJoin)
            .where(TenantAccountJoin.tenant_id == tenant.id, TenantAccountJoin.account_id == current_user.id)
            .first()
        )
        assert tenant_account_join is not None, "TenantAccountJoin not found"
        tenant_info["role"] = tenant_account_join.role

        feature = FeatureService.get_features(tenant.id)
        can_replace_logo = feature.can_replace_logo

        if can_replace_logo and TenantService.has_roles(tenant, [TenantAccountRole.OWNER, TenantAccountRole.ADMIN]):
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
        if dify_config.EDITION == "CLOUD":
            tenant_info["next_credit_reset_date"] = feature.next_credit_reset_date

            from services.credit_pool_service import CreditPoolService

            paid_pool = CreditPoolService.get_pool(tenant_id=tenant.id, pool_type="paid")
            if paid_pool:
                tenant_info["trial_credits"] = paid_pool.quota_limit
                tenant_info["trial_credits_used"] = paid_pool.quota_used
            else:
                trial_pool = CreditPoolService.get_pool(tenant_id=tenant.id, pool_type="trial")
                if trial_pool:
                    tenant_info["trial_credits"] = trial_pool.quota_limit
                    tenant_info["trial_credits_used"] = trial_pool.quota_used

        return tenant_info
