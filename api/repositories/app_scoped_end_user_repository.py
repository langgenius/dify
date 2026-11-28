"""SQLAlchemy persistence adapter for app-scoped end users."""

import logging
from collections.abc import Sequence
from typing import override

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker

from models.enums import EndUserType
from models.model import App, EndUser
from services.app_scoped_end_user_query_service import AppScopedEndUserQuery
from services.app_scoped_end_user_service import AppScopedEndUserRepository
from services.entities.app_scoped_end_user_entities import (
    AppScopedEndUserRecord,
    NewAppScopedEndUser,
    StoredAppScopedEndUser,
)

logger = logging.getLogger(__name__)


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
                select(EndUser)
                .where(
                    EndUser.tenant_id == tenant_id,
                    EndUser.app_id == app_id,
                    EndUser.session_id == user_id,
                )
                .order_by(EndUser.created_at, EndUser.id)
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
                select(EndUser)
                .where(
                    EndUser.tenant_id == tenant_id,
                    EndUser.app_id.in_(app_ids),
                    EndUser.session_id == user_id,
                    EndUser.type == EndUserType(type),
                )
                .order_by(EndUser.created_at, EndUser.id)
            ).all()
        return [self._stored(end_user) for end_user in end_users]

    @staticmethod
    def _lock_app(session: Session, *, tenant_id: str, app_id: str) -> None:
        """Serialize end user creation for one app.

        Precondition: ``tenant_id`` and ``app_id`` name the app whose end
        users are being created.
        Postcondition: the calling transaction holds the app row lock, so a
        concurrent create for the same app re-checks after this transaction
        commits. When the app row does not exist, the lock is a no-op and
        the unique index remains the backstop.
        """
        session.execute(
            select(App.id).where(App.id == app_id, App.tenant_id == tenant_id).with_for_update()
        ).scalar_one_or_none()

    @staticmethod
    def _find_by_identity(session: Session, command: NewAppScopedEndUser) -> EndUser | None:
        """Return the row for an identity, or None when it does not exist.

        Precondition: ``command`` names a (tenant, app, session, type) identity.
        Postcondition: the returned row matches that identity exactly.
        """
        return session.scalar(
            select(EndUser)
            .where(
                EndUser.tenant_id == command.tenant_id,
                EndUser.app_id == command.app_id,
                EndUser.session_id == command.session_id,
                EndUser.type == EndUserType(command.type),
            )
            .order_by(EndUser.created_at, EndUser.id)
            .limit(1)
        )

    def _find_existing(self, command: NewAppScopedEndUser) -> StoredAppScopedEndUser[EndUser] | None:
        """Return the stored row for an identity, or None when it does not exist.

        Precondition: ``command`` names a (tenant, app, session, type) identity.
        Postcondition: the returned metadata describes that identity's row.
        """
        with self._session_factory() as session:
            existing = self._find_by_identity(session, command)
            return self._stored(existing) if existing is not None else None

    @override
    def create(self, command: NewAppScopedEndUser) -> StoredAppScopedEndUser[EndUser]:
        """Insert one end user, returning the existing row when it already exists.

        Precondition: ``command`` names a (tenant, app, session, type) identity.
        Postcondition: exactly one row exists for that identity, and the
        returned metadata describes it. A concurrent insert for the same
        identity does not create a second row.
        Failure behavior: an IntegrityError from a writer that did not take
        the app lock resolves to the existing row when one is found; the
        error is re-raised when no such row exists.
        """
        end_user = EndUser(
            tenant_id=command.tenant_id,
            app_id=command.app_id,
            type=EndUserType(command.type),
            _is_anonymous=command.is_anonymous,
            session_id=command.session_id,
            external_user_id=command.external_user_id,
        )
        try:
            with self._session_factory.begin() as session:
                self._lock_app(session, tenant_id=command.tenant_id, app_id=command.app_id)
                existing = self._find_by_identity(session, command)
                if existing is not None:
                    return self._stored(existing)
                session.add(end_user)
                session.flush()
                return self._stored(end_user)
        except IntegrityError:
            logger.warning(
                "End user insert conflicted for tenant_id=%s app_id=%s session_id=%s; reusing the existing row",
                command.tenant_id,
                command.app_id,
                command.session_id,
            )
            stored = self._find_existing(command)
            if stored is None:
                raise
            return stored

    @override
    def create_batch(
        self,
        commands: Sequence[NewAppScopedEndUser],
    ) -> Sequence[StoredAppScopedEndUser[EndUser]]:
        """Insert end users for several apps, reusing rows created concurrently.

        Precondition: ``commands`` names one identity per app.
        Postcondition: one row exists per named identity, and the returned
        metadata describes each of them in command order.
        Failure behavior: a bulk insert conflicted by a concurrent create
        falls back to per-command creates, which resolve to the existing rows.
        """
        end_users = [
            EndUser(
                tenant_id=command.tenant_id,
                app_id=command.app_id,
                type=EndUserType(command.type),
                _is_anonymous=command.is_anonymous,
                session_id=command.session_id,
                external_user_id=command.external_user_id,
            )
            for command in commands
        ]
        try:
            with self._session_factory.begin() as session:
                session.add_all(end_users)
                if end_users:
                    session.flush()
        except IntegrityError:
            logger.warning("End user batch insert conflicted; resolving one app at a time")
            return [self.create(command) for command in commands]
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
