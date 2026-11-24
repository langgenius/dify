"""Account onboarding writes against PostgreSQL; CI only."""

from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from threading import Barrier
from uuid import uuid4

from sqlalchemy.orm import Session, sessionmaker

from models.account import Account
from repositories.account.repository import SQLAlchemyAccountRepository


def test_concurrent_end_user_handoffs_keep_earliest_time(db_session_with_containers: Session) -> None:
    sessions = sessionmaker(bind=db_session_with_containers.get_bind())
    with sessions.begin() as session:
        account = Account(name="End User", email=f"{uuid4()}@example.com")
        session.add(account)
        account_id = account.id

    repository = SQLAlchemyAccountRepository(sessions)
    barrier = Barrier(2)

    def record(moment: datetime) -> None:
        barrier.wait(timeout=15)
        repository.record_end_user_handoff(account_id, occurred_at=moment)

    earliest = datetime(2026, 11, 24, tzinfo=UTC)
    with ThreadPoolExecutor(max_workers=2) as executor:
        list(executor.map(record, (earliest, earliest + timedelta(seconds=1)), timeout=30))
    with sessions() as session:
        assert session.get_one(Account, account_id).be_end_user_at == earliest.replace(tzinfo=None)
