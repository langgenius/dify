"""Unit tests for Agent resource-list RBAC filtering."""

from __future__ import annotations

import pytest
from sqlalchemy.orm import Session

from controllers.common.agent_access import (
    AGENT_LIST_PERMISSION_KEYS,
    AgentAccessFilter,
    has_agent_list_permission,
    resolve_agent_access_filter,
)
from models.agent import Agent, AgentKind, AgentScope, AgentSource, AgentStatus
from services.app_service import AppListParams
from services.enterprise.rbac_service import (
    MyPermissionsResponse,
    ResourcePermissionKeys,
    ResourcePermissionSnapshot,
    ResourceWhitelistResources,
    WorkspacePermissionSnapshot,
)

_RBAC_MODULE = "controllers.common.agent_access.enterprise_rbac_service"


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


def _agent(
    *,
    agent_id: str,
    app_id: str | None,
    source: AgentSource = AgentSource.AGENT_APP,
    status: AgentStatus = AgentStatus.ACTIVE,
) -> Agent:
    return Agent(
        id=agent_id,
        tenant_id="tenant-1",
        name=agent_id,
        description="",
        role="",
        agent_kind=AgentKind.DIFY_AGENT,
        scope=AgentScope.ROSTER,
        source=source,
        app_id=app_id,
        status=status,
        created_by="account-1",
        updated_by="account-1",
    )


class TestHasAgentListPermission:
    def test_matches_preview_permission(self) -> None:
        for key in AGENT_LIST_PERMISSION_KEYS:
            assert has_agent_list_permission([key])

    def test_rejects_non_preview_permissions(self) -> None:
        assert not has_agent_list_permission(["agent.acl.edit", "agent.acl.delete"])
        assert not has_agent_list_permission([])


class TestAgentAccessFilter:
    def test_unrestricted_leaves_app_params_untouched(self, unbound_session: Session) -> None:
        params = AppListParams(mode="agent")

        AgentAccessFilter.unrestricted().apply_to_app_params(
            params,
            tenant_id="tenant-1",
            session=unbound_session,
        )

        assert params.accessible_app_ids is None

    def test_maps_visible_agent_ids_to_active_agent_apps(self, sqlite_session: Session) -> None:
        sqlite_session.add_all(
            [
                _agent(agent_id="agent-1", app_id="app-2"),
                _agent(agent_id="agent-2", app_id="app-1"),
                _agent(agent_id="agent-3", app_id="workflow-app", source=AgentSource.ROSTER),
                _agent(agent_id="agent-4", app_id="archived-app", status=AgentStatus.ARCHIVED),
            ]
        )
        sqlite_session.flush()
        params = AppListParams(mode="agent")

        AgentAccessFilter(accessible_agent_ids={"agent-1", "agent-2", "agent-3", "agent-4"}).apply_to_app_params(
            params, tenant_id="tenant-1", session=sqlite_session
        )

        assert params.accessible_app_ids == ["app-1", "app-2"]

    def test_empty_visible_set_filters_every_agent_app(self, unbound_session: Session) -> None:
        params = AppListParams(mode="agent")

        AgentAccessFilter(accessible_agent_ids=set()).apply_to_app_params(
            params,
            tenant_id="tenant-1",
            session=unbound_session,
        )

        assert params.accessible_app_ids == []


class TestResolveAgentAccessFilter:
    def _patch_whitelist(self, monkeypatch: pytest.MonkeyPatch, whitelist: ResourceWhitelistResources) -> None:
        monkeypatch.setattr(
            f"{_RBAC_MODULE}.RBACService.AgentAccess.whitelist_resources",
            lambda _tenant_id, _account_id: whitelist,
        )

    def test_default_preview_is_unrestricted(self, monkeypatch: pytest.MonkeyPatch, unbound_session: Session) -> None:
        self._patch_whitelist(monkeypatch, ResourceWhitelistResources(unrestricted=True))

        access_filter = resolve_agent_access_filter(
            "tenant-1",
            "account-1",
            session=unbound_session,
            permissions=_permissions(agent_default_keys=["agent.acl.preview"]),
        )

        assert access_filter.accessible_agent_ids is None

    def test_collects_preview_overrides_without_default_preview(
        self,
        monkeypatch: pytest.MonkeyPatch,
        unbound_session: Session,
    ) -> None:
        self._patch_whitelist(monkeypatch, ResourceWhitelistResources(unrestricted=True))

        access_filter = resolve_agent_access_filter(
            "tenant-1",
            "account-1",
            session=unbound_session,
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
        unbound_session: Session,
    ) -> None:
        self._patch_whitelist(
            monkeypatch,
            ResourceWhitelistResources(unrestricted=False, resource_ids=["agent-9"]),
        )

        access_filter = resolve_agent_access_filter(
            "tenant-1",
            "account-1",
            session=unbound_session,
            permissions=_permissions(workspace_keys=["agent.acl.preview"]),
        )

        assert access_filter.accessible_agent_ids == {"agent-9"}
