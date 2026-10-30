"""RBAC capability fields included in Console dataset responses."""

from extensions.ext_application_services import application_services
from machinery.context import RequestContext
from services.rbac.contracts import RBACResourceType


def get_dataset_permission_keys(context: RequestContext, dataset_id: str) -> list[str]:
    permissions = application_services().rbac.members.resource_permissions(
        context.active_workspace_id,
        context.account_id,
        RBACResourceType.DATASET,
        [dataset_id],
    )
    return permissions.get(dataset_id, [])
