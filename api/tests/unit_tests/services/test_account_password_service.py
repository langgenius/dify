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
from tests.unit_tests.account_domain import FakeAccountSessions
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
    sessions = FakeAccountSessions()
    service = AccountPasswordService(accounts=accounts, passwords=passwords, sessions=sessions)

    result = service.change(
        _context(), current_password="old-password1", new_password="new-password1", refresh_token=None
    )

    assert sessions.account_ids == ["account-1", "account-1"]
    assert result.account.id == "account-1"
    assert result.account.is_password_set
    assert result.session is None
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
    sessions = FakeAccountSessions()
    service = AccountPasswordService(accounts=accounts, passwords=passwords, sessions=sessions)

    with pytest.raises(CurrentAccountPasswordIncorrectError):
        service.change(_context(), current_password="wrong", new_password="new-password1", refresh_token=None)

    hash_password.assert_not_called()
    update.assert_not_called()
    assert sessions.account_ids == []
    assert accounts.get_credentials("account-1") == previous


def test_change_does_not_verify_current_password_when_account_has_no_password(
    sqlite_session_factory: sessionmaker[Session], mocker: MockerFixture
) -> None:
    accounts = _accounts(sqlite_session_factory, None)
    passwords = DefaultAccountPasswordHasher()
    verify = mocker.spy(passwords, "verify")
    update = mocker.spy(accounts, "update_password")
    sessions = FakeAccountSessions()
    service = AccountPasswordService(accounts=accounts, passwords=passwords, sessions=sessions)

    service.change(_context(), current_password="", new_password="new-password1", refresh_token=None)

    verify.assert_not_called()
    update.assert_called_once()
    assert sessions.account_ids == ["account-1", "account-1"]
    account = accounts.get("account-1")
    assert account is not None
    assert account.is_password_set


def test_change_reports_missing_account(sqlite_session_factory: sessionmaker[Session], mocker: MockerFixture) -> None:
    accounts = SQLAlchemyAccountRepository(sqlite_session_factory)
    passwords = DefaultAccountPasswordHasher()
    hash_password = mocker.spy(passwords, "hash")
    sessions = FakeAccountSessions()
    service = AccountPasswordService(accounts=accounts, passwords=passwords, sessions=sessions)

    with pytest.raises(AccountNotFoundError):
        service.change(_context(), current_password="old", new_password="new-password1", refresh_token=None)

    hash_password.assert_not_called()
    assert sessions.account_ids == []


@pytest.mark.parametrize("fail_on_call", [1, 2])
def test_change_rejects_session_store_failure_around_password_commit(
    sqlite_session_factory: sessionmaker[Session], fail_on_call: int
) -> None:
    passwords = DefaultAccountPasswordHasher()
    accounts = _accounts(sqlite_session_factory, passwords.hash("old-password1"))
    previous = accounts.get_credentials("account-1")
    sessions = FakeAccountSessions(fail_on_call=fail_on_call)
    service = AccountPasswordService(accounts=accounts, passwords=passwords, sessions=sessions)

    with pytest.raises(RuntimeError, match="Session storage unavailable"):
        service.change(_context(), current_password="old-password1", new_password="new-password1", refresh_token=None)

    assert sessions.account_ids == ["account-1"] * fail_on_call
    assert (accounts.get_credentials("account-1") == previous) is (fail_on_call == 1)


@pytest.mark.parametrize("presented", ["caller", "other-account", "unknown", "none"])
def test_change_revokes_every_session_and_replaces_only_a_recognized_caller_session(
    sqlite_session_factory: sessionmaker[Session], presented: str
) -> None:
    passwords = DefaultAccountPasswordHasher()
    accounts = _accounts(sqlite_session_factory, passwords.hash("old-password1"))
    sessions = FakeAccountSessions()
    caller = sessions.issue("account-1")
    other_device = sessions.issue("account-1")
    other_account = sessions.issue("account-2")
    refresh_token = {
        "caller": caller.refresh_token,
        "other-account": other_account.refresh_token,
        "unknown": "unknown-refresh-token",
        "none": None,
    }[presented]
    service = AccountPasswordService(accounts=accounts, passwords=passwords, sessions=sessions)

    result = service.change(
        _context(), current_password="old-password1", new_password="new-password1", refresh_token=refresh_token
    )

    assert sessions.resolve_refresh_token(caller.refresh_token) is None
    assert sessions.resolve_refresh_token(other_device.refresh_token) is None
    assert sessions.resolve_refresh_token(other_account.refresh_token) == "account-2"
    if presented == "caller":
        assert result.session is not None
        assert sessions.resolve_refresh_token(result.session.refresh_token) == "account-1"
    else:
        assert result.session is None
