"""SQLAlchemy implementation of the shared Console account query port."""

from typing import override

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from models.account import Account
from services.account_query import AccountQuery
from services.entities.account_entities import AccountProfile


class AccountQueryRepository(AccountQuery):
    def __init__(self, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

    @override
    def get_profile(self, account_id: str) -> AccountProfile | None:
        stmt = select(
            Account.id,
            Account.interface_language,
            Account.initialized_at,
            Account.created_at,
        ).where(Account.id == account_id)

        with self._session_factory() as session:
            row = session.execute(stmt).one_or_none()

        if row is None:
            return None

        return AccountProfile(
            id=row.id,
            interface_language=row.interface_language,
            initialized_at=row.initialized_at,
            created_at=row.created_at,
        )
