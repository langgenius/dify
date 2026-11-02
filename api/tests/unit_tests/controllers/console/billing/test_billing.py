from collections.abc import Iterator
from inspect import unwrap
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from flask import Flask

from controllers.console.billing.billing import Invoices, Subscription, SubscriptionQuery
from controllers.console.billing.error import (
    BillingOperationFailedError,
    BillingUnavailableError,
)
from enums import CloudPlan
from machinery.context import RequestContext
from services.billing_client import billing
from services.errors.billing import (
    UnknownErrorReason,
)


class TestBillingPortal:
    @pytest.fixture
    def app(self) -> Flask:
        app = Flask(__name__)
        app.config["TESTING"] = True
        return app

    @pytest.fixture
    def request_context(self) -> RequestContext:
        return RequestContext(
            request_id="request-1",
            trace_id="trace-1",
            account_id="account-1",
            active_workspace_id="tenant-1",
        )

    @pytest.fixture
    def billing_portal(self) -> MagicMock:
        return MagicMock()

    @pytest.fixture(autouse=True)
    def mock_application_services(self, billing_portal: MagicMock) -> Iterator[None]:
        with patch(
            "controllers.console.billing.billing.application_services",
            return_value=SimpleNamespace(billing_portal=billing_portal),
        ):
            yield

    def test_get_subscription_uses_admission_context_and_response_contract(
        self,
        app: Flask,
        request_context: RequestContext,
        billing_portal: MagicMock,
    ) -> None:
        resource = Subscription()
        method = unwrap(resource.get)
        query = SubscriptionQuery(plan=CloudPlan.PROFESSIONAL, interval="month")
        billing_portal.get_subscription.return_value = billing.GetSubscriptionPaymentLinkReply(
            url="https://billing.example.com/checkout"
        )

        with app.test_request_context("/billing/subscription"):
            result = method(resource, query, request_context)

        billing_portal.get_subscription.assert_called_once_with(
            request_context,
            plan=CloudPlan.PROFESSIONAL,
            interval="month",
        )
        assert result == {"url": "https://billing.example.com/checkout"}

    def test_get_invoices_uses_admission_context_and_response_contract(
        self,
        app: Flask,
        request_context: RequestContext,
        billing_portal: MagicMock,
    ) -> None:
        resource = Invoices()
        method = unwrap(resource.get)
        billing_portal.get_invoices.return_value = billing.GetInvoicesReply(url="https://billing.example.com/portal")

        with app.test_request_context("/billing/invoices"):
            result = method(resource, request_context)

        billing_portal.get_invoices.assert_called_once_with(request_context)
        assert result == {"url": "https://billing.example.com/portal"}

    def test_get_invoices_translates_unavailable_operation(
        self,
        app: Flask,
        request_context: RequestContext,
        billing_portal: MagicMock,
    ) -> None:
        resource = Invoices()
        method = unwrap(resource.get)
        billing_portal.get_invoices.side_effect = billing.BillingInvoiceUpstreamUnavailableError

        with app.test_request_context("/billing/invoices"):
            with pytest.raises(BillingUnavailableError) as exc_info:
                method(resource, request_context)

        assert exc_info.value.data == {
            "code": "billing_unavailable",
            "message": "This operation is temporarily unavailable. Please try again later.",
            "status": 503,
        }

    def test_get_subscription_translates_invalid_upstream_response(
        self,
        app: Flask,
        request_context: RequestContext,
        billing_portal: MagicMock,
    ) -> None:
        resource = Subscription()
        method = unwrap(resource.get)
        query = SubscriptionQuery(plan=CloudPlan.PROFESSIONAL, interval="month")
        billing_portal.get_subscription.side_effect = billing.BillingSubscriptionUpstreamInvalidResponseError

        with app.test_request_context("/billing/subscription"):
            with pytest.raises(BillingOperationFailedError) as exc_info:
                method(resource, query, request_context)

        assert exc_info.value.data == {
            "code": "billing_operation_failed",
            "message": "We couldn't complete this request. Please try again. If the problem persists, contact support.",
            "status": 502,
        }

    @pytest.mark.parametrize(
        ("error", "expected"),
        [
            (
                billing.BillingSubscriptionUpstreamInvalidResponseError(status_code=400, reason="MISSING_PLAN"),
                BillingOperationFailedError,
            ),
            (
                billing.BillingSubscriptionUpstreamUnavailableError(
                    status_code=500, reason="CREATE_SUBSCRIPTION_PAYMENT_LINK_FAILED"
                ),
                BillingUnavailableError,
            ),
            (
                billing.BillingSubscriptionUpstreamUnavailableError(status_code=429, reason="REQUEST_IN_PROGRESS"),
                BillingUnavailableError,
            ),
            (
                billing.BillingSubscriptionUpstreamInvalidResponseError(
                    status_code=409, reason=UnknownErrorReason("PLAN_SHIPPED_LATER")
                ),
                BillingOperationFailedError,
            ),
            (
                billing.BillingSubscriptionUpstreamUnavailableError(
                    status_code=503, reason=UnknownErrorReason("PLAN_SHIPPED_LATER")
                ),
                BillingUnavailableError,
            ),
            (billing.BillingSubscriptionUpstreamInvalidResponseError(status_code=400), BillingOperationFailedError),
            (billing.BillingSubscriptionUpstreamUnavailableError(), BillingUnavailableError),
        ],
    )
    def test_get_subscription_maps_every_reason_to_a_generic_billing_error(
        self,
        app: Flask,
        request_context: RequestContext,
        billing_portal: MagicMock,
        error: billing.BillingSubscriptionUpstreamError,
        expected: type[Exception],
    ) -> None:
        resource = Subscription()
        billing_portal.get_subscription.side_effect = error

        with app.test_request_context("/billing/subscription"), pytest.raises(expected) as exc_info:
            unwrap(resource.get)(
                resource, SubscriptionQuery(plan=CloudPlan.PROFESSIONAL, interval="month"), request_context
            )

        assert exc_info.value.__cause__ is error

    @pytest.mark.parametrize(
        ("error", "expected"),
        [
            (
                billing.BillingInvoiceUpstreamInvalidResponseError(status_code=400, reason="INVALID_INVOICE_REQUEST"),
                BillingOperationFailedError,
            ),
            (
                billing.BillingInvoiceUpstreamUnavailableError(status_code=500, reason="CREATE_INVOICE_PORTAL_FAILED"),
                BillingUnavailableError,
            ),
            (
                billing.BillingInvoiceUpstreamInvalidResponseError(
                    status_code=409, reason=UnknownErrorReason("INVOICE_SHIPPED_LATER")
                ),
                BillingOperationFailedError,
            ),
            (billing.BillingInvoiceUpstreamUnavailableError(status_code=502), BillingUnavailableError),
        ],
    )
    def test_get_invoices_maps_every_reason_to_a_generic_billing_error(
        self,
        app: Flask,
        request_context: RequestContext,
        billing_portal: MagicMock,
        error: billing.BillingInvoiceUpstreamError,
        expected: type[Exception],
    ) -> None:
        resource = Invoices()
        billing_portal.get_invoices.side_effect = error

        with app.test_request_context("/billing/invoices"), pytest.raises(expected) as exc_info:
            unwrap(resource.get)(resource, request_context)

        assert exc_info.value.__cause__ is error
