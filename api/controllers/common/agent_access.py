from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import TYPE_CHECKING

from sqlalchemy import select
from sqlalchemy.orm import Session

from models.agent import APP_BACKED_AGENT_SOURCES, Agent, AgentScope, AgentStatus
from services.enterprise import rbac_service as enterprise_rbac_service

if TYPE_CHECKING:
    from services.app_service import AppListBaseParams
    from services.enterprise.rbac_service import MyPermissionsResponse


AGENT_LIST_PERMISSION_KEYS: frozenset[str] = frozenset({"agent.acl.preview"})


def has_agent_list_permission(permission_keys: Sequence[str]) -> bool:
    """Return whether the permission set makes an Agent visible in resource lists."""
    return any(permission_key in AGENT_LIST_PERMISSION_KEYS for permission_key in permission_keys)


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

        app_ids = session.scalars(
            select(Agent.app_id).where(
                Agent.tenant_id == tenant_id,
                Agent.id.in_(self.accessible_agent_ids),
                Agent.app_id.is_not(None),
                Agent.scope == AgentScope.ROSTER,
                Agent.source.in_(APP_BACKED_AGENT_SOURCES),
                Agent.status == AgentStatus.ACTIVE,
            )
        ).all()
        params.accessible_app_ids = sorted({str(app_id) for app_id in app_ids if app_id})


def resolve_agent_access_filter(
    tenant_id: str,
    account_id: str,
    *,
    session: Session,
    permissions: MyPermissionsResponse | None = None,
) -> AgentAccessFilter:
    """Compute Agent resources visible to an account in a workspace."""
    if permissions is None:
        permissions = enterprise_rbac_service.RBACService.MyPermissions.get(
            tenant_id,
            account_id,
            session=session,
        )
    whitelist_scope = enterprise_rbac_service.RBACService.AgentAccess.whitelist_resources(tenant_id, account_id)
    has_default_preview = has_agent_list_permission(
        permissions.agent.default_permission_keys
    ) or has_agent_list_permission(permissions.workspace.permission_keys)

    permission_agent_ids: set[str] | None = None
    if not has_default_preview:
        permission_agent_ids = {
            override.resource_id
            for override in permissions.agent.overrides
            if has_agent_list_permission(override.permission_keys)
        }

    if getattr(whitelist_scope, "unrestricted", False):
        accessible_agent_ids = permission_agent_ids
    else:
        accessible_agent_ids = set(whitelist_scope.resource_ids)

    return AgentAccessFilter(accessible_agent_ids=accessible_agent_ids)
