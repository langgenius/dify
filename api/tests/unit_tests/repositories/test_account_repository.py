import pytest
from sqlalchemy.orm import Session, sessionmaker

from models.account import Account
from repositories.account_repository import SQLAlchemyAccountRepository
from services.entities.account_entities import AccountProfileChanges


def _persist_account(session: Session) -> Account:
    account = Account(name="Original", email="account@example.com")
    account.id = "account-1"
    account.interface_language = "en-US"
    account.interface_theme = "light"
    account.timezone = "UTC"
    session.add(account)
    session.commit()
    return account


def test_update_profile_persists_multiple_fields(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    _persist_account(sqlite_session)
    repository = SQLAlchemyAccountRepository(sqlite_session_factory)

    result = repository.update_profile(
        "account-1",
        AccountProfileChanges(
            name="Updated",
            avatar="avatar-file",
            interface_language="zh-Hans",
            interface_theme="dark",
            timezone="Asia/Shanghai",
        ),
    )

    assert result is not None
    assert result.name == "Updated"
    sqlite_session.expire_all()
    persisted = sqlite_session.get(Account, "account-1")
    assert persisted is not None
    assert persisted.name == "Updated"
    assert persisted.avatar == "avatar-file"
    assert persisted.interface_language == "zh-Hans"
    assert persisted.interface_theme == "dark"
    assert persisted.timezone == "Asia/Shanghai"


def test_update_profile_rolls_back_on_error(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _persist_account(sqlite_session)
    repository = SQLAlchemyAccountRepository(sqlite_session_factory)

    def fail_to_create_snapshot(_account: Account) -> None:
        raise RuntimeError("abort update")

    monkeypatch.setattr(SQLAlchemyAccountRepository, "_to_snapshot", staticmethod(fail_to_create_snapshot))

    with pytest.raises(RuntimeError, match="abort update"):
        repository.update_profile(
            "account-1",
            AccountProfileChanges(name="Should Roll Back"),
        )

    sqlite_session.expire_all()
    persisted = sqlite_session.get(Account, "account-1")
    assert persisted is not None
    assert persisted.name == "Original"
