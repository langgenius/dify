"""Permission scenes preserve workspace and resource scope boundaries."""

from core.rbac import RBACPermission, RBACResourceScope


def test_agent_tag_management_checks_the_workspace_without_an_agent_id() -> None:
    """Given the tag-management scene, resolve workspace scope for pool-level checks."""
    assert RBACPermission.AGENT_TAG_MANAGE.value == "agent_tag_manage"
    assert RBACPermission.AGENT_TAG_MANAGE.scope is RBACResourceScope.WORKSPACE
    assert RBACPermission.AGENT_EDIT.scope is RBACResourceScope.AGENT
