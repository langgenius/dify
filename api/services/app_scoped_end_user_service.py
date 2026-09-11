import logging
from collections.abc import Mapping, Sequence
from typing import Protocol

from models.enums import DEFAULT_END_USER_SESSION_ID, EndUserType
from services.entities.app_scoped_end_user_entities import NewAppScopedEndUser, StoredAppScopedEndUser

logger = logging.getLogger(__name__)


class AppScopedEndUserRepository[T](Protocol):
    def find_by_session(
        self,
        *,
        tenant_id: str,
        app_id: str,
        user_id: str,
    ) -> Sequence[StoredAppScopedEndUser[T]]: ...

    def find_by_apps(
        self,
        *,
        tenant_id: str,
        app_ids: Sequence[str],
        user_id: str,
        type: str,
    ) -> Sequence[StoredAppScopedEndUser[T]]: ...

    def create(self, command: NewAppScopedEndUser) -> StoredAppScopedEndUser[T]: ...

    def create_batch(self, commands: Sequence[NewAppScopedEndUser]) -> Sequence[StoredAppScopedEndUser[T]]: ...

    def update_type(self, end_user_id: str, type: str) -> StoredAppScopedEndUser[T]: ...


class AppScopedEndUserService[T]:
    """Application service for provisioning app-scoped end users."""

    def __init__(self, *, end_users: AppScopedEndUserRepository[T]) -> None:
        self._app_scoped_end_users = end_users

    def get_or_create_end_user(
        self,
        tenant_id: str,
        app_id: str,
        user_id: str | None = None,
    ) -> T:
        return self.get_or_create_end_user_by_type(
            EndUserType.SERVICE_API,
            tenant_id=tenant_id,
            app_id=app_id,
            user_id=user_id,
        )

    def get_or_create_end_user_by_type(
        self,
        type: EndUserType,
        tenant_id: str,
        app_id: str,
        user_id: str | None = None,
    ) -> T:
        normalized_user_id = user_id or DEFAULT_END_USER_SESSION_ID
        candidates = self._app_scoped_end_users.find_by_session(
            tenant_id=tenant_id,
            app_id=app_id,
            user_id=normalized_user_id,
        )
        # An AppDeploy row is never a legacy row this service may upgrade. FileGrantService
        # reads those rows by type, so retyping one would hide it and strand its files.
        candidates = [candidate for candidate in candidates if candidate.type != EndUserType.APP_DEPLOY.value]
        end_user = next((candidate for candidate in candidates if candidate.type == type.value), None)
        end_user = end_user or next(iter(candidates), None)

        if end_user is None:
            return self._app_scoped_end_users.create(
                NewAppScopedEndUser(
                    tenant_id=tenant_id,
                    app_id=app_id,
                    type=type.value,
                    is_anonymous=normalized_user_id == DEFAULT_END_USER_SESSION_ID,
                    session_id=normalized_user_id,
                    external_user_id=normalized_user_id,
                )
            ).value

        if end_user.type != type.value:
            logger.info(
                "Upgrading legacy EndUser %s from type=%s to %s for session_id=%s",
                end_user.id,
                end_user.type,
                type.value,
                normalized_user_id,
            )
            end_user = self._app_scoped_end_users.update_type(end_user.id, type.value)

        return end_user.value

    def create_end_user_batch(
        self,
        type: EndUserType,
        tenant_id: str,
        app_ids: list[str],
        user_id: str,
    ) -> Mapping[str, T]:
        normalized_user_id = user_id or DEFAULT_END_USER_SESSION_ID
        unique_app_ids = list(dict.fromkeys(app_ids))
        if not unique_app_ids:
            return {}

        existing_end_users = self._app_scoped_end_users.find_by_apps(
            tenant_id=tenant_id,
            app_ids=unique_app_ids,
            user_id=normalized_user_id,
            type=type.value,
        )
        result: dict[str, T] = {}
        for end_user in existing_end_users:
            result.setdefault(end_user.app_id, end_user.value)

        commands = [
            NewAppScopedEndUser(
                tenant_id=tenant_id,
                app_id=app_id,
                type=type.value,
                is_anonymous=normalized_user_id == DEFAULT_END_USER_SESSION_ID,
                session_id=normalized_user_id,
                external_user_id=normalized_user_id,
            )
            for app_id in unique_app_ids
            if app_id not in result
        ]
        for end_user in self._app_scoped_end_users.create_batch(commands):
            result[end_user.app_id] = end_user.value

        return result
