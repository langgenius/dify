from __future__ import annotations

from datetime import datetime
from unittest.mock import Mock, call

import pytest

from machinery.context import RequestContext
from services.account_deletion_service import AccountDeletionService
from services.account_errors import InvalidAccountDeletionVerificationError
from services.account_ports import (
    AccountDeletionScheduler,
    AccountDeletionSyncGateway,
    AccountDeletionVerificationGateway,
    AccountDeletionVerificationNotifier,
    AccountRepository,
    AccountWorkspaceMembershipQuery,
)
from services.entities.account_entities import AccountDeletionChallenge, AccountSnapshot


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
        is_password_set=True,
        interface_language="en-US",
        interface_theme="light",
        timezone="UTC",
        last_login_at=None,
        last_login_ip=None,
        status="active",
        initialized_at=datetime(2026, 1, 1),
        created_at=datetime(2026, 1, 1),
    )


def _service(*, accounts: Mock | None = None) -> tuple[AccountDeletionService, dict[str, Mock]]:
    dependencies = {
        "accounts": accounts or Mock(spec=AccountRepository),
        "memberships": Mock(spec=AccountWorkspaceMembershipQuery),
        "verification": Mock(spec=AccountDeletionVerificationGateway),
        "notifications": Mock(spec=AccountDeletionVerificationNotifier),
        "synchronization": Mock(spec=AccountDeletionSyncGateway),
        "scheduler": Mock(spec=AccountDeletionScheduler),
    }
    service = AccountDeletionService(
        accounts=dependencies["accounts"],
        memberships=dependencies["memberships"],
        verification=dependencies["verification"],
        notifications=dependencies["notifications"],
        synchronization=dependencies["synchronization"],
        scheduler=dependencies["scheduler"],
    )
    return service, dependencies


def test_issue_verification_reads_account_then_sends_challenge() -> None:
    accounts = Mock(spec=AccountRepository)
    accounts.get.return_value = _account()
    service, dependencies = _service(accounts=accounts)
    dependencies["verification"].create.return_value = AccountDeletionChallenge(token="token", code="123456")

    token = service.issue_verification(_context())

    assert token == "token"
    accounts.get.assert_called_once_with("account-1")
    dependencies["verification"].create.assert_called_once_with(
        account_id="account-1",
        email="account@example.com",
    )
    dependencies["notifications"].send.assert_called_once_with(email="account@example.com", code="123456")


def test_request_deletion_rejects_invalid_or_cross_account_verification_before_membership_read() -> None:
    service, dependencies = _service()
    dependencies["verification"].verify.return_value = False

    with pytest.raises(InvalidAccountDeletionVerificationError):
        service.request_deletion(_context(), token="token", code="wrong")

    dependencies["memberships"].list_ids_for_account.assert_not_called()
    dependencies["scheduler"].schedule.assert_not_called()


def test_request_deletion_reads_memberships_before_external_sync_and_always_schedules() -> None:
    service, dependencies = _service()
    dependencies["verification"].verify.return_value = True
    dependencies["memberships"].list_ids_for_account.return_value = ("workspace-1", "workspace-2")
    dependencies["synchronization"].sync.return_value = False
    manager = Mock()
    manager.attach_mock(dependencies["memberships"], "memberships")
    manager.attach_mock(dependencies["synchronization"], "synchronization")
    manager.attach_mock(dependencies["scheduler"], "scheduler")

    service.request_deletion(_context(), token="token", code="123456")

    dependencies["verification"].verify.assert_called_once_with(
        account_id="account-1",
        token="token",
        code="123456",
    )
    assert manager.mock_calls == [
        call.memberships.list_ids_for_account("account-1"),
        call.synchronization.sync(account_id="account-1", workspace_ids=("workspace-1", "workspace-2")),
        call.scheduler.schedule("account-1"),
    ]
