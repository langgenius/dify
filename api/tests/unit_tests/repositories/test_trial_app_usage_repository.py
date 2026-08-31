import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from models.model import AccountTrialAppRecord
from repositories.trial_app_usage_repository import TrialAppUsageRepository


def _record(
    session_factory: sessionmaker[Session],
    *,
    app_id: str,
    account_id: str,
) -> AccountTrialAppRecord | None:
    with session_factory() as session:
        return session.scalar(
            select(AccountTrialAppRecord).where(
                AccountTrialAppRecord.app_id == app_id,
                AccountTrialAppRecord.account_id == account_id,
            )
        )


def test_record_increments_existing_usage(sqlite_session_factory: sessionmaker[Session]) -> None:
    app_id = str(uuid.uuid4())
    account_id = str(uuid.uuid4())
    with sqlite_session_factory.begin() as session:
        session.add(AccountTrialAppRecord(app_id=app_id, account_id=account_id, count=3))

    TrialAppUsageRepository(sqlite_session_factory).record(app_id=app_id, account_id=account_id)

    record = _record(sqlite_session_factory, app_id=app_id, account_id=account_id)
    assert record is not None
    assert record.count == 4


def test_record_does_not_commit_caller_session(sqlite_session_factory: sessionmaker[Session]) -> None:
    pending_app_id = str(uuid.uuid4())
    usage_app_id = str(uuid.uuid4())
    account_id = str(uuid.uuid4())

    with sqlite_session_factory() as caller_session:
        caller_session.add(AccountTrialAppRecord(app_id=pending_app_id, account_id=account_id, count=1))

        TrialAppUsageRepository(sqlite_session_factory).record(app_id=usage_app_id, account_id=account_id)

        caller_session.rollback()

    assert _record(sqlite_session_factory, app_id=pending_app_id, account_id=account_id) is None
    usage = _record(sqlite_session_factory, app_id=usage_app_id, account_id=account_id)
    assert usage is not None
    assert usage.count == 1
