"""SQLite behavior tests for Organization-guarded caller-owned sessions."""

from __future__ import annotations

from types import TracebackType

import pytest
import sqlalchemy as sa
from sqlalchemy import Engine
from sqlalchemy.orm import Session

from repositories.human_input_v2.organization_write_unit_of_work import (
    SQLAlchemyExistingSessionOrganizationWriteUnitOfWork,
)


class _OwnershipLostError(RuntimeError):
    pass


class _WriteLock:
    def __init__(self, *, ownership_lost: bool = False) -> None:
        self._ownership_lost = ownership_lost
        self.events: list[str] = []

    def __enter__(self) -> _WriteLock:
        self.events.append("enter")
        return self

    def __exit__(
        self,
        exception_type: type[BaseException] | None,
        exception: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        del exception, traceback
        self.events.append(f"exit:{exception_type.__name__ if exception_type is not None else 'none'}")

    def ensure_owned(self) -> None:
        self.events.append("ensure_owned")
        if self._ownership_lost:
            raise _OwnershipLostError("Organization write lock ownership was lost")

    def extend(self) -> None:
        pass


def _records_table(sqlite_engine: Engine) -> sa.Table:
    metadata = sa.MetaData()
    records = sa.Table(
        "organization_write_unit_of_work_records",
        metadata,
        sa.Column("id", sa.Integer, primary_key=True),
    )
    metadata.create_all(sqlite_engine)
    return records


def _insert_then_reject(session: Session, records: sa.Table, write_lock: _WriteLock) -> None:
    with SQLAlchemyExistingSessionOrganizationWriteUnitOfWork(session, (write_lock,)):
        session.execute(sa.insert(records).values(id=1))
        raise ValueError("reject protected write")


def test_existing_session_unit_of_work_checks_ownership_and_commits(sqlite_engine: Engine) -> None:
    records = _records_table(sqlite_engine)
    write_lock = _WriteLock()

    with Session(sqlite_engine) as session:
        with SQLAlchemyExistingSessionOrganizationWriteUnitOfWork(session, (write_lock,)):
            session.execute(sa.insert(records).values(id=1))

    with sqlite_engine.connect() as connection:
        assert connection.scalar(sa.select(sa.func.count()).select_from(records)) == 1
    assert write_lock.events == ["enter", "ensure_owned", "ensure_owned", "exit:none"]


def test_existing_session_unit_of_work_rolls_back_caller_failure(sqlite_engine: Engine) -> None:
    records = _records_table(sqlite_engine)
    write_lock = _WriteLock()

    with Session(sqlite_engine) as session:
        with pytest.raises(ValueError, match="reject protected write"):
            _insert_then_reject(session, records, write_lock)

    with sqlite_engine.connect() as connection:
        assert connection.scalar(sa.select(sa.func.count()).select_from(records)) == 0
    assert write_lock.events == ["enter", "exit:ValueError"]


def test_existing_session_unit_of_work_rolls_back_ownership_loss(sqlite_engine: Engine) -> None:
    records = _records_table(sqlite_engine)
    write_lock = _WriteLock(ownership_lost=True)

    with Session(sqlite_engine) as session:
        with pytest.raises(_OwnershipLostError, match="ownership was lost"):
            with SQLAlchemyExistingSessionOrganizationWriteUnitOfWork(session, (write_lock,)):
                session.execute(sa.insert(records).values(id=1))

    with sqlite_engine.connect() as connection:
        assert connection.scalar(sa.select(sa.func.count()).select_from(records)) == 0
    assert write_lock.events == ["enter", "ensure_owned", "exit:_OwnershipLostError"]
