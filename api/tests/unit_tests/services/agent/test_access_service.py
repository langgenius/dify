"""Builder Agent visibility resolves main's shared Agent list-visibility policy.

Moved from ``tests/unit_tests/controllers/common/test_agent_access.py`` when main deleted
``controllers.common.agent_access``. The permission-key and whitelist policy itself is
covered by ``tests/unit_tests/services/rbac/test_agent_list_visibility.py``.
"""

from __future__ import annotations

import pytest

from services.agent import access_service
from services.agent.access_service import (
    AGENT_LIST_PERMISSION_KEYS,
    AgentAccessFilter,
    has_agent_list_permission,
    resolve_agent_access_filter,
    resolve_current_agent_access_filter,
)
from services.rbac import agent_list_visibility
from services.rbac.contracts import (
    MyPermissionsResponse,
    ResourcePermissionKeys,
    ResourcePermissionSnapshot,
    ResourceWhitelistResources,
    WorkspacePermissionSnapshot,
)

_RBAC_MODULE = "services.agent.access_service.enterprise_rbac_service"


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


def test_policy_names_are_the_shared_rbac_policy() -> None:
    assert AGENT_LIST_PERMISSION_KEYS is agent_list_visibility.AGENT_LIST_PERMISSION_KEYS
    assert has_agent_list_permission is agent_list_visibility.has_agent_list_permission


def test_unrestricted_filter_has_no_agent_id_boundary() -> None:
    assert AgentAccessFilter.unrestricted().accessible_agent_ids is None


class TestResolveAgentAccessFilter:
    def _patch_whitelist(self, monkeypatch: pytest.MonkeyPatch, whitelist: ResourceWhitelistResources) -> None:
        monkeypatch.setattr(
            f"{_RBAC_MODULE}.RBACService.AgentAccess.whitelist_resources",
            lambda _tenant_id, _account_id: whitelist,
        )

    def test_default_preview_is_unrestricted(self, monkeypatch: pytest.MonkeyPatch) -> None:
        self._patch_whitelist(monkeypatch, ResourceWhitelistResources(unrestricted=True))

        access_filter = resolve_agent_access_filter(
            "tenant-1",
            "account-1",
            permissions=_permissions(agent_default_keys=["agent.acl.preview"]),
        )

        assert access_filter.accessible_agent_ids is None

    def test_collects_preview_overrides_without_default_preview(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        self._patch_whitelist(monkeypatch, ResourceWhitelistResources(unrestricted=True))

        access_filter = resolve_agent_access_filter(
            "tenant-1",
            "account-1",
            permissions=_permissions(
                agent_overrides=[
                    ResourcePermissionKeys(
                        resource_id="agent-1",
                        permission_keys=["agent.acl.preview"],
                    ),
                    ResourcePermissionKeys(
                        resource_id="agent-2",
                        permission_keys=["agent.acl.edit"],
                    ),
                ]
            ),
        )

        assert access_filter.accessible_agent_ids == {"agent-1"}

    def test_restricted_whitelist_is_the_visibility_boundary(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        self._patch_whitelist(
            monkeypatch,
            ResourceWhitelistResources(unrestricted=False, resource_ids=["agent-9"]),
        )

        access_filter = resolve_agent_access_filter(
            "tenant-1",
            "account-1",
            permissions=_permissions(workspace_keys=["agent.acl.preview"]),
        )

        assert access_filter.accessible_agent_ids == {"agent-9"}

    def test_fetches_fresh_permissions_when_none_are_supplied(self, monkeypatch: pytest.MonkeyPatch) -> None:
        self._patch_whitelist(monkeypatch, ResourceWhitelistResources(unrestricted=True))
        calls: list[tuple[str, str]] = []

        def my_permissions(tenant_id: str, account_id: str) -> MyPermissionsResponse:
            calls.append((tenant_id, account_id))
            return _permissions()

        monkeypatch.setattr(f"{_RBAC_MODULE}.RBACService.MyPermissions.get", my_permissions)

        access_filter = resolve_agent_access_filter("tenant-1", "account-1")

        assert calls == [("tenant-1", "account-1")]
        assert access_filter.accessible_agent_ids == set()


def test_current_filter_is_unrestricted_when_rbac_is_disabled(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("configs.dify_config.RBAC_ENABLED", False)

    def unexpected(*_args: object, **_kwargs: object) -> AgentAccessFilter:
        pytest.fail("RBAC must not be consulted while it is disabled")

    monkeypatch.setattr(access_service, "resolve_agent_access_filter", unexpected)

    assert resolve_current_agent_access_filter(tenant_id="tenant-1", actor_id="account-1").accessible_agent_ids is None
