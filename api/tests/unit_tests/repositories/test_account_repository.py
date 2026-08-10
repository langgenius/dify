import pytest
from sqlalchemy.orm import Session, sessionmaker

from models.account import Account
from repositories.account_unit_of_work import SQLAlchemyAccountUnitOfWorkFactory
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


def test_unit_of_work_updates_multiple_profile_fields_atomically(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    _persist_account(sqlite_session)
    factory = SQLAlchemyAccountUnitOfWorkFactory(sqlite_session_factory)

    with factory() as unit_of_work:
        result = unit_of_work.accounts.update_profile(
            "account-1",
            AccountProfileChanges(
                name="Updated",
                avatar="avatar-file",
                interface_language="zh-Hans",
                interface_theme="dark",
                timezone="Asia/Shanghai",
            ),
        )
        unit_of_work.commit()

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


def test_unit_of_work_rolls_back_uncommitted_profile_changes(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    _persist_account(sqlite_session)
    factory = SQLAlchemyAccountUnitOfWorkFactory(sqlite_session_factory)

    def update_then_abort() -> None:
        with factory() as unit_of_work:
            unit_of_work.accounts.update_profile(
                "account-1",
                AccountProfileChanges(name="Should Roll Back"),
            )
            raise RuntimeError("abort update")

    with pytest.raises(RuntimeError, match="abort update"):
        update_then_abort()

    sqlite_session.expire_all()
    persisted = sqlite_session.get(Account, "account-1")
    assert persisted is not None
    assert persisted.name == "Original"
