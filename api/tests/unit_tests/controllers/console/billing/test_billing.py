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
    TokenerEducationCheckoutUnsupportedHTTPError,
)
from enums import CloudPlan
from machinery.context import RequestContext
from services.errors.billing import (
    BillingUpstreamInvalidResponseError,
    BillingUpstreamUnavailableError,
    TokenerEducationCheckoutUnsupportedError,
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
        billing_portal.get_subscription.return_value = {"url": "https://billing.example.com/checkout"}

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
        billing_portal.get_invoices.return_value = {"url": "https://billing.example.com/portal"}

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
        billing_portal.get_invoices.side_effect = BillingUpstreamUnavailableError

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
        billing_portal.get_subscription.side_effect = BillingUpstreamInvalidResponseError

        with app.test_request_context("/billing/subscription"):
            with pytest.raises(BillingOperationFailedError) as exc_info:
                method(resource, query, request_context)

        assert exc_info.value.data == {
            "code": "billing_operation_failed",
            "message": "We couldn't complete this request. Please try again. If the problem persists, contact support.",
            "status": 502,
        }

    def test_get_subscription_exposes_clear_tokener_education_error(
        self,
        app: Flask,
        request_context: RequestContext,
        billing_portal: MagicMock,
    ) -> None:
        resource = Subscription()
        method = unwrap(resource.get)
        query = SubscriptionQuery(plan=CloudPlan.PROFESSIONAL, interval="year")
        billing_portal.get_subscription.side_effect = TokenerEducationCheckoutUnsupportedError

        with app.test_request_context("/billing/subscription"):
            with pytest.raises(TokenerEducationCheckoutUnsupportedHTTPError) as exc_info:
                method(resource, query, request_context)

        assert exc_info.value.data == {
            "code": "tokener_education_checkout_unsupported",
            "message": "Education subscriptions are not supported with Tokener billing.",
            "status": 409,
        }
