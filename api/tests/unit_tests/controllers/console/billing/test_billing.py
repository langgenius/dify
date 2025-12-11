import base64
import json
from unittest.mock import MagicMock, patch

import pytest
from flask import Flask
from werkzeug.exceptions import BadRequest

from controllers.console.billing.billing import PartnerTenants
from models.account import Account


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
    def mock_account(self):
        """Create a mock account."""
        account = MagicMock(spec=Account)
        account.id = "account-123"
        account.email = "test@example.com"
        account.current_tenant_id = "tenant-456"
        account.is_authenticated = True
        return account

    @pytest.fixture
    def mock_billing_service(self):
        """Mock BillingService."""
        with patch("controllers.console.billing.billing.BillingService") as mock_service:
            yield mock_service

    @pytest.fixture
    def mock_decorators(self):
        """Mock decorators to avoid database access."""
        with (
            patch("controllers.console.wraps.db") as mock_db,
            patch("controllers.console.wraps.dify_config.EDITION", "CLOUD"),
            patch("libs.login.dify_config.LOGIN_DISABLED", False),
            patch("libs.login.check_csrf_token") as mock_csrf,
        ):
            mock_db.session.query.return_value.first.return_value = MagicMock()  # Mock setup exists
            mock_csrf.return_value = None
            yield {"db": mock_db, "csrf": mock_csrf}

    def test_put_success(self, app, mock_account, mock_billing_service, mock_decorators):
        """Test successful partner tenants bindings sync."""
        # Arrange
        partner_key_encoded = base64.b64encode(b"partner-key-123").decode("utf-8")
        click_id = "click-id-789"
        expected_response = {"result": "success", "data": {"synced": True}}

        mock_billing_service.sync_partner_tenants_bindings.return_value = expected_response

        with app.test_request_context(
            method="PUT",
            json={"click_id": click_id},
            path=f"/billing/partners/{partner_key_encoded}/tenants",
        ):
            with (
                patch(
                    "controllers.console.billing.billing.current_account_with_tenant",
                    return_value=(mock_account, "tenant-456"),
                ),
                patch("libs.login._get_user", return_value=mock_account),
            ):
                resource = PartnerTenants()
                result = resource.put(partner_key_encoded)

        # Assert
        assert result == expected_response
        mock_billing_service.sync_partner_tenants_bindings.assert_called_once_with(
            mock_account.id, "partner-key-123", click_id
        )

    def test_put_invalid_partner_key_base64(self, app, mock_account, mock_billing_service, mock_decorators):
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
                    "controllers.console.billing.billing.current_account_with_tenant",
                    return_value=(mock_account, "tenant-456"),
                ),
                patch("libs.login._get_user", return_value=mock_account),
            ):
                resource = PartnerTenants()

                # Act & Assert
                with pytest.raises(BadRequest) as exc_info:
                    resource.put(invalid_partner_key)
                assert "Invalid partner_key" in str(exc_info.value)

    def test_put_missing_click_id(self, app, mock_account, mock_billing_service, mock_decorators):
        """Test that missing click_id raises BadRequest."""
        # Arrange
        partner_key_encoded = base64.b64encode(b"partner-key-123").decode("utf-8")

        with app.test_request_context(
            method="PUT",
            json={},
            path=f"/billing/partners/{partner_key_encoded}/tenants",
        ):
            with (
                patch(
                    "controllers.console.billing.billing.current_account_with_tenant",
                    return_value=(mock_account, "tenant-456"),
                ),
                patch("libs.login._get_user", return_value=mock_account),
            ):
                resource = PartnerTenants()

                # Act & Assert
                # Validation should raise BadRequest for missing required field
                with pytest.raises(BadRequest):
                    resource.put(partner_key_encoded)

    def test_put_billing_service_json_decode_error(self, app, mock_account, mock_billing_service, mock_decorators):
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
        mock_billing_service.sync_partner_tenants_bindings.side_effect = json_decode_error

        with app.test_request_context(
            method="PUT",
            json={"click_id": click_id},
            path=f"/billing/partners/{partner_key_encoded}/tenants",
        ):
            with (
                patch(
                    "controllers.console.billing.billing.current_account_with_tenant",
                    return_value=(mock_account, "tenant-456"),
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

    def test_put_empty_click_id(self, app, mock_account, mock_billing_service, mock_decorators):
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
                    "controllers.console.billing.billing.current_account_with_tenant",
                    return_value=(mock_account, "tenant-456"),
                ),
                patch("libs.login._get_user", return_value=mock_account),
            ):
                resource = PartnerTenants()

                # Act & Assert
                with pytest.raises(BadRequest) as exc_info:
                    resource.put(partner_key_encoded)
                assert "Invalid partner information" in str(exc_info.value)

    def test_put_empty_partner_key_after_decode(self, app, mock_account, mock_billing_service, mock_decorators):
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
                    "controllers.console.billing.billing.current_account_with_tenant",
                    return_value=(mock_account, "tenant-456"),
                ),
                patch("libs.login._get_user", return_value=mock_account),
            ):
                resource = PartnerTenants()

                # Act & Assert
                with pytest.raises(BadRequest) as exc_info:
                    resource.put(empty_partner_key_encoded)
                assert "Invalid partner information" in str(exc_info.value)

    def test_put_empty_user_id(self, app, mock_account, mock_billing_service, mock_decorators):
        """Test that empty user id raises BadRequest."""
        # Arrange
        partner_key_encoded = base64.b64encode(b"partner-key-123").decode("utf-8")
        click_id = "click-id-789"
        mock_account.id = None  # Empty user id

        with app.test_request_context(
            method="PUT",
            json={"click_id": click_id},
            path=f"/billing/partners/{partner_key_encoded}/tenants",
        ):
            with (
                patch(
                    "controllers.console.billing.billing.current_account_with_tenant",
                    return_value=(mock_account, "tenant-456"),
                ),
                patch("libs.login._get_user", return_value=mock_account),
            ):
                resource = PartnerTenants()

                # Act & Assert
                with pytest.raises(BadRequest) as exc_info:
                    resource.put(partner_key_encoded)
                assert "Invalid partner information" in str(exc_info.value)
