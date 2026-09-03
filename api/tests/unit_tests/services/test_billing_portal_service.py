from datetime import datetime
from unittest.mock import MagicMock, Mock

import pytest

from machinery.context import RequestContext
from services.account_errors import AccountNotFoundError
from services.account_ports import AccountRepository
from services.billing_portal_service import BillingPortalService
from services.entities.account_entities import AccountSnapshot


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
        email="owner@example.com",
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


@pytest.fixture
def get_subscription() -> MagicMock:
    return MagicMock()


@pytest.fixture
def get_invoices() -> MagicMock:
    return MagicMock()


@pytest.fixture
def accounts() -> Mock:
    accounts = Mock(spec=AccountRepository)
    accounts.get.return_value = _account()
    return accounts


@pytest.fixture
def service(accounts: Mock, get_subscription: MagicMock, get_invoices: MagicMock) -> BillingPortalService:
    return BillingPortalService(accounts=accounts, get_subscription=get_subscription, get_invoices=get_invoices)


def test_get_subscription_loads_email_and_delegates(
    service: BillingPortalService,
    accounts: Mock,
    get_subscription: MagicMock,
) -> None:
    get_subscription.return_value = {"url": "https://billing.example.com/checkout"}

    result = service.get_subscription(
        _context(),
        plan="professional",
        interval="month",
    )

    assert result == {"url": "https://billing.example.com/checkout"}
    accounts.get.assert_called_once_with("account-1")
    get_subscription.assert_called_once_with("professional", "month", "owner@example.com", "workspace-1")


def test_get_invoices_loads_email_and_delegates(
    service: BillingPortalService,
    accounts: Mock,
    get_invoices: MagicMock,
) -> None:
    get_invoices.return_value = {"url": "https://billing.example.com/portal"}

    result = service.get_invoices(_context())

    assert result == {"url": "https://billing.example.com/portal"}
    accounts.get.assert_called_once_with("account-1")
    get_invoices.assert_called_once_with("owner@example.com", "workspace-1")


def test_missing_account_does_not_call_billing(
    service: BillingPortalService,
    accounts: Mock,
    get_invoices: MagicMock,
) -> None:
    accounts.get.return_value = None

    with pytest.raises(AccountNotFoundError):
        service.get_invoices(_context())

    get_invoices.assert_not_called()
