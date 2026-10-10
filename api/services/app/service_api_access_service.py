"""Resolve app-token access for Service APIs acting as the workspace owner."""

from dataclasses import dataclass
from typing import Protocol

from machinery.context import ServiceApiAccountRequestContext


@dataclass(frozen=True, slots=True)
class ServiceApiAppAccess:
    app_id: str
    tenant_id: str
    app_status: str
    enable_api: bool
    workspace_status: str | None  # None means the app's workspace no longer exists.
    account_id: str | None  # None means no existing account has the workspace owner membership.


class ServiceApiAppAccessStore(Protocol):
    def get_access(self, *, app_id: str, tenant_id: str | None) -> ServiceApiAppAccess | None:
        """Read app, workspace and owner together, closing the session before returning.

        A missing tenant ID is supported only for historical app API keys;
        resolve the workspace from their app. A provided tenant ID must match.
        """
        ...


class ServiceApiAppAccessDeniedError(Exception):
    """The app or workspace cannot serve this API request."""


class ServiceApiWorkspaceNotFoundError(Exception):
    """The authenticated app's workspace no longer exists."""


class ServiceApiOwnerNotFoundError(Exception):
    """The workspace is inactive or has no existing owner account."""


class ServiceApiAppAccessService:
    def __init__(self, *, apps: ServiceApiAppAccessStore) -> None:
        self._apps = apps

    def resolve_account(self, *, app_id: str | None, tenant_id: str | None) -> ServiceApiAccountRequestContext:
        """Apply app-token checks without binding an ORM account to Flask.

        A missing app ID denotes an orphaned historical key and is rejected
        without querying the store. A missing tenant ID retains historical app-key scope.
        """
        app = self._apps.get_access(app_id=app_id, tenant_id=tenant_id) if app_id is not None else None
        if app is None:
            raise ServiceApiAppAccessDeniedError("The app no longer exists.")
        if app.app_status != "normal":
            raise ServiceApiAppAccessDeniedError("The app's status is abnormal.")
        if not app.enable_api:
            raise ServiceApiAppAccessDeniedError("The app's API service has been disabled.")
        if app.workspace_status is None:
            raise ServiceApiWorkspaceNotFoundError("Tenant does not exist.")
        if app.workspace_status == "archive":
            raise ServiceApiAppAccessDeniedError("The workspace's status is archived.")
        if app.workspace_status != "normal" or app.account_id is None:
            raise ServiceApiOwnerNotFoundError("Tenant owner account not found or tenant is not active.")
        return ServiceApiAccountRequestContext(
            tenant_id=app.tenant_id,
            app_id=app.app_id,
            account_id=app.account_id,
        )
