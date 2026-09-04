"""RBAC access bootstrap for newly created agents.

A fresh agent needs three things or nobody but the workspace owner can see it: a
whitelist scope that auto-includes workspace members, those members seeded with the
default access policy, and the creator's own access policy binding.
"""

import logging

from configs import dify_config
from services.enterprise import rbac_service as enterprise_rbac_service
from tasks.initialize_created_app_rbac_access_task import initialize_created_app_rbac_access_task

logger = logging.getLogger(__name__)


def initialize_agent_rbac_access(*, tenant_id: str, agent_id: str, creator_account_id: str) -> None:
    """Grant default RBAC access on a newly created agent.

    Best-effort: agent creation must not fail because the RBAC service is unavailable.
    """
    if not dify_config.RBAC_ENABLED:
        return

    try:
        # The scope row is written last so a failure before it leaves the agent unconfigured,
        # which is what the bootstrap migration looks for when it repairs an agent.
        initialize_created_app_rbac_access_task.delay(tenant_id, creator_account_id, agent_id=agent_id)
        enterprise_rbac_service.RBACService.AccessPolicies.sync_creator_access_policy_member_bindings(
            tenant_id,
            creator_account_id,
            resource_type=enterprise_rbac_service.RBACResourceType.AGENT,
            resource_id=agent_id,
        )
        enterprise_rbac_service.RBACService.AgentAccess.replace_whitelist(
            tenant_id,
            creator_account_id,
            agent_id,
            enterprise_rbac_service.ReplaceMemberBindings(automatic_include_workspace_members=True),
        )
    except Exception:
        logger.warning(
            "Failed to initialize RBAC access for agent: tenant_id=%s agent_id=%s account_id=%s",
            tenant_id,
            agent_id,
            creator_account_id,
            exc_info=True,
        )
