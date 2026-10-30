"""Unit tests for controllers.common.app_access RBAC app-id access filtering."""

from __future__ import annotations

import pytest
from sqlalchemy.orm import Session

from controllers.common.app_access import (
    APP_LIST_PERMISSION_KEYS,
    AppAccessFilter,
    has_app_list_permission,
    resolve_app_access_filter,
)
from services.app_service import AppListParams
from services.enterprise.rbac_service import (
    MyPermissionsResponse,
    ResourcePermissionKeys,
    ResourcePermissionSnapshot,
    ResourceWhitelistResources,
    WorkspacePermissionSnapshot,
)

_RBAC_MODULE = "controllers.common.app_access.enterprise_rbac_service"


def _permissions(
    *,
    workspace_keys: list[str] | None = None,
    app_default_keys: list[str] | None = None,
    app_overrides: list[ResourcePermissionKeys] | None = None,
) -> MyPermissionsResponse:
    return MyPermissionsResponse(
        workspace=WorkspacePermissionSnapshot(permission_keys=workspace_keys or []),
        app=ResourcePermissionSnapshot(
            default_permission_keys=app_default_keys or [],
            overrides=app_overrides or [],
        ),
    )


class TestHasAppListPermission:
    def test_matches_known_preview_keys(self):
        for key in APP_LIST_PERMISSION_KEYS:
            assert has_app_list_permission([key])

    def test_rejects_unknown_keys(self):
        assert not has_app_list_permission(["app.export", "app.delete"])
        assert not has_app_list_permission([])


class TestAppAccessFilterIsAppAccessible:
    def test_unrestricted_sees_everything(self):
        flt = AppAccessFilter.unrestricted()
        assert flt.is_app_accessible("app-1", maintainer="someone", account_id="acc-1")

    def test_whitelisted_app_is_visible(self):
        flt = AppAccessFilter(accessible_app_ids={"app-1"})
        assert flt.is_app_accessible("app-1", maintainer=None, account_id="acc-1")
        assert not flt.is_app_accessible("app-2", maintainer=None, account_id="acc-1")

    def test_own_app_visible_without_manage_permission(self):
        own = AppAccessFilter(accessible_app_ids=set())
        assert own.is_app_accessible("app-1", maintainer="acc-1", account_id="acc-1")
        assert not own.is_app_accessible("app-1", maintainer="acc-2", account_id="acc-1")


class TestAppAccessFilterApplyToParams:
    def test_unrestricted_leaves_params_untouched(self):
        params = AppListParams()
        AppAccessFilter.unrestricted().apply_to_params(params)
        assert params.accessible_app_ids is None
        assert params.include_own_apps is False
        assert params.is_created_by_me is None

    def test_whitelisted_ids_are_sorted_and_include_own_apps(self):
        params = AppListParams()
        AppAccessFilter(accessible_app_ids={"b", "a"}).apply_to_params(params)
        assert params.accessible_app_ids == ["a", "b"]
        assert params.include_own_apps is True

    def test_empty_set_keeps_maintainer_filter_separate_from_creator(self):
        # Own-app fallback must use maintainer (include_own_apps), consistent
        # with is_app_accessible — not created_by (is_created_by_me).
        params = AppListParams()
        AppAccessFilter(accessible_app_ids=set()).apply_to_params(params)
        assert params.accessible_app_ids == []
        assert params.include_own_apps is True
        assert params.is_created_by_me is None


class TestResolveAppAccessFilter:
    def _patch_whitelist(self, monkeypatch: pytest.MonkeyPatch, whitelist: ResourceWhitelistResources) -> None:
        monkeypatch.setattr(
            f"{_RBAC_MODULE}.RBACService.AppAccess.whitelist_resources",
            lambda tenant_id, account_id: whitelist,
        )

    def test_default_preview_is_unrestricted(self, monkeypatch: pytest.MonkeyPatch, unbound_session: Session):
        self._patch_whitelist(monkeypatch, ResourceWhitelistResources(unrestricted=True))
        permissions = _permissions(app_default_keys=["app.preview"])

        flt = resolve_app_access_filter("tenant-1", "acc-1", session=unbound_session, permissions=permissions)

        assert flt.accessible_app_ids is None

    def test_restricted_whitelist_overrides_default_preview(
        self, monkeypatch: pytest.MonkeyPatch, unbound_session: Session
    ):
        self._patch_whitelist(monkeypatch, ResourceWhitelistResources(unrestricted=False, resource_ids=["app-9"]))
        permissions = _permissions(
            workspace_keys=["app.full_access", "app.create_and_management"],
        )

        flt = resolve_app_access_filter("tenant-1", "acc-1", session=unbound_session, permissions=permissions)

        assert flt.accessible_app_ids == {"app-9"}

    def test_override_apps_collected_without_default_preview(
        self, monkeypatch: pytest.MonkeyPatch, unbound_session: Session
    ):
        self._patch_whitelist(monkeypatch, ResourceWhitelistResources(unrestricted=True))
        permissions = _permissions(
            app_overrides=[
                ResourcePermissionKeys(resource_id="app-1", permission_keys=["app.preview"]),
                ResourcePermissionKeys(resource_id="app-2", permission_keys=["app.export"]),
            ],
        )

        flt = resolve_app_access_filter("tenant-1", "acc-1", session=unbound_session, permissions=permissions)

        assert flt.accessible_app_ids == {"app-1"}

    def test_restricted_whitelist_ignores_override_apps(
        self, monkeypatch: pytest.MonkeyPatch, unbound_session: Session
    ):
        self._patch_whitelist(monkeypatch, ResourceWhitelistResources(unrestricted=False, resource_ids=["app-5"]))
        permissions = _permissions(
            app_overrides=[ResourcePermissionKeys(resource_id="app-1", permission_keys=["app.acl.preview"])],
        )

        flt = resolve_app_access_filter("tenant-1", "acc-1", session=unbound_session, permissions=permissions)

        assert flt.accessible_app_ids == {"app-5"}

    def test_fetches_permissions_when_not_supplied(self, monkeypatch: pytest.MonkeyPatch, unbound_session: Session):
        self._patch_whitelist(monkeypatch, ResourceWhitelistResources(unrestricted=False, resource_ids=[]))
        session = unbound_session
        captured: dict[str, object] = {}

        def get_permissions(tenant_id: str, account_id: str, *, session: object):
            captured.update(tenant_id=tenant_id, account_id=account_id, session=session)
            return _permissions(workspace_keys=["app.create_and_management"])

        monkeypatch.setattr(
            f"{_RBAC_MODULE}.RBACService.MyPermissions.get",
            get_permissions,
        )

        flt = resolve_app_access_filter("tenant-1", "acc-1", session=session)

        assert flt.accessible_app_ids == set()
        assert captured == {"tenant_id": "tenant-1", "account_id": "acc-1", "session": session}

    @pytest.mark.parametrize("workspace_keys", [[], ["app.create_and_management"]])
    @pytest.mark.parametrize("whitelist_ids", [[], ["allowed"]])
    def test_restricted_whitelist_retains_maintainer_visibility(
        self,
        monkeypatch: pytest.MonkeyPatch,
        unbound_session: Session,
        workspace_keys: list[str],
        whitelist_ids: list[str],
    ) -> None:
        self._patch_whitelist(
            monkeypatch,
            ResourceWhitelistResources(unrestricted=False, resource_ids=whitelist_ids),
        )
        permissions = _permissions(workspace_keys=workspace_keys, app_default_keys=["app.preview"])

        flt = resolve_app_access_filter("tenant-1", "acc-1", session=unbound_session, permissions=permissions)

        assert flt.is_app_accessible("own", maintainer="acc-1", account_id="acc-1")
        assert not flt.is_app_accessible("other", maintainer="someone", account_id="acc-1")
        assert not flt.is_app_accessible("unassigned", maintainer=None, account_id="acc-1")
        if whitelist_ids:
            assert flt.is_app_accessible("allowed", maintainer="someone", account_id="acc-1")
