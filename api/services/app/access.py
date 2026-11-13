from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

from configs import dify_config
from core.rbac import RBACPermission, RBACResourceScope
from services.enterprise import rbac_service as enterprise_rbac_service
from services.entities.app_entities import AppListBaseParams
from services.rbac.contracts import MyPermissionsResponse, ResourceWhitelistResources

# Permission keys (dot-notation, from MyPermissionsResponse) that grant
# list/preview access to an app. Keep this the single source of truth for both
# the console and OpenAPI app-list endpoints.
APP_LIST_PERMISSION_KEYS: frozenset[str] = frozenset({"app.preview", "app.acl.preview", "app.full_access"})
APP_RUN_PERMISSION_KEYS: frozenset[str] = frozenset({"app.acl.test_and_run", "app.full_access"})


def has_app_list_permission(permission_keys: Sequence[str]) -> bool:
    """Return True if any of ``permission_keys`` grants app list/preview access."""
    return any(permission_key in APP_LIST_PERMISSION_KEYS for permission_key in permission_keys)


def can_run_app(*, tenant_id: str, account_id: str, app_id: str, maintainer: str | None) -> bool:
    """Check the evaluator App's run scene; a maintainer keeps the same exemption as console App routes.

    The caller supplies a tenant-scoped App. A denial changes no state; an allowance
    authorizes only this App, not an evaluation target or a future retry.
    """
    if not dify_config.RBAC_ENABLED or maintainer == account_id:
        return True
    return enterprise_rbac_service.RBACService.CheckAccess.check(
        tenant_id,
        account_id,
        scene=RBACPermission.APP_TEST_AND_RUN,
        resource_type=RBACResourceScope.APP,
        resource_id=app_id,
    )


@dataclass(frozen=True)
class AppRunAccessFilter:
    """Evaluator Apps allowed by RBAC before pagination, with a maintainer exemption.

    ``allowed_app_ids=None`` means all Apps except ``denied_app_ids``. A
    concrete set means only those Apps. Maintained Apps are always included.
    """

    account_id: str
    allowed_app_ids: set[str] | None
    denied_app_ids: set[str]


@dataclass(frozen=True)
class AppAccessFilter:
    """Resolved RBAC visibility for app list/read endpoints.

    ``accessible_app_ids`` of ``None`` means the caller can see every app in the
    workspace (unrestricted). Otherwise it is the exact set of app ids the
    caller may preview in addition to apps the caller maintains.
    """

    accessible_app_ids: set[str] | None

    @classmethod
    def unrestricted(cls) -> AppAccessFilter:
        """Filter that imposes no restriction (RBAC disabled / not applicable)."""
        return cls(accessible_app_ids=None)

    def is_app_accessible(self, app_id: str, maintainer: str | None, account_id: str) -> bool:
        """Whether a single app is visible to the caller under this filter.

        Mirrors the service-layer query gate: an app is visible when the filter
        is unrestricted, the app id is whitelisted, or the caller maintains it
        regardless of workspace permissions.
        """
        if self.accessible_app_ids is None:
            return True
        if app_id in self.accessible_app_ids:
            return True
        return maintainer is not None and maintainer == account_id

    def apply_to_params(self, params: AppListBaseParams) -> None:
        if self.accessible_app_ids is None:
            return
        params.accessible_app_ids = sorted(self.accessible_app_ids)


def resolve_app_access_filter(
    tenant_id: str,
    account_id: str,
    *,
    permissions: MyPermissionsResponse | None = None,
) -> AppAccessFilter:
    """Compute the RBAC app-access filter for ``account_id`` in ``tenant_id``.

    Pass ``permissions`` when the caller has already fetched the snapshot (the
    console controller reuses it for per-app permission keys) to avoid a second
    inner-API round trip; otherwise it is fetched here.
    """
    if permissions is None:
        permissions = enterprise_rbac_service.RBACService.MyPermissions.get(
            tenant_id,
            account_id,
        )
    whitelist_scope = enterprise_rbac_service.RBACService.AppAccess.whitelist_resources(tenant_id, account_id)
    return app_access_filter_from_permissions(permissions, whitelist_scope)


def app_access_filter_from_permissions(
    permissions: MyPermissionsResponse, whitelist_scope: ResourceWhitelistResources
) -> AppAccessFilter:
    """Compute visibility from permission and whitelist snapshots without I/O."""
    has_default_preview = has_app_list_permission(permissions.app.default_permission_keys) or has_app_list_permission(
        permissions.workspace.permission_keys
    )

    permission_app_ids: set[str] | None = None
    if not has_default_preview:
        # Collect apps the caller can preview via per-app permission overrides.
        permission_app_ids = {
            override.resource_id
            for override in permissions.app.overrides
            if has_app_list_permission(override.permission_keys)
        }

    # Maintainers always retain visibility of their own apps. The whitelist
    # takes precedence over permission grants only for other apps.
    accessible_app_ids = permission_app_ids if whitelist_scope.unrestricted else set(whitelist_scope.resource_ids)

    return AppAccessFilter(accessible_app_ids=accessible_app_ids)


def resolve_app_run_access_filter(tenant_id: str, account_id: str) -> AppRunAccessFilter:
    """Load the caller's App run grants and whitelist for one tenant.

    The result is a query-ready scope. A failed RBAC lookup raises before the
    list is queried, so no tenant-wide evaluator page is returned on failure.
    """
    permissions = enterprise_rbac_service.RBACService.MyPermissions.get(tenant_id, account_id)
    whitelist_scope = enterprise_rbac_service.RBACService.AppAccess.whitelist_resources(tenant_id, account_id)
    return app_run_access_filter_from_permissions(account_id, permissions, whitelist_scope)


def app_run_access_filter_from_permissions(
    account_id: str, permissions: MyPermissionsResponse, whitelist_scope: ResourceWhitelistResources
) -> AppRunAccessFilter:
    """Resolve effective run grants, including per-App overrides and the whitelist.

    A resource override replaces the default grant for that App. The whitelist
    then limits non-maintainer Apps. Success returns a scope safe to apply
    before pagination; no external state is changed.
    """
    default_can_run = any(
        key in APP_RUN_PERMISSION_KEYS
        for key in (*permissions.app.default_permission_keys, *permissions.workspace.permission_keys)
    )
    granted_overrides = {
        override.resource_id
        for override in permissions.app.overrides
        if any(key in APP_RUN_PERMISSION_KEYS for key in override.permission_keys)
    }
    denied_overrides = {
        override.resource_id
        for override in permissions.app.overrides
        if not any(key in APP_RUN_PERMISSION_KEYS for key in override.permission_keys)
    }

    if default_can_run and whitelist_scope.unrestricted:
        return AppRunAccessFilter(account_id, allowed_app_ids=None, denied_app_ids=denied_overrides)

    if default_can_run:
        allowed_app_ids = set(whitelist_scope.resource_ids)
    elif whitelist_scope.unrestricted:
        allowed_app_ids = granted_overrides
    else:
        allowed_app_ids = granted_overrides.intersection(whitelist_scope.resource_ids)
    return AppRunAccessFilter(account_id, allowed_app_ids=allowed_app_ids - denied_overrides, denied_app_ids=set())
