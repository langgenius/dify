"""Agent visibility for Builder callers.

The list-visibility policy itself is owned by ``services.rbac.agent_list_visibility``;
this module resolves it for one actor and adds the Builder-only identity recheck.
"""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy.orm import Session

from services.enterprise import rbac_service as enterprise_rbac_service
from services.rbac.agent_list_visibility import (
    AGENT_LIST_PERMISSION_KEYS,
    has_agent_list_permission,
    visible_agent_ids,
)
from services.rbac.contracts import MyPermissionsResponse

__all__ = [
    "AGENT_LIST_PERMISSION_KEYS",
    "AgentAccessFilter",
    "has_agent_list_permission",
    "require_builder_agent_access",
    "resolve_agent_access_filter",
    "resolve_current_agent_access_filter",
]


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


def resolve_current_agent_access_filter(*, tenant_id: str, actor_id: str) -> AgentAccessFilter:
    """Resolve fresh RBAC visibility; no actor-supplied permission facts are trusted."""
    from configs import dify_config

    if not dify_config.RBAC_ENABLED:
        return AgentAccessFilter.unrestricted()
    return resolve_agent_access_filter(tenant_id, actor_id)


def require_builder_agent_access(*, session: Session, tenant_id: str, actor_id: str, app_id: str | None) -> None:
    """Recheck local identity and app ownership; remote RBAC is checked before locks."""
    from sqlalchemy import select

    from configs import dify_config
    from models.account import Account, AccountStatus, Tenant, TenantAccountJoin, TenantAccountRole, TenantStatus
    from models.model import App
    from runtime_contracts.builder.execution import BuilderExecutionPolicyError

    account = session.get(Account, actor_id, populate_existing=True)
    tenant = session.get(Tenant, tenant_id, populate_existing=True)
    membership = session.scalar(
        select(TenantAccountJoin)
        .where(TenantAccountJoin.tenant_id == tenant_id, TenantAccountJoin.account_id == actor_id)
        .execution_options(populate_existing=True)
    )
    if (
        account is None
        or account.status != AccountStatus.ACTIVE
        or tenant is None
        or tenant.status != TenantStatus.NORMAL
        or membership is None
    ):
        raise BuilderExecutionPolicyError("agent_access_denied")
    if not dify_config.RBAC_ENABLED and not TenantAccountRole.is_editing_role(membership.role):
        raise BuilderExecutionPolicyError("agent_access_denied")
    if (
        app_id is not None
        and session.scalar(select(App.id).where(App.id == app_id, App.tenant_id == tenant_id, App.status == "normal"))
        is None
    ):
        raise BuilderExecutionPolicyError("agent_access_denied")
