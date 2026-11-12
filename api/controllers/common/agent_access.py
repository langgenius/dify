from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy.orm import Session

from services.agent.roster_service import AgentRosterService
from services.enterprise import rbac_service as enterprise_rbac_service
from services.entities.app_entities import AppListBaseParams
from services.rbac.agent_list_visibility import visible_agent_ids
from services.rbac.contracts import MyPermissionsResponse


@dataclass(frozen=True)
class AgentAccessFilter:
    """Resolved resource-level visibility for Agent list endpoints.

    ``accessible_agent_ids`` of ``None`` means every Agent is visible. An
    explicit set limits list queries to exactly those Agent resources.
    """

    accessible_agent_ids: set[str] | None

    @classmethod
    def unrestricted(cls) -> AgentAccessFilter:
        return cls(accessible_agent_ids=None)

    def apply_to_app_params(self, params: AppListBaseParams, *, tenant_id: str, session: Session) -> None:
        """Translate visible Agent ids to their Agent App ids before pagination."""
        if self.accessible_agent_ids is None:
            return
        if not self.accessible_agent_ids:
            params.accessible_app_ids = []
            return

        params.accessible_app_ids = AgentRosterService(session).load_app_ids_for_agents(
            tenant_id=tenant_id,
            agent_ids=sorted(self.accessible_agent_ids),
        )


def resolve_agent_access_filter(
    tenant_id: str,
    account_id: str,
    *,
    permissions: MyPermissionsResponse | None = None,
) -> AgentAccessFilter:
    """Compute Agent resources visible to an account in a workspace."""
    if permissions is None:
        permissions = enterprise_rbac_service.RBACService.MyPermissions.get(
            tenant_id,
            account_id,
        )
    whitelist_scope = enterprise_rbac_service.RBACService.AgentAccess.whitelist_resources(tenant_id, account_id)
    return AgentAccessFilter(accessible_agent_ids=visible_agent_ids(permissions, whitelist_scope))
