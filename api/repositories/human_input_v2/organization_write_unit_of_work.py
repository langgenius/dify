"""Organization-guarded SQLAlchemy transaction boundary for protected writes."""

from __future__ import annotations

from contextlib import ExitStack
from types import TracebackType
from typing import Protocol, Self

import sqlalchemy as sa
from sqlalchemy import event
from sqlalchemy.orm import Session, sessionmaker


class OwnedOrganizationWriteLock(Protocol):
    """Lease contract required by an Organization-protected database transaction."""

    def __enter__(self) -> Self: ...

    def __exit__(
        self,
        exception_type: type[BaseException] | None,
        exception: BaseException | None,
        traceback: TracebackType | None,
    ) -> None: ...

    def ensure_owned(self) -> None: ...

    def extend(self) -> None: ...


class SQLAlchemyOrganizationWriteUnitOfWork:
    """Open a database transaction only after the Organization lease is owned."""

    def __init__(self, session_maker: sessionmaker[Session], write_lock: OwnedOrganizationWriteLock) -> None:
        self._session_maker = session_maker
        self._write_lock = write_lock
        self._exit_stack: ExitStack | None = None
        self._session: Session | None = None

    @property
    def session(self) -> Session:
        if self._session is None:
            raise RuntimeError("session requires an active guarded unit of work")
        return self._session

    def __enter__(self) -> Session:
        if self._exit_stack is not None:
            raise RuntimeError("guarded unit of work is already active")
        with ExitStack() as pending_stack:
            pending_stack.enter_context(self._write_lock)
            session = pending_stack.enter_context(self._session_maker())
            pending_stack.enter_context(session.begin())
            if session.get_bind().dialect.name == "sqlite":
                # SQLite legacy transaction control does not begin a transaction for
                # SAVEPOINT. An explicit outer BEGIN keeps later ownership failures
                # capable of rolling back every protected mutation.
                session.execute(sa.text("BEGIN"))
            self._exit_stack = pending_stack.pop_all()
        self._session = session
        return session

    def __exit__(
        self,
        exception_type: type[BaseException] | None,
        exception: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        exit_stack = self._exit_stack
        if exit_stack is None:
            return
        try:
            if exception_type is None:
                try:
                    self._write_lock.ensure_owned()
                except RuntimeError as ownership_error:
                    exit_stack.__exit__(type(ownership_error), ownership_error, ownership_error.__traceback__)
                    raise
            exit_stack.__exit__(exception_type, exception, traceback)
        finally:
            self._session = None
            self._exit_stack = None


class SQLAlchemyExistingSessionOrganizationWriteUnitOfWork:
    """Commit a caller-owned Session while one or more Organization leases are held."""

    def __init__(self, session: Session, write_locks: tuple[OwnedOrganizationWriteLock, ...]) -> None:
        self._session = session
        self._write_locks = write_locks
        self._exit_stack: ExitStack | None = None

    def __enter__(self) -> Session:
        if self._exit_stack is not None:
            raise RuntimeError("guarded unit of work is already active")
        with ExitStack() as pending_stack:
            for write_lock in self._write_locks:
                pending_stack.enter_context(write_lock)
            event.listen(self._session, "before_commit", self._ensure_owned_before_commit)
            self._exit_stack = pending_stack.pop_all()
        return self._session

    def __exit__(
        self,
        exception_type: type[BaseException] | None,
        exception: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        exit_stack = self._exit_stack
        if exit_stack is None:
            return
        try:
            if exception_type is None:
                self._ensure_owned_before_commit(self._session)
                self._session.commit()
            else:
                self._session.rollback()
        except BaseException as transaction_error:
            self._session.rollback()
            exit_stack.__exit__(type(transaction_error), transaction_error, transaction_error.__traceback__)
            raise
        else:
            exit_stack.__exit__(exception_type, exception, traceback)
        finally:
            event.remove(self._session, "before_commit", self._ensure_owned_before_commit)
            self._exit_stack = None

    def _ensure_owned_before_commit(self, _session: Session) -> None:
        for write_lock in self._write_locks:
            write_lock.ensure_owned()


__all__ = [
    "OwnedOrganizationWriteLock",
    "SQLAlchemyExistingSessionOrganizationWriteUnitOfWork",
    "SQLAlchemyOrganizationWriteUnitOfWork",
]
