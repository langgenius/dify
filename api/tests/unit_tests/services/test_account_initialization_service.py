from __future__ import annotations

from datetime import datetime

import pytest
from pytest_mock import MockerFixture
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from machinery.context import RequestContext
from models.account import Account, AccountStatus, InvitationCode, InvitationCodeStatus
from repositories.account.repository import SQLAlchemyAccountRepository
from services.account_errors import (
    AccountAlreadyInitializedError,
    InvalidInvitationCodeError,
    MissingInvitationCodeError,
)
from services.account_initialization_service import AccountInitializationService
from services.entities.account_entities import (
    AccountInitialization,
)
from tests.unit_tests.model_factories import make_account


def _context() -> RequestContext:
    return RequestContext(
        request_id="request-1",
        trace_id="trace-1",
        account_id="account-1",
        active_workspace_id="workspace-1",
    )


@pytest.fixture
def accounts(sqlite_session_factory: sessionmaker[Session]) -> SQLAlchemyAccountRepository:
    with sqlite_session_factory.begin() as session:
        session.add(make_account(status=AccountStatus.UNINITIALIZED))
        session.add(InvitationCode(batch="test", code="invite-1"))
    return SQLAlchemyAccountRepository(sqlite_session_factory)


def test_cloud_initialization_consumes_invitation_and_updates_account_atomically(
    accounts: SQLAlchemyAccountRepository,
    sqlite_session_factory: sessionmaker[Session],
    mocker: MockerFixture,
) -> None:
    initialized_at = datetime(2026, 8, 10, 12, 0)
    initialize = mocker.spy(accounts, "initialize")
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
    initialize.assert_called_once_with(
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

    with sqlite_session_factory() as session:
        invitation = session.scalar(select(InvitationCode).where(InvitationCode.code == "invite-1"))
        account = session.get(Account, "account-1")
        assert invitation is not None
        assert account is not None
        assert invitation.status == InvitationCodeStatus.USED
        assert invitation.used_at == account.initialized_at == initialized_at
        assert invitation.used_by_account_id == account.id
        assert invitation.used_by_tenant_id == "workspace-1"
        assert account.status == AccountStatus.ACTIVE
        assert account.interface_language == "zh-Hans"
        assert account.interface_theme == "light"
        assert account.timezone == "Asia/Shanghai"


def test_cloud_initialization_rejects_missing_or_invalid_invitation(
    accounts: SQLAlchemyAccountRepository,
    mocker: MockerFixture,
) -> None:
    initialize = mocker.spy(accounts, "initialize")
    service = AccountInitializationService(
        accounts=accounts,
        invitation_required=True,
        now=lambda: datetime(2026, 8, 10),
    )

    with pytest.raises(MissingInvitationCodeError):
        service.initialize(_context(), interface_language="en-US", timezone="UTC", invitation_code=None)

    initialize.assert_not_called()
    with pytest.raises(InvalidInvitationCodeError):
        service.initialize(_context(), interface_language="en-US", timezone="UTC", invitation_code="used")

    initialize.assert_called_once()
    account = accounts.get("account-1")
    assert account is not None
    assert account.status == "uninitialized"


def test_initialization_rejects_an_active_account_before_consuming_invitation(
    accounts: SQLAlchemyAccountRepository,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with sqlite_session_factory.begin() as session:
        account = session.get(Account, "account-1")
        assert account is not None
        account.status = AccountStatus.ACTIVE
    service = AccountInitializationService(
        accounts=accounts,
        invitation_required=True,
        now=lambda: datetime(2026, 8, 10),
    )

    with pytest.raises(AccountAlreadyInitializedError):
        service.initialize(_context(), interface_language="en-US", timezone="UTC", invitation_code="invite-1")

    with sqlite_session_factory() as session:
        invitation = session.scalar(select(InvitationCode).where(InvitationCode.code == "invite-1"))
        assert invitation is not None
        assert invitation.status == InvitationCodeStatus.UNUSED
        assert invitation.used_at is None
