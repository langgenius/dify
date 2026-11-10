"""Unit tests for services.app.access RBAC app-id access filtering."""

from __future__ import annotations

import pytest

from services.app.access import (
    APP_LIST_PERMISSION_KEYS,
    AppAccessFilter,
    app_access_filter_from_permissions,
    has_app_list_permission,
    resolve_app_access_filter,
)
from services.entities.app_entities import AppListParams
from services.rbac.contracts import (
    MyPermissionsResponse,
    ResourcePermissionKeys,
    ResourcePermissionSnapshot,
    ResourceWhitelistResources,
    WorkspacePermissionSnapshot,
)
from tests.unit_tests.controllers.conftest import app_query_services as app_query_services  # noqa: PLC0414
from tests.unit_tests.controllers.conftest import (
    datasource_application_dependencies as datasource_application_dependencies,  # noqa: PLC0414
)
from tests.unit_tests.controllers.conftest import error_response_contract as error_response_contract  # noqa: PLC0414
from tests.unit_tests.controllers.conftest import pipeline_application as pipeline_application  # noqa: PLC0414

_RBAC_MODULE = "services.app.access.enterprise_rbac_service"


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
    def test_matches_known_preview_keys(self) -> None:
        for key in APP_LIST_PERMISSION_KEYS:
            assert has_app_list_permission([key])

    def test_rejects_unknown_keys(self) -> None:
        assert not has_app_list_permission(["app.export", "app.delete"])
        assert not has_app_list_permission([])


class TestAppAccessFilterIsAppAccessible:
    def test_unrestricted_sees_everything(self) -> None:
        flt = AppAccessFilter.unrestricted()
        assert flt.is_app_accessible("app-1", maintainer="someone", account_id="acc-1")

    def test_whitelisted_app_is_visible(self) -> None:
        flt = AppAccessFilter(accessible_app_ids={"app-1"})
        assert flt.is_app_accessible("app-1", maintainer=None, account_id="acc-1")
        assert not flt.is_app_accessible("app-2", maintainer=None, account_id="acc-1")

    def test_own_app_visible_without_manage_permission(self) -> None:
        own = AppAccessFilter(accessible_app_ids=set())
        assert own.is_app_accessible("app-1", maintainer="acc-1", account_id="acc-1")
        assert not own.is_app_accessible("app-1", maintainer="acc-2", account_id="acc-1")


class TestAppAccessFilterApplyToParams:
    def test_unrestricted_leaves_params_untouched(self) -> None:
        params = AppListParams()
        AppAccessFilter.unrestricted().apply_to_params(params)
        assert params.accessible_app_ids is None
        assert params.is_created_by_me is None

    def test_whitelisted_ids_are_sorted(self) -> None:
        params = AppListParams()
        AppAccessFilter(accessible_app_ids={"b", "a"}).apply_to_params(params)
        assert params.accessible_app_ids == ["a", "b"]

    def test_empty_set_keeps_maintainer_filter_separate_from_creator(self) -> None:
        # Own-app fallback must use maintainer, consistent
        # with is_app_accessible — not created_by (is_created_by_me).
        params = AppListParams()
        AppAccessFilter(accessible_app_ids=set()).apply_to_params(params)
        assert params.accessible_app_ids == []
        assert params.is_created_by_me is None


class TestResolveAppAccessFilter:
    def _patch_whitelist(self, monkeypatch: pytest.MonkeyPatch, whitelist: ResourceWhitelistResources) -> None:
        monkeypatch.setattr(
            f"{_RBAC_MODULE}.RBACService.AppAccess.whitelist_resources",
            lambda *_args, **_kwargs: whitelist,
        )

    def test_default_preview_is_unrestricted(self) -> None:
        permissions = _permissions(app_default_keys=["app.preview"])

        flt = app_access_filter_from_permissions(permissions, ResourceWhitelistResources(unrestricted=True))

        assert flt.accessible_app_ids is None

    def test_restricted_whitelist_overrides_default_preview(self) -> None:
        permissions = _permissions(
            workspace_keys=["app.full_access", "app.create_and_management"],
        )

        flt = app_access_filter_from_permissions(
            permissions, ResourceWhitelistResources(unrestricted=False, resource_ids=["app-9"])
        )

        assert flt.accessible_app_ids == {"app-9"}

    def test_override_apps_collected_without_default_preview(self) -> None:
        permissions = _permissions(
            app_overrides=[
                ResourcePermissionKeys(resource_id="app-1", permission_keys=["app.preview"]),
                ResourcePermissionKeys(resource_id="app-2", permission_keys=["app.export"]),
            ],
        )

        flt = app_access_filter_from_permissions(permissions, ResourceWhitelistResources(unrestricted=True))

        assert flt.accessible_app_ids == {"app-1"}

    def test_restricted_whitelist_ignores_override_apps(self) -> None:
        permissions = _permissions(
            app_overrides=[ResourcePermissionKeys(resource_id="app-1", permission_keys=["app.acl.preview"])],
        )

        flt = app_access_filter_from_permissions(
            permissions, ResourceWhitelistResources(unrestricted=False, resource_ids=["app-5"])
        )

        assert flt.accessible_app_ids == {"app-5"}

    def test_fetches_permissions_when_not_supplied(self, monkeypatch: pytest.MonkeyPatch) -> None:
        self._patch_whitelist(monkeypatch, ResourceWhitelistResources(unrestricted=False, resource_ids=[]))
        captured: dict[str, object] = {}

        def get_permissions(tenant_id: str, account_id: str) -> MyPermissionsResponse:
            captured.update(tenant_id=tenant_id, account_id=account_id)
            return _permissions(workspace_keys=["app.create_and_management"])

        monkeypatch.setattr(
            f"{_RBAC_MODULE}.RBACService.MyPermissions.get",
            get_permissions,
        )

        flt = resolve_app_access_filter(
            "tenant-1",
            "acc-1",
        )

        assert flt.accessible_app_ids == set()
        assert captured == {"tenant_id": "tenant-1", "account_id": "acc-1"}


@pytest.mark.parametrize("workspace_keys", [[], ["app.create_and_management"]])
@pytest.mark.parametrize("whitelist_ids", [[], ["allowed"]])
def test_restricted_whitelist_retains_maintainer_visibility(
    workspace_keys: list[str], whitelist_ids: list[str]
) -> None:
    access = app_access_filter_from_permissions(
        _permissions(workspace_keys=workspace_keys, app_default_keys=["app.preview"]),
        ResourceWhitelistResources(unrestricted=False, resource_ids=whitelist_ids),
    )
    assert access.is_app_accessible("own", "account", "account")
    assert not access.is_app_accessible("other", "someone", "account")
    assert not access.is_app_accessible("unassigned", None, "account")
    if whitelist_ids:
        assert access.is_app_accessible("allowed", "someone", "account")
