"""Application boundary for retrieving app-scoped Service API end users."""

from typing import Protocol

from machinery.context import ServiceApiRequestContext
from services.entities.app_scoped_end_user_entities import AppScopedEndUserRecord


class AppScopedEndUserQuery(Protocol):
    def find_by_id(self, *, tenant_id: str, app_id: str, end_user_id: str) -> AppScopedEndUserRecord | None: ...


class AppScopedEndUserNotFoundError(Exception):
    """Raised when an end user is not visible to the admitted app."""


class AppScopedEndUserQueryService:
    def __init__(self, *, end_users: AppScopedEndUserQuery) -> None:
        self._app_scoped_end_users = end_users

    def get_by_id(self, context: ServiceApiRequestContext, end_user_id: str) -> AppScopedEndUserRecord:
        end_user = self._app_scoped_end_users.find_by_id(
            tenant_id=context.tenant_id,
            app_id=context.app_id,
            end_user_id=end_user_id,
        )
        if end_user is None:
            raise AppScopedEndUserNotFoundError(end_user_id)
        return end_user
