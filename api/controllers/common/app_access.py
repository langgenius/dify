from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import TYPE_CHECKING

from sqlalchemy.orm import Session

from services.enterprise import rbac_service as enterprise_rbac_service

if TYPE_CHECKING:
    from services.app_service import AppListBaseParams
    from services.enterprise.rbac_service import MyPermissionsResponse

# Permission keys (dot-notation, from MyPermissionsResponse) that grant
# list/preview access to an app. Keep this the single source of truth for both
# the console and OpenAPI app-list endpoints.
APP_LIST_PERMISSION_KEYS: frozenset[str] = frozenset({"app.preview", "app.acl.preview", "app.full_access"})

# Workspace permission key that lets a caller see apps they maintain even when
# those apps are not in their preview whitelist.
_MANAGE_OWN_APPS_PERMISSION_KEY = "app.create_and_management"


def has_app_list_permission(permission_keys: Sequence[str]) -> bool:
    """Return True if any of ``permission_keys`` grants app list/preview access."""
    return any(permission_key in APP_LIST_PERMISSION_KEYS for permission_key in permission_keys)


@dataclass(frozen=True)
class AppAccessFilter:
    """Resolved RBAC visibility for app list/read endpoints.

    ``accessible_app_ids`` of ``None`` means the caller can see every app in the
    workspace (unrestricted). Otherwise it is the exact set of app ids the
    caller may preview; combined with ``can_manage_own_apps`` it also covers
    apps the caller maintains.
    """

    accessible_app_ids: set[str] | None
    can_manage_own_apps: bool

    @classmethod
    def unrestricted(cls) -> AppAccessFilter:
        """Filter that imposes no restriction (RBAC disabled / not applicable)."""
        return cls(accessible_app_ids=None, can_manage_own_apps=False)

    def is_app_accessible(self, app_id: str, maintainer: str | None, account_id: str) -> bool:
        """Whether a single app is visible to the caller under this filter.

        Mirrors the service-layer query gate: an app is visible when the filter
        is unrestricted, the app id is whitelisted, or the caller maintains it
        and holds ``app.create_and_management``.
        """
        if self.accessible_app_ids is None:
            return True
        if app_id in self.accessible_app_ids:
            return True
        return self.can_manage_own_apps and maintainer is not None and maintainer == account_id

    def apply_to_params(self, params: AppListBaseParams) -> None:
        if self.accessible_app_ids is None:
            return
        params.accessible_app_ids = sorted(self.accessible_app_ids)
        params.include_own_apps = self.can_manage_own_apps


def resolve_app_access_filter(
    tenant_id: str,
    account_id: str,
    *,
    session: Session,
    permissions: MyPermissionsResponse | None = None,
) -> AppAccessFilter:
    """Compute the RBAC app-access filter for ``account_id`` in ``tenant_id``.

    Pass ``permissions`` when the caller has already fetched the snapshot (the
    console controller reuses it for per-app permission keys) to avoid a second
    inner-API round trip; otherwise it is fetched here.
    """
    if permissions is None:
        permissions = enterprise_rbac_service.RBACService.MyPermissions.get(tenant_id, account_id, session=session)
    whitelist_scope = enterprise_rbac_service.RBACService.AppAccess.whitelist_resources(tenant_id, account_id)

    can_manage_own_apps = _MANAGE_OWN_APPS_PERMISSION_KEY in permissions.workspace.permission_keys
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

    accessible_app_ids: set[str] | None
    if getattr(whitelist_scope, "unrestricted", False):
        accessible_app_ids = permission_app_ids
    else:
        accessible_app_ids = set(whitelist_scope.resource_ids)
        if permission_app_ids is not None:
            accessible_app_ids |= permission_app_ids
        elif has_default_preview:
            # Default preview overrides the whitelist restriction.
            accessible_app_ids = None

    return AppAccessFilter(accessible_app_ids=accessible_app_ids, can_manage_own_apps=can_manage_own_apps)
