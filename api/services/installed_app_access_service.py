"""Application admission for an app installed in a workspace."""

from dataclasses import dataclass
from typing import Protocol


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
    ) -> None:
        self._installed_apps = installed_apps
        self._is_user_allowed = is_user_allowed

    def get_access(self, *, installed_app_id: str, tenant_id: str, account_id: str) -> InstalledAppRef:
        installed_app = self._installed_apps.resolve(installed_app_id=installed_app_id, tenant_id=tenant_id)
        if installed_app is None:
            raise InstalledAppNotFoundError("Installed app not found")
        if not self._is_user_allowed(user_id=account_id, app_id=installed_app.app_id):
            raise InstalledAppAccessDeniedError("Access to installed app denied")
        return installed_app
