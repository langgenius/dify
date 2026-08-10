from __future__ import annotations

from datetime import datetime
from types import TracebackType
from unittest.mock import Mock

import pytest

from machinery.context import RequestContext
from services.account_ports import AccountRepository
from services.account_profile_service import (
    AccountNotFoundError,
    AccountProfileService,
    EmptyAccountProfileChangesError,
)
from services.entities.account_entities import AccountProfileChanges, AccountSnapshot


def _context() -> RequestContext:
    return RequestContext(
        request_id="request-1",
        trace_id="trace-1",
        account_id="account-1",
        active_workspace_id="workspace-1",
    )


def _account() -> AccountSnapshot:
    return AccountSnapshot(
        id="account-1",
        name="Account",
        email="account@example.com",
        avatar=None,
        is_password_set=False,
        interface_language="en-US",
        interface_theme="light",
        timezone="UTC",
        last_login_at=None,
        last_login_ip=None,
        status="active",
        initialized_at=None,
        created_at=datetime(2026, 1, 1),
    )


class _FakeAccountUnitOfWork:
    def __init__(self, accounts: Mock) -> None:
        self.accounts: AccountRepository = accounts
        self.commit_count = 0

    def __enter__(self) -> _FakeAccountUnitOfWork:
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc_value: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        return None

    def commit(self) -> None:
        self.commit_count += 1

    def rollback(self) -> None:
        return None


def test_get_returns_framework_neutral_account_snapshot() -> None:
    accounts = Mock(spec=AccountRepository)
    accounts.get.return_value = _account()
    unit_of_work = _FakeAccountUnitOfWork(accounts)
    service = AccountProfileService(unit_of_work=lambda: unit_of_work)

    result = service.get(_context())

    assert result == _account()
    accounts.get.assert_called_once_with("account-1")
    assert unit_of_work.commit_count == 0


def test_update_commits_profile_changes() -> None:
    accounts = Mock(spec=AccountRepository)
    accounts.update_profile.return_value = _account()
    unit_of_work = _FakeAccountUnitOfWork(accounts)
    service = AccountProfileService(unit_of_work=lambda: unit_of_work)
    changes = AccountProfileChanges(name="Updated", timezone="Asia/Singapore")

    result = service.update(_context(), changes)

    assert result == _account()
    accounts.update_profile.assert_called_once_with("account-1", changes)
    assert unit_of_work.commit_count == 1


def test_update_rejects_empty_changes_before_opening_unit_of_work() -> None:
    unit_of_work_factory = Mock()
    service = AccountProfileService(unit_of_work=unit_of_work_factory)

    with pytest.raises(EmptyAccountProfileChangesError):
        service.update(_context(), AccountProfileChanges())

    unit_of_work_factory.assert_not_called()


def test_update_does_not_commit_missing_account() -> None:
    accounts = Mock(spec=AccountRepository)
    accounts.update_profile.return_value = None
    unit_of_work = _FakeAccountUnitOfWork(accounts)
    service = AccountProfileService(unit_of_work=lambda: unit_of_work)

    with pytest.raises(AccountNotFoundError):
        service.update(_context(), AccountProfileChanges(name="Updated"))

    assert unit_of_work.commit_count == 0
