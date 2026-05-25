from configs import dify_config

from controllers.console.app.app import _collect_app_access_permission_keys
from services.enterprise import rbac_service as enterprise_rbac_service


def get_app_permission_keys(tenant_id: str, account_id: str | None, app_id: str) -> list[str]:
    if not dify_config.RBAC_ENABLED:
        return []

    app_access_matrix = enterprise_rbac_service.RBACService.AppAccess.matrix(
        tenant_id, account_id, app_id
    )
    return _collect_app_access_permission_keys(app_access_matrix)
