from __future__ import annotations

from datetime import datetime
from unittest.mock import Mock

import pytest

from machinery.context import RequestContext
from services.account_errors import AccountNotFoundError, EmptyAccountProfileChangesError
from services.account_ports import AccountRepository
from services.account_profile_service import AccountProfileService
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


def test_get_returns_framework_neutral_account_snapshot() -> None:
    accounts = Mock(spec=AccountRepository)
    accounts.get.return_value = _account()
    service = AccountProfileService(accounts=accounts)

    result = service.get(_context())

    assert result == _account()
    accounts.get.assert_called_once_with("account-1")


def test_update_applies_profile_changes() -> None:
    accounts = Mock(spec=AccountRepository)
    accounts.update_profile.return_value = _account()
    service = AccountProfileService(accounts=accounts)
    changes = AccountProfileChanges(name="Updated", timezone="Asia/Singapore")

    result = service.update(_context(), changes)

    assert result == _account()
    accounts.update_profile.assert_called_once_with("account-1", changes)


def test_update_rejects_empty_changes_before_calling_repository() -> None:
    accounts = Mock(spec=AccountRepository)
    service = AccountProfileService(accounts=accounts)

    with pytest.raises(EmptyAccountProfileChangesError):
        service.update(_context(), AccountProfileChanges())

    accounts.update_profile.assert_not_called()


def test_update_rejects_missing_account() -> None:
    accounts = Mock(spec=AccountRepository)
    accounts.update_profile.return_value = None
    service = AccountProfileService(accounts=accounts)
    changes = AccountProfileChanges(name="Updated")

    with pytest.raises(AccountNotFoundError):
        service.update(_context(), changes)

    accounts.update_profile.assert_called_once_with("account-1", changes)
