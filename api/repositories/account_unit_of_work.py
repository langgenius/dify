"""Short-lived SQLAlchemy unit of work for account persistence."""

from __future__ import annotations

from types import TracebackType
from typing import override

from sqlalchemy.orm import Session, sessionmaker

from repositories.account_repository import SQLAlchemyAccountRepository
from services.account_ports import AccountRepository, AccountUnitOfWork, AccountUnitOfWorkFactory


class SQLAlchemyAccountUnitOfWork(AccountUnitOfWork):
    def __init__(self, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory
        self._session: Session | None = None
        self._accounts: AccountRepository | None = None
        self._committed = False

    @property
    @override
    def accounts(self) -> AccountRepository:
        if self._accounts is None:
            raise RuntimeError("Account unit of work has not been entered")
        return self._accounts

    @override
    def __enter__(self) -> SQLAlchemyAccountUnitOfWork:
        if self._session is not None:
            raise RuntimeError("Account unit of work cannot be entered twice")
        self._session = self._session_factory()
        self._accounts = SQLAlchemyAccountRepository(self._session)
        return self

    @override
    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc_value: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        session = self._require_session()
        try:
            if exc_type is not None or not self._committed:
                session.rollback()
        finally:
            session.close()
            self._session = None
            self._accounts = None
            self._committed = False

    @override
    def commit(self) -> None:
        self._require_session().commit()
        self._committed = True

    @override
    def rollback(self) -> None:
        self._require_session().rollback()
        self._committed = False

    def _require_session(self) -> Session:
        if self._session is None:
            raise RuntimeError("Account unit of work has not been entered")
        return self._session


class SQLAlchemyAccountUnitOfWorkFactory(AccountUnitOfWorkFactory):
    def __init__(self, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

    @override
    def __call__(self) -> AccountUnitOfWork:
        return SQLAlchemyAccountUnitOfWork(self._session_factory)
