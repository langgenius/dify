"""Database repository for recommended trial app usage."""

from typing import override

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from models.model import AccountTrialAppRecord
from services.trial_app_usage import TrialAppUsageRecorder


class TrialAppUsageRepository(TrialAppUsageRecorder):
    def __init__(self, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

    @override
    def record(self, *, app_id: str, account_id: str) -> None:
        """Increment usage without committing the caller's request transaction."""
        with self._session_factory() as session, session.begin():
            record = session.scalar(
                select(AccountTrialAppRecord)
                .where(AccountTrialAppRecord.app_id == app_id, AccountTrialAppRecord.account_id == account_id)
                .limit(1)
            )
            if record is None:
                session.add(AccountTrialAppRecord(app_id=app_id, account_id=account_id, count=1))
            else:
                record.count += 1
