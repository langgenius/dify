from extensions.ext_application_services import application_services
from services.rbac.contracts import RBACResourceType


def get_app_permission_keys(tenant_id: str, account_id: str | None, app_id: str) -> list[str]:
    permission_keys_map = application_services().rbac.members.resource_permissions(
        tenant_id, account_id, RBACResourceType.APP, [app_id]
    )
    return permission_keys_map.get(app_id, [])
