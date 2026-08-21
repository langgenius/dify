from unittest.mock import MagicMock

import pytest

from services.billing_portal_service import BillingPortalService
from services.errors.billing import BillingAccessDeniedError


@pytest.fixture
def get_subscription() -> MagicMock:
    return MagicMock()


@pytest.fixture
def get_invoices() -> MagicMock:
    return MagicMock()


@pytest.fixture
def service(get_subscription: MagicMock, get_invoices: MagicMock) -> BillingPortalService:
    return BillingPortalService(get_subscription=get_subscription, get_invoices=get_invoices)


def test_get_subscription_checks_access_and_delegates(
    service: BillingPortalService,
    get_subscription: MagicMock,
) -> None:
    get_subscription.return_value = {"url": "https://billing.example.com/checkout"}

    result = service.get_subscription(
        plan="professional",
        interval="month",
        email="owner@example.com",
        workspace_id="workspace-1",
        role="owner",
    )

    assert result == {"url": "https://billing.example.com/checkout"}
    get_subscription.assert_called_once_with("professional", "month", "owner@example.com", "workspace-1")


def test_get_invoices_checks_access_and_delegates(
    service: BillingPortalService,
    get_invoices: MagicMock,
) -> None:
    get_invoices.return_value = {"url": "https://billing.example.com/portal"}

    result = service.get_invoices(
        email="admin@example.com",
        workspace_id="workspace-1",
        role="admin",
    )

    assert result == {"url": "https://billing.example.com/portal"}
    get_invoices.assert_called_once_with("admin@example.com", "workspace-1")


@pytest.mark.parametrize("role", [None, "editor", "normal", "dataset_operator"])
def test_access_denied_does_not_call_billing(
    role: str | None,
    service: BillingPortalService,
    get_invoices: MagicMock,
) -> None:
    with pytest.raises(BillingAccessDeniedError):
        service.get_invoices(email="member@example.com", workspace_id="workspace-1", role=role)

    get_invoices.assert_not_called()
