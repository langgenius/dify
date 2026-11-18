"""Shared policy for Agent visibility in resource lists."""

from collections.abc import Sequence

from services.rbac.contracts import MyPermissionsResponse, ResourceWhitelistResources

AGENT_LIST_PERMISSION_KEYS: frozenset[str] = frozenset({"agent.acl.preview"})


def has_agent_list_permission(permission_keys: Sequence[str]) -> bool:
    """Return whether a permission set admits an Agent to resource lists."""
    return any(permission_key in AGENT_LIST_PERMISSION_KEYS for permission_key in permission_keys)


def visible_agent_ids(permissions: MyPermissionsResponse, whitelist: ResourceWhitelistResources) -> set[str] | None:
    """Resolve the established whitelist and preview permission policy; None means unrestricted."""
    has_default_preview = has_agent_list_permission(
        permissions.agent.default_permission_keys
    ) or has_agent_list_permission(permissions.workspace.permission_keys)
    permission_agent_ids = (
        None
        if has_default_preview
        else {
            override.resource_id
            for override in permissions.agent.overrides
            if has_agent_list_permission(override.permission_keys)
        }
    )
    return permission_agent_ids if whitelist.unrestricted else set(whitelist.resource_ids)
