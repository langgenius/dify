"""Resolve Agent list visibility with the workspace RBAC service."""

from configs import dify_config
from machinery.context import RequestContext
from services.enterprise import rbac_service
from services.rbac.agent_list_visibility import visible_agent_ids
from services.rbac.contracts import ResourcePermissionSnapshot
from services.rbac.members import MemberService


class AgentListVisibilityGateway:
    """Resolve a caller's Agent permissions outside the list query session."""

    def __init__(self, *, members: MemberService) -> None:
        self._members = members

    def permissions(self, context: RequestContext) -> tuple[set[str] | None, ResourcePermissionSnapshot]:
        """Return the list visibility boundary and Agent permissions for the caller."""
        permissions = self._members.permissions(context.active_workspace_id, context.account_id)
        if not dify_config.RBAC_ENABLED:
            return None, permissions.agent
        whitelist = rbac_service.RBACService.AgentAccess.whitelist_resources(
            context.active_workspace_id, context.account_id
        )
        return visible_agent_ids(permissions, whitelist), permissions.agent

    def visible_ids(self, context: RequestContext) -> set[str] | None:
        """Return the visibility boundary, skipping permission queries when RBAC is disabled."""
        return self.permissions(context)[0] if dify_config.RBAC_ENABLED else None
