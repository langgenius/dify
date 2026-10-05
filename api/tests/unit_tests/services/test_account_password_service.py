from __future__ import annotations

import pytest
from pytest_mock import MockerFixture
from sqlalchemy.orm import Session, sessionmaker

from machinery.context import RequestContext
from repositories.account.repository import SQLAlchemyAccountRepository
from services.account_errors import AccountNotFoundError, CurrentAccountPasswordIncorrectError
from services.account_password_hasher import DefaultAccountPasswordHasher
from services.account_password_service import AccountPasswordService
from services.entities.account_entities import AccountPasswordDigest
from tests.unit_tests.model_factories import make_account


def _context() -> RequestContext:
    return RequestContext(
        request_id="request-1", trace_id="trace-1", account_id="account-1", active_workspace_id="workspace-1"
    )


def _accounts(
    session_factory: sessionmaker[Session], password: AccountPasswordDigest | None
) -> SQLAlchemyAccountRepository:
    """Persist an account; None means the account has not set a password."""
    account = make_account()
    if password is not None:
        account.password = password.password_hash
        account.password_salt = password.password_salt
    with session_factory.begin() as session:
        session.add(account)
    return SQLAlchemyAccountRepository(session_factory)


def test_change_verifies_current_password_and_updates_digest(
    sqlite_session_factory: sessionmaker[Session], mocker: MockerFixture
) -> None:
    passwords = DefaultAccountPasswordHasher()
    old_digest = passwords.hash("old-password1")
    accounts = _accounts(sqlite_session_factory, old_digest)
    verify = mocker.spy(passwords, "verify")
    hash_password = mocker.spy(passwords, "hash")
    update = mocker.spy(accounts, "update_password")
    service = AccountPasswordService(accounts=accounts, passwords=passwords)

    result = service.change(_context(), current_password="old-password1", new_password="new-password1")

    assert result.id == "account-1"
    assert result.is_password_set
    verify.assert_called_once_with(
        "old-password1", password_hash=old_digest.password_hash, password_salt=old_digest.password_salt
    )
    hash_password.assert_called_once_with("new-password1")
    update.assert_called_once_with("account-1", hash_password.spy_return)
    credentials = accounts.get_credentials("account-1")
    assert credentials is not None
    assert credentials.password_hash is not None
    assert credentials.password_salt is not None
    assert passwords.verify(
        "new-password1", password_hash=credentials.password_hash, password_salt=credentials.password_salt
    )
    assert credentials.password_hash != old_digest.password_hash


def test_change_rejects_incorrect_current_password_without_hashing_or_update(
    sqlite_session_factory: sessionmaker[Session], mocker: MockerFixture
) -> None:
    passwords = DefaultAccountPasswordHasher()
    accounts = _accounts(sqlite_session_factory, passwords.hash("old-password1"))
    previous = accounts.get_credentials("account-1")
    hash_password = mocker.spy(passwords, "hash")
    update = mocker.spy(accounts, "update_password")
    service = AccountPasswordService(accounts=accounts, passwords=passwords)

    with pytest.raises(CurrentAccountPasswordIncorrectError):
        service.change(_context(), current_password="wrong", new_password="new-password1")

    hash_password.assert_not_called()
    update.assert_not_called()
    assert accounts.get_credentials("account-1") == previous


def test_change_does_not_verify_current_password_when_account_has_no_password(
    sqlite_session_factory: sessionmaker[Session], mocker: MockerFixture
) -> None:
    accounts = _accounts(sqlite_session_factory, None)
    passwords = DefaultAccountPasswordHasher()
    verify = mocker.spy(passwords, "verify")
    update = mocker.spy(accounts, "update_password")
    service = AccountPasswordService(accounts=accounts, passwords=passwords)

    service.change(_context(), current_password="", new_password="new-password1")

    verify.assert_not_called()
    update.assert_called_once()
    account = accounts.get("account-1")
    assert account is not None
    assert account.is_password_set


def test_change_reports_missing_account(sqlite_session_factory: sessionmaker[Session], mocker: MockerFixture) -> None:
    accounts = SQLAlchemyAccountRepository(sqlite_session_factory)
    passwords = DefaultAccountPasswordHasher()
    hash_password = mocker.spy(passwords, "hash")
    service = AccountPasswordService(accounts=accounts, passwords=passwords)

    with pytest.raises(AccountNotFoundError):
        service.change(_context(), current_password="old", new_password="new-password1")

    hash_password.assert_not_called()
