from datetime import datetime

from sqlalchemy.orm import Session, sessionmaker

from models.account import Account, AccountStatus
from repositories.account_query_repository import AccountQueryRepository
from services.entities.account_entities import AccountProfile


def test_get_profile_projects_only_shared_account_state(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    account = Account(name="User", email="user@example.com", status=AccountStatus.ACTIVE)
    account.id = "account-1"
    account.interface_language = "zh-Hans"
    account.initialized_at = datetime(2026, 6, 28)
    with sqlite_session_factory() as session:
        session.add(account)
        session.commit()
        created_at = account.created_at

    result = AccountQueryRepository(sqlite_session_factory).get_profile(account.id)

    assert result == AccountProfile(
        id="account-1",
        interface_language="zh-Hans",
        initialized_at=datetime(2026, 6, 28),
        created_at=created_at,
    )


def test_get_profile_returns_none_for_unknown_account(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    assert AccountQueryRepository(sqlite_session_factory).get_profile("missing") is None
