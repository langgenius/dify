import base64
import json
from collections.abc import Iterator
from inspect import unwrap
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from flask import Flask
from sqlalchemy.orm import Session
from werkzeug.exceptions import BadRequest, UnprocessableEntity

from controllers.console import wraps as console_wraps
from controllers.console.billing.billing import Invoices, PartnerTenants, Subscription, SubscriptionQuery
from controllers.console.billing.error import (
    BillingOperationFailedError,
    BillingUnavailableError,
)
from enums import CloudPlan, DeploymentEdition
from machinery.context import RequestContext
from models.account import Account, Tenant, TenantAccountJoin, TenantAccountRole
from models.model import DifySetup
from services.errors.billing import (
    BillingUpstreamInvalidResponseError,
    BillingUpstreamUnavailableError,
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


@pytest.mark.parametrize(
    "sqlite_session",
    [(DifySetup, Account, Tenant, TenantAccountJoin)],
    indirect=True,
)
class TestPartnerTenants:
    """Unit tests for PartnerTenants controller."""

    @pytest.fixture
    def app(self):
        """Create Flask app for testing."""
        app = Flask(__name__)
        app.config["TESTING"] = True
        app.config["SECRET_KEY"] = "test-secret-key"
        return app

    @pytest.fixture
    def mock_account(self, sqlite_session: Session):
        """Persist an initialized account with an owner workspace membership."""
        tenant = Tenant(name="Billing Tenant")
        account = Account(name="Billing User", email="test@example.com")
        sqlite_session.add_all([tenant, account])
        sqlite_session.flush()
        sqlite_session.add_all(
            [
                TenantAccountJoin(
                    tenant_id=tenant.id,
                    account_id=account.id,
                    current=True,
                    role=TenantAccountRole.OWNER,
                    invited_by=None,
                ),
                DifySetup(version="test"),
            ]
        )
        sqlite_session.commit()
        account._current_tenant = tenant
        sqlite_session.expunge(account)
        return account

    @pytest.fixture
    def partner_tenant_bindings(self):
        service = MagicMock()
        with patch(
            "controllers.console.billing.billing.application_services",
            return_value=SimpleNamespace(partner_tenant_bindings=service),
        ):
            yield service

    @pytest.fixture
    def mock_decorators(self, monkeypatch: pytest.MonkeyPatch, sqlite_session: Session):
        """Keep authentication mocked while the setup guard uses SQLite."""
        console_wraps._is_setup_completed.reset_success()
        monkeypatch.setattr(console_wraps.db, "session", sqlite_session)
        with (
            patch("controllers.console.wraps.dify_config.DEPLOYMENT_EDITION", DeploymentEdition.CLOUD),
            patch("libs.login.dify_config.LOGIN_DISABLED", False),
            patch("libs.login.check_csrf_token") as mock_csrf,
        ):
            mock_csrf.return_value = None
            yield mock_csrf
        console_wraps._is_setup_completed.reset_success()

    def test_put_success(self, app: Flask, mock_account, partner_tenant_bindings, mock_decorators):
        """Test successful partner tenants bindings sync."""
        # Arrange
        partner_key_encoded = base64.b64encode(b"partner-key-123").decode("utf-8")
        click_id = "click-id-789"
        expected_response = {"result": "success", "data": {"synced": True}}

        partner_tenant_bindings.sync.return_value = expected_response

        with app.test_request_context(
            method="PUT",
            json={"click_id": click_id},
            path=f"/billing/partners/{partner_key_encoded}/tenants",
        ):
            with (
                patch(
                    "controllers.console.wraps.current_account_with_tenant",
                    return_value=(mock_account, mock_account.current_tenant_id),
                ),
                patch("libs.login._get_user", return_value=mock_account),
            ):
                resource = PartnerTenants()
                result = resource.put(partner_key_encoded)

        # Assert
        assert result == expected_response
        partner_tenant_bindings.sync.assert_called_once_with(
            account_id=mock_account.id,
            partner_key="partner-key-123",
            click_id=click_id,
        )

    def test_put_invalid_partner_key_base64(self, app: Flask, mock_account, partner_tenant_bindings, mock_decorators):
        """Test that invalid base64 partner_key raises BadRequest."""
        # Arrange
        invalid_partner_key = "invalid-base64-!@#$"
        click_id = "click-id-789"

        with app.test_request_context(
            method="PUT",
            json={"click_id": click_id},
            path=f"/billing/partners/{invalid_partner_key}/tenants",
        ):
            with (
                patch(
                    "controllers.console.wraps.current_account_with_tenant",
                    return_value=(mock_account, mock_account.current_tenant_id),
                ),
                patch("libs.login._get_user", return_value=mock_account),
            ):
                resource = PartnerTenants()

                # Act & Assert
                with pytest.raises(BadRequest) as exc_info:
                    resource.put(invalid_partner_key)
                assert "Invalid partner_key" in str(exc_info.value)

    def test_put_missing_click_id(self, app: Flask, mock_account, partner_tenant_bindings, mock_decorators):
        """Test that missing click_id raises UnprocessableEntity (422)."""
        # Arrange
        partner_key_encoded = base64.b64encode(b"partner-key-123").decode("utf-8")

        with app.test_request_context(
            method="PUT",
            json={},
            path=f"/billing/partners/{partner_key_encoded}/tenants",
        ):
            with (
                patch(
                    "controllers.console.wraps.current_account_with_tenant",
                    return_value=(mock_account, mock_account.current_tenant_id),
                ),
                patch("libs.login._get_user", return_value=mock_account),
            ):
                resource = PartnerTenants()

                # Act & Assert
                # Validation should raise UnprocessableEntity (422) for missing required field
                with pytest.raises(UnprocessableEntity):
                    resource.put(partner_key_encoded)

    def test_put_billing_service_json_decode_error(
        self, app: Flask, mock_account, partner_tenant_bindings, mock_decorators
    ):
        """Test handling of billing service JSON decode error.

        When billing service returns non-200 status code with invalid JSON response,
        response.json() raises JSONDecodeError. This exception propagates to the controller
        and should be handled by the global error handler (handle_general_exception),
        which returns a 500 status code with error details.

        Note: In unit tests, when directly calling resource.put(), the exception is raised
        directly. In actual Flask application, the error handler would catch it and return
        a 500 response with JSON: {"code": "unknown", "message": "...", "status": 500}
        """
        # Arrange
        partner_key_encoded = base64.b64encode(b"partner-key-123").decode("utf-8")
        click_id = "click-id-789"

        # Simulate JSON decode error when billing service returns invalid JSON
        # This happens when billing service returns non-200 with empty/invalid response body
        json_decode_error = json.JSONDecodeError("Expecting value", "", 0)
        partner_tenant_bindings.sync.side_effect = json_decode_error

        with app.test_request_context(
            method="PUT",
            json={"click_id": click_id},
            path=f"/billing/partners/{partner_key_encoded}/tenants",
        ):
            with (
                patch(
                    "controllers.console.wraps.current_account_with_tenant",
                    return_value=(mock_account, mock_account.current_tenant_id),
                ),
                patch("libs.login._get_user", return_value=mock_account),
            ):
                resource = PartnerTenants()

                # Act & Assert
                # JSONDecodeError will be raised from the controller
                # In actual Flask app, this would be caught by handle_general_exception
                # which returns: {"code": "unknown", "message": str(e), "status": 500}
                with pytest.raises(json.JSONDecodeError) as exc_info:
                    resource.put(partner_key_encoded)

                # Verify the exception is JSONDecodeError
                assert isinstance(exc_info.value, json.JSONDecodeError)
                assert "Expecting value" in str(exc_info.value)

    def test_put_empty_click_id(self, app: Flask, mock_account, partner_tenant_bindings, mock_decorators):
        """Test that empty click_id raises BadRequest."""
        # Arrange
        partner_key_encoded = base64.b64encode(b"partner-key-123").decode("utf-8")
        click_id = ""

        with app.test_request_context(
            method="PUT",
            json={"click_id": click_id},
            path=f"/billing/partners/{partner_key_encoded}/tenants",
        ):
            with (
                patch(
                    "controllers.console.wraps.current_account_with_tenant",
                    return_value=(mock_account, mock_account.current_tenant_id),
                ),
                patch("libs.login._get_user", return_value=mock_account),
            ):
                resource = PartnerTenants()

                # Act & Assert
                with pytest.raises(BadRequest) as exc_info:
                    resource.put(partner_key_encoded)
                assert "Invalid partner information" in str(exc_info.value)

    def test_put_empty_partner_key_after_decode(
        self, app: Flask, mock_account, partner_tenant_bindings, mock_decorators
    ):
        """Test that empty partner_key after decode raises BadRequest."""
        # Arrange
        # Base64 encode an empty string
        empty_partner_key_encoded = base64.b64encode(b"").decode("utf-8")
        click_id = "click-id-789"

        with app.test_request_context(
            method="PUT",
            json={"click_id": click_id},
            path=f"/billing/partners/{empty_partner_key_encoded}/tenants",
        ):
            with (
                patch(
                    "controllers.console.wraps.current_account_with_tenant",
                    return_value=(mock_account, mock_account.current_tenant_id),
                ),
                patch("libs.login._get_user", return_value=mock_account),
            ):
                resource = PartnerTenants()

                # Act & Assert
                with pytest.raises(BadRequest) as exc_info:
                    resource.put(empty_partner_key_encoded)
                assert "Invalid partner information" in str(exc_info.value)
