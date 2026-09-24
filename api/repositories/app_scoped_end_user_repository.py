"""SQLAlchemy persistence adapter for app-scoped end users."""

from collections.abc import Sequence
from typing import override

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from models.enums import EndUserType
from models.model import EndUser
from services.app_scoped_end_user_query_service import AppScopedEndUserQuery
from services.app_scoped_end_user_service import AppScopedEndUserRepository
from services.entities.app_scoped_end_user_entities import (
    AppScopedEndUserRecord,
    NewAppScopedEndUser,
    StoredAppScopedEndUser,
)


class AppScopedEndUserRepo(AppScopedEndUserQuery, AppScopedEndUserRepository[EndUser]):
    def __init__(self, *, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

    @override
    def find_by_id(self, *, tenant_id: str, app_id: str, end_user_id: str) -> AppScopedEndUserRecord | None:
        statement = (
            select(
                EndUser.id,
                EndUser.tenant_id,
                EndUser.app_id,
                EndUser.type,
                EndUser.external_user_id,
                EndUser.name,
                EndUser._is_anonymous,
                EndUser.session_id,
                EndUser.created_at,
                EndUser.updated_at,
            )
            .where(
                EndUser.id == end_user_id,
                EndUser.tenant_id == tenant_id,
                EndUser.app_id == app_id,
            )
            .limit(1)
        )

        with self._session_factory() as session:
            row = session.execute(statement).one_or_none()

        if row is None:
            return None

        (
            record_id,
            record_tenant_id,
            record_app_id,
            end_user_type,
            external_user_id,
            name,
            is_anonymous,
            session_id,
            created_at,
            updated_at,
        ) = row
        return AppScopedEndUserRecord(
            id=record_id,
            tenant_id=record_tenant_id,
            app_id=record_app_id,
            type=end_user_type.value,
            external_user_id=external_user_id,
            name=name,
            is_anonymous=is_anonymous,
            session_id=session_id,
            created_at=created_at,
            updated_at=updated_at,
        )

    @override
    def find_by_session(
        self,
        *,
        tenant_id: str,
        app_id: str,
        user_id: str,
    ) -> Sequence[StoredAppScopedEndUser[EndUser]]:
        with self._session_factory() as session:
            end_users = session.scalars(
                select(EndUser).where(
                    EndUser.tenant_id == tenant_id,
                    EndUser.app_id == app_id,
                    EndUser.session_id == user_id,
                )
            ).all()
        return [self._stored(end_user) for end_user in end_users]

    @override
    def find_by_apps(
        self,
        *,
        tenant_id: str,
        app_ids: Sequence[str],
        user_id: str,
        type: str,
    ) -> Sequence[StoredAppScopedEndUser[EndUser]]:
        with self._session_factory() as session:
            end_users = session.scalars(
                select(EndUser).where(
                    EndUser.tenant_id == tenant_id,
                    EndUser.app_id.in_(app_ids),
                    EndUser.session_id == user_id,
                    EndUser.type == EndUserType(type),
                )
            ).all()
        return [self._stored(end_user) for end_user in end_users]

    @override
    def create(self, command: NewAppScopedEndUser) -> StoredAppScopedEndUser[EndUser]:
        end_user = EndUser(
            tenant_id=command.tenant_id,
            app_id=command.app_id,
            type=EndUserType(command.type),
            is_anonymous=command.is_anonymous,
            session_id=command.session_id,
            external_user_id=command.external_user_id,
        )
        with self._session_factory.begin() as session:
            session.add(end_user)
            session.flush()
        return self._stored(end_user)

    @override
    def create_batch(
        self,
        commands: Sequence[NewAppScopedEndUser],
    ) -> Sequence[StoredAppScopedEndUser[EndUser]]:
        end_users = [
            EndUser(
                tenant_id=command.tenant_id,
                app_id=command.app_id,
                type=EndUserType(command.type),
                is_anonymous=command.is_anonymous,
                session_id=command.session_id,
                external_user_id=command.external_user_id,
            )
            for command in commands
        ]
        with self._session_factory.begin() as session:
            session.add_all(end_users)
            if end_users:
                session.flush()
        return [self._stored(end_user) for end_user in end_users]

    @override
    def update_type(self, end_user_id: str, type: str) -> StoredAppScopedEndUser[EndUser]:
        with self._session_factory.begin() as session:
            end_user = session.get(EndUser, end_user_id)
            if end_user is None:
                raise RuntimeError(f"End user {end_user_id} disappeared before it could be updated")
            end_user.type = EndUserType(type)
        return self._stored(end_user)

    @staticmethod
    def _stored(end_user: EndUser) -> StoredAppScopedEndUser[EndUser]:
        if end_user.id is None:
            raise RuntimeError("App-scoped end user must be flushed before it is returned")
        if end_user.app_id is None:
            raise RuntimeError("App-scoped end user must have an app ID")
        return StoredAppScopedEndUser(
            id=end_user.id,
            app_id=end_user.app_id,
            type=end_user.type.value,
            value=end_user,
        )
