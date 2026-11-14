"""Unit tests for Agent resource-list RBAC filtering."""

from __future__ import annotations

from services.rbac.agent_list_visibility import AGENT_LIST_PERMISSION_KEYS, has_agent_list_permission, visible_agent_ids
from services.rbac.contracts import (
    MyPermissionsResponse,
    ResourcePermissionKeys,
    ResourcePermissionSnapshot,
    ResourceWhitelistResources,
    WorkspacePermissionSnapshot,
)


def _permissions(
    *,
    workspace_keys: list[str] | None = None,
    agent_default_keys: list[str] | None = None,
    agent_overrides: list[ResourcePermissionKeys] | None = None,
) -> MyPermissionsResponse:
    return MyPermissionsResponse(
        workspace=WorkspacePermissionSnapshot(permission_keys=workspace_keys or []),
        agent=ResourcePermissionSnapshot(
            default_permission_keys=agent_default_keys or [],
            overrides=agent_overrides or [],
        ),
    )


class TestHasAgentListPermission:
    def test_matches_preview_permission(self) -> None:
        for key in AGENT_LIST_PERMISSION_KEYS:
            assert has_agent_list_permission([key])

    def test_rejects_non_preview_permissions(self) -> None:
        assert not has_agent_list_permission(["agent.acl.edit", "agent.acl.delete"])
        assert not has_agent_list_permission([])


def test_visible_agent_ids_preserves_preview_and_whitelist_rules() -> None:
    default_preview = _permissions(agent_default_keys=["agent.acl.preview"])
    unrestricted = ResourceWhitelistResources(unrestricted=True)
    assert visible_agent_ids(default_preview, unrestricted) is None
    overrides = _permissions(
        agent_overrides=[
            ResourcePermissionKeys(resource_id="visible", permission_keys=["agent.acl.preview"]),
            ResourcePermissionKeys(resource_id="hidden", permission_keys=["agent.acl.edit"]),
        ]
    )
    assert visible_agent_ids(overrides, unrestricted) == {"visible"}
    restricted = ResourceWhitelistResources(unrestricted=False, resource_ids=["whitelisted"])
    assert visible_agent_ids(overrides, restricted) == {"whitelisted"}
