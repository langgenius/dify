"""Use the existing effective App-edit policy for External rebind admission."""

from core.rbac import RBACPermission, RBACResourceScope
from machinery.context import RequestContext
from services.enterprise.rbac_service import RBACService
from services.external_agents.contracts import ExternalAgentForbiddenError


class ExternalWorkflowBindingAccess:
    def require_edit(self, context: RequestContext, app_id: str) -> None:
        if context.resource_app_ids is not None and app_id not in context.resource_app_ids:
            raise ExternalAgentForbiddenError("The workflow application is not accessible.")
        if not RBACService.CheckAccess.check(
            context.active_workspace_id,
            context.account_id,
            scene=RBACPermission.APP_EDIT,
            resource_type=RBACResourceScope.APP,
            resource_id=app_id,
        ):
            raise ExternalAgentForbiddenError("Effective application edit permission is required.")
