from extensions.ext_database import db
from services.enterprise import rbac_service as enterprise_rbac_service


def get_app_permission_keys(tenant_id: str, account_id: str | None, app_id: str) -> list[str]:
    permission_keys_map = enterprise_rbac_service.RBACService.AppPermissions.batch_get(
        tenant_id, account_id, [app_id], session=db.session()
    )
    return permission_keys_map.get(app_id, [])
