from unittest.mock import MagicMock

import pytest
from pytest_mock import MockerFixture
from sqlalchemy.orm import Session, sessionmaker

from machinery.context import RequestContext
from models.account import Account
from repositories.account.repository import SQLAlchemyAccountRepository
from services.account_errors import AccountNotFoundError
from services.billing_portal_service import BillingPortalService
from tests.unit_tests.model_factories import make_account


def _context() -> RequestContext:
    return RequestContext(
        request_id="request-1",
        trace_id="trace-1",
        account_id="account-1",
        active_workspace_id="workspace-1",
    )


@pytest.fixture
def get_subscription() -> MagicMock:
    return MagicMock()


@pytest.fixture
def get_invoices() -> MagicMock:
    return MagicMock()


@pytest.fixture
def accounts(sqlite_session_factory: sessionmaker[Session]) -> SQLAlchemyAccountRepository:
    with sqlite_session_factory.begin() as session:
        session.add(make_account(email="owner@example.com"))
    return SQLAlchemyAccountRepository(sqlite_session_factory)


@pytest.fixture
def service(
    accounts: SQLAlchemyAccountRepository, get_subscription: MagicMock, get_invoices: MagicMock
) -> BillingPortalService:
    return BillingPortalService(accounts=accounts, get_subscription=get_subscription, get_invoices=get_invoices)


def test_get_subscription_loads_email_and_delegates(
    service: BillingPortalService,
    accounts: SQLAlchemyAccountRepository,
    get_subscription: MagicMock,
    mocker: MockerFixture,
) -> None:
    lookup = mocker.spy(accounts, "get")
    get_subscription.return_value = {"url": "https://billing.example.com/checkout"}

    result = service.get_subscription(
        _context(),
        plan="professional",
        interval="month",
    )

    assert result == {"url": "https://billing.example.com/checkout"}
    lookup.assert_called_once_with("account-1")
    get_subscription.assert_called_once_with("professional", "month", "owner@example.com", "workspace-1")


def test_get_invoices_loads_email_and_delegates(
    service: BillingPortalService,
    accounts: SQLAlchemyAccountRepository,
    get_invoices: MagicMock,
    mocker: MockerFixture,
) -> None:
    lookup = mocker.spy(accounts, "get")
    get_invoices.return_value = {"url": "https://billing.example.com/portal"}

    result = service.get_invoices(_context())

    assert result == {"url": "https://billing.example.com/portal"}
    lookup.assert_called_once_with("account-1")
    get_invoices.assert_called_once_with("owner@example.com", "workspace-1")


def test_missing_account_does_not_call_billing(
    service: BillingPortalService,
    sqlite_session_factory: sessionmaker[Session],
    get_invoices: MagicMock,
) -> None:
    with sqlite_session_factory.begin() as session:
        account = session.get(Account, "account-1")
        assert account is not None
        session.delete(account)

    with pytest.raises(AccountNotFoundError):
        service.get_invoices(_context())

    get_invoices.assert_not_called()
