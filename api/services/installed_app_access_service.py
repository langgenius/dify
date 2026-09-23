"""Resolve installed-app admission and account-specific list visibility."""

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Protocol

from enums import WebAppAccessMode
from services.webapp_access_query_service import WebAppAccessModesQuery, WebAppUserPermissionsQuery


@dataclass(frozen=True, slots=True)
class InstalledAppRef:
    id: str
    app_id: str
    tenant_id: str


class InstalledAppAccessStore(Protocol):
    def resolve(self, *, installed_app_id: str, tenant_id: str) -> InstalledAppRef | None: ...


class WebAppUserAccessCheck(Protocol):
    def __call__(self, *, user_id: str, app_id: str) -> bool: ...


class InstalledAppNotFoundError(LookupError):
    """The workspace installation or its target app no longer exists."""


class InstalledAppAccessDeniedError(PermissionError):
    """The current account cannot access the installed app."""


class InstalledAppAccessService:
    def __init__(
        self,
        *,
        installed_apps: InstalledAppAccessStore,
        is_user_allowed: WebAppUserAccessCheck,
        get_access_modes: WebAppAccessModesQuery,
        get_user_permissions: WebAppUserPermissionsQuery,
    ) -> None:
        self._installed_apps: InstalledAppAccessStore = installed_apps
        self._is_user_allowed: WebAppUserAccessCheck = is_user_allowed
        self._get_access_modes: WebAppAccessModesQuery = get_access_modes
        self._get_user_permissions: WebAppUserPermissionsQuery = get_user_permissions

    def get_access(self, *, installed_app_id: str, tenant_id: str, account_id: str) -> InstalledAppRef:
        installed_app = self._installed_apps.resolve(installed_app_id=installed_app_id, tenant_id=tenant_id)
        if installed_app is None:
            raise InstalledAppNotFoundError("Installed app not found")
        if not self._is_user_allowed(user_id=account_id, app_id=installed_app.app_id):
            raise InstalledAppAccessDeniedError("Access to installed app denied")
        return installed_app

    def get_visible_app_ids(self, *, user_id: str, app_ids: Sequence[str]) -> frozenset[str]:
        """Apply list visibility rules without changing single-app admission.

        Missing access settings and SSO-only apps are omitted from the list.
        Preserve candidate order for the subsequent batch permission query.
        """
        if not app_ids:
            return frozenset(app_ids)

        access_modes = self._get_access_modes(app_ids=app_ids)
        candidates = [
            app_id
            for app_id in app_ids
            if app_id in access_modes and access_modes[app_id] != WebAppAccessMode.SSO_VERIFIED
        ]
        if not candidates:
            return frozenset()

        permissions = self._get_user_permissions(user_id=user_id, app_ids=candidates)
        return frozenset(app_id for app_id in candidates if permissions.get(app_id))
