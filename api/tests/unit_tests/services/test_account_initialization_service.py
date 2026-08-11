from __future__ import annotations

from datetime import datetime
from unittest.mock import Mock

import pytest

from machinery.context import RequestContext
from machinery.errors import ActiveWorkspaceRequiredError
from services.account_errors import (
    AccountAlreadyInitializedError,
    InvalidInvitationCodeError,
    MissingInvitationCodeError,
)
from services.account_initialization_service import AccountInitializationService
from services.account_ports import AccountRepository
from services.entities.account_entities import (
    AccountInitialization,
    AccountInitializationResult,
    AccountInitializationStatus,
    AccountSnapshot,
)


def _context() -> RequestContext:
    return RequestContext(
        request_id="request-1",
        trace_id="trace-1",
        account_id="account-1",
        active_workspace_id="workspace-1",
    )


def _account(*, status: str = "uninitialized") -> AccountSnapshot:
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
        status=status,
        initialized_at=None,
        created_at=datetime(2026, 1, 1),
    )


def test_cloud_initialization_consumes_invitation_and_updates_account_atomically() -> None:
    initialized_at = datetime(2026, 8, 10, 12, 0)
    accounts = Mock(spec=AccountRepository)
    accounts.initialize.return_value = AccountInitializationResult(
        status=AccountInitializationStatus.INITIALIZED,
        account=_account(status="active"),
    )
    service = AccountInitializationService(
        accounts=accounts,
        invitation_required=True,
        now=lambda: initialized_at,
    )

    result = service.initialize(
        _context(),
        interface_language="zh-Hans",
        timezone="Asia/Shanghai",
        invitation_code="invite-1",
    )

    assert result.status == "active"
    accounts.initialize.assert_called_once_with(
        "account-1",
        AccountInitialization(
            interface_language="zh-Hans",
            interface_theme="light",
            timezone="Asia/Shanghai",
            initialized_at=initialized_at,
        ),
        invitation_code="invite-1",
        workspace_id="workspace-1",
    )


def test_cloud_initialization_rejects_missing_or_invalid_invitation() -> None:
    accounts = Mock(spec=AccountRepository)
    service = AccountInitializationService(
        accounts=accounts,
        invitation_required=True,
        now=lambda: datetime(2026, 8, 10),
    )

    with pytest.raises(MissingInvitationCodeError):
        service.initialize(_context(), interface_language="en-US", timezone="UTC", invitation_code=None)

    accounts.initialize.return_value = AccountInitializationResult(
        status=AccountInitializationStatus.INVALID_INVITATION
    )
    with pytest.raises(InvalidInvitationCodeError):
        service.initialize(_context(), interface_language="en-US", timezone="UTC", invitation_code="used")

    accounts.initialize.assert_called_once()


def test_cloud_initialization_requires_admitted_workspace() -> None:
    accounts = Mock(spec=AccountRepository)
    service = AccountInitializationService(
        accounts=accounts,
        invitation_required=True,
        now=lambda: datetime(2026, 8, 10),
    )
    context = RequestContext(
        request_id="request-1",
        trace_id="trace-1",
        account_id="account-1",
        active_workspace_id=None,
    )

    with pytest.raises(ActiveWorkspaceRequiredError):
        service.initialize(context, interface_language="en-US", timezone="UTC", invitation_code="invite")

    accounts.initialize.assert_not_called()


def test_initialization_rejects_an_active_account_before_consuming_invitation() -> None:
    accounts = Mock(spec=AccountRepository)
    accounts.initialize.return_value = AccountInitializationResult(
        status=AccountInitializationStatus.ALREADY_INITIALIZED
    )
    service = AccountInitializationService(
        accounts=accounts,
        invitation_required=True,
        now=lambda: datetime(2026, 8, 10),
    )

    with pytest.raises(AccountAlreadyInitializedError):
        service.initialize(_context(), interface_language="en-US", timezone="UTC", invitation_code="invite")
