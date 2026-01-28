"""Comprehensive unit tests for BillingService.

This test module covers all aspects of the billing service including:
- HTTP request handling with retry logic
- Subscription tier management and billing information retrieval
- Usage calculation and credit management (positive/negative deltas)
- Rate limit enforcement for compliance downloads and education features
- Account management and permission checks
- Cache management for billing data
- Partner integration features

All tests use mocking to avoid external dependencies and ensure fast, reliable execution.
Tests follow the Arrange-Act-Assert pattern for clarity.
"""

import json
from unittest.mock import MagicMock, patch

import httpx
import pytest
from werkzeug.exceptions import InternalServerError

from enums.cloud_plan import CloudPlan
from models import Account, TenantAccountJoin, TenantAccountRole
from services.billing_service import BillingService


class TestBillingServiceSendRequest:
    """Unit tests for BillingService._send_request method.

    Tests cover:
    - Successful GET/PUT/POST/DELETE requests
    - Error handling for various HTTP status codes
    - Retry logic on network failures
    - Request header and parameter validation
    """

    @pytest.fixture
    def mock_httpx_request(self):
        """Mock httpx.request for testing."""
        with patch("services.billing_service.httpx.request") as mock_request:
            yield mock_request

    @pytest.fixture
    def mock_billing_config(self):
        """Mock BillingService configuration."""
        with (
            patch.object(BillingService, "base_url", "https://billing-api.example.com"),
            patch.object(BillingService, "secret_key", "test-secret-key"),
        ):
            yield

    def test_get_request_success(self, mock_httpx_request, mock_billing_config):
        """Test successful GET request."""
        # Arrange
        expected_response = {"result": "success", "data": {"info": "test"}}
        mock_response = MagicMock()
        mock_response.status_code = httpx.codes.OK
        mock_response.json.return_value = expected_response
        mock_httpx_request.return_value = mock_response

        # Act
        result = BillingService._send_request("GET", "/test", params={"key": "value"})

        # Assert
        assert result == expected_response
        mock_httpx_request.assert_called_once()
        call_args = mock_httpx_request.call_args
        assert call_args[0][0] == "GET"
        assert call_args[0][1] == "https://billing-api.example.com/test"
        assert call_args[1]["params"] == {"key": "value"}
        assert call_args[1]["headers"]["Billing-Api-Secret-Key"] == "test-secret-key"
        assert call_args[1]["headers"]["Content-Type"] == "application/json"

    @pytest.mark.parametrize(
        "status_code", [httpx.codes.NOT_FOUND, httpx.codes.INTERNAL_SERVER_ERROR, httpx.codes.BAD_REQUEST]
    )
    def test_get_request_non_200_status_code(self, mock_httpx_request, mock_billing_config, status_code):
        """Test GET request with non-200 status code raises ValueError."""
        # Arrange
        mock_response = MagicMock()
        mock_response.status_code = status_code
        mock_httpx_request.return_value = mock_response

        # Act & Assert
        with pytest.raises(ValueError) as exc_info:
            BillingService._send_request("GET", "/test")
        assert "Unable to retrieve billing information" in str(exc_info.value)

    def test_put_request_success(self, mock_httpx_request, mock_billing_config):
        """Test successful PUT request."""
        # Arrange
        expected_response = {"result": "success"}
        mock_response = MagicMock()
        mock_response.status_code = httpx.codes.OK
        mock_response.json.return_value = expected_response
        mock_httpx_request.return_value = mock_response

        # Act
        result = BillingService._send_request("PUT", "/test", json={"key": "value"})

        # Assert
        assert result == expected_response
        call_args = mock_httpx_request.call_args
        assert call_args[0][0] == "PUT"

    def test_put_request_internal_server_error(self, mock_httpx_request, mock_billing_config):
        """Test PUT request with INTERNAL_SERVER_ERROR raises InternalServerError."""
        # Arrange
        mock_response = MagicMock()
        mock_response.status_code = httpx.codes.INTERNAL_SERVER_ERROR
        mock_httpx_request.return_value = mock_response

        # Act & Assert
        with pytest.raises(InternalServerError) as exc_info:
            BillingService._send_request("PUT", "/test", json={"key": "value"})
        assert exc_info.value.code == 500
        assert "Unable to process billing request" in str(exc_info.value.description)

    @pytest.mark.parametrize(
        "status_code", [httpx.codes.BAD_REQUEST, httpx.codes.NOT_FOUND, httpx.codes.UNAUTHORIZED, httpx.codes.FORBIDDEN]
    )
    def test_put_request_non_200_non_500(self, mock_httpx_request, mock_billing_config, status_code):
        """Test PUT request with non-200 and non-500 status code raises ValueError."""
        # Arrange
        mock_response = MagicMock()
        mock_response.status_code = status_code
        mock_httpx_request.return_value = mock_response

        # Act & Assert
        with pytest.raises(ValueError) as exc_info:
            BillingService._send_request("PUT", "/test", json={"key": "value"})
        assert "Invalid arguments." in str(exc_info.value)

    @pytest.mark.parametrize("method", ["POST", "DELETE"])
    def test_non_get_non_put_request_success(self, mock_httpx_request, mock_billing_config, method):
        """Test successful POST/DELETE request."""
        # Arrange
        expected_response = {"result": "success"}
        mock_response = MagicMock()
        mock_response.status_code = httpx.codes.OK
        mock_response.json.return_value = expected_response
        mock_httpx_request.return_value = mock_response

        # Act
        result = BillingService._send_request(method, "/test", json={"key": "value"})

        # Assert
        assert result == expected_response
        call_args = mock_httpx_request.call_args
        assert call_args[0][0] == method

    @pytest.mark.parametrize(
        "status_code", [httpx.codes.BAD_REQUEST, httpx.codes.INTERNAL_SERVER_ERROR, httpx.codes.NOT_FOUND]
    )
    def test_post_request_non_200_with_valid_json(self, mock_httpx_request, mock_billing_config, status_code):
        """Test POST request with non-200 status code raises ValueError."""
        # Arrange
        error_response = {"detail": "Error message"}
        mock_response = MagicMock()
        mock_response.status_code = status_code
        mock_response.json.return_value = error_response
        mock_httpx_request.return_value = mock_response

        # Act & Assert
        with pytest.raises(ValueError) as exc_info:
            BillingService._send_request("POST", "/test", json={"key": "value"})
        assert "Unable to send request to" in str(exc_info.value)

    @pytest.mark.parametrize(
        "status_code", [httpx.codes.BAD_REQUEST, httpx.codes.INTERNAL_SERVER_ERROR, httpx.codes.NOT_FOUND]
    )
    def test_delete_request_non_200_with_valid_json(self, mock_httpx_request, mock_billing_config, status_code):
        """Test DELETE request with non-200 status code raises ValueError.

        DELETE now checks status code and raises ValueError for non-200 responses.
        """
        # Arrange
        error_response = {"detail": "Error message"}
        mock_response = MagicMock()
        mock_response.status_code = status_code
        mock_response.text = "Error message"
        mock_response.json.return_value = error_response
        mock_httpx_request.return_value = mock_response

        # Act & Assert
        with patch("services.billing_service.logger") as mock_logger:
            with pytest.raises(ValueError) as exc_info:
                BillingService._send_request("DELETE", "/test", json={"key": "value"})
            assert "Unable to process delete request" in str(exc_info.value)
            # Verify error logging
            mock_logger.error.assert_called_once()
            assert "DELETE response" in str(mock_logger.error.call_args)

    @pytest.mark.parametrize(
        "status_code", [httpx.codes.BAD_REQUEST, httpx.codes.INTERNAL_SERVER_ERROR, httpx.codes.NOT_FOUND]
    )
    def test_post_request_non_200_with_invalid_json(self, mock_httpx_request, mock_billing_config, status_code):
        """Test POST request with non-200 status code raises ValueError before JSON parsing."""
        # Arrange
        mock_response = MagicMock()
        mock_response.status_code = status_code
        mock_response.text = ""
        mock_response.json.side_effect = json.JSONDecodeError("Expecting value", "", 0)
        mock_httpx_request.return_value = mock_response

        # Act & Assert
        # POST checks status code before calling response.json(), so ValueError is raised
        with pytest.raises(ValueError) as exc_info:
            BillingService._send_request("POST", "/test", json={"key": "value"})
        assert "Unable to send request to" in str(exc_info.value)

    @pytest.mark.parametrize(
        "status_code", [httpx.codes.BAD_REQUEST, httpx.codes.INTERNAL_SERVER_ERROR, httpx.codes.NOT_FOUND]
    )
    def test_delete_request_non_200_with_invalid_json(self, mock_httpx_request, mock_billing_config, status_code):
        """Test DELETE request with non-200 status code raises ValueError before JSON parsing.

        DELETE now checks status code before calling response.json(), so ValueError is raised
        when the response cannot be parsed as JSON (e.g., empty response).
        """
        # Arrange
        mock_response = MagicMock()
        mock_response.status_code = status_code
        mock_response.text = ""
        mock_response.json.side_effect = json.JSONDecodeError("Expecting value", "", 0)
        mock_httpx_request.return_value = mock_response

        # Act & Assert
        with patch("services.billing_service.logger") as mock_logger:
            with pytest.raises(ValueError) as exc_info:
                BillingService._send_request("DELETE", "/test", json={"key": "value"})
            assert "Unable to process delete request" in str(exc_info.value)
            # Verify error logging
            mock_logger.error.assert_called_once()
            assert "DELETE response" in str(mock_logger.error.call_args)

    def test_retry_on_request_error(self, mock_httpx_request, mock_billing_config):
        """Test that _send_request retries on httpx.RequestError."""
        # Arrange
        expected_response = {"result": "success"}
        mock_response = MagicMock()
        mock_response.status_code = httpx.codes.OK
        mock_response.json.return_value = expected_response

        # First call raises RequestError, second succeeds
        mock_httpx_request.side_effect = [
            httpx.RequestError("Network error"),
            mock_response,
        ]

        # Act
        result = BillingService._send_request("GET", "/test")

        # Assert
        assert result == expected_response
        assert mock_httpx_request.call_count == 2

    def test_retry_exhausted_raises_exception(self, mock_httpx_request, mock_billing_config):
        """Test that _send_request raises exception after retries are exhausted."""
        # Arrange
        mock_httpx_request.side_effect = httpx.RequestError("Network error")

        # Act & Assert
        with pytest.raises(httpx.RequestError):
            BillingService._send_request("GET", "/test")

        # Should retry multiple times (wait=2, stop_before_delay=10 means ~5 attempts)
        assert mock_httpx_request.call_count > 1


class TestBillingServiceSubscriptionInfo:
    """Unit tests for subscription tier and billing info retrieval.

    Tests cover:
    - Billing information retrieval
    - Knowledge base rate limits with default and custom values
    - Payment link generation for subscriptions and model providers
    - Invoice retrieval
    """

    @pytest.fixture
    def mock_send_request(self):
        """Mock _send_request method."""
        with patch.object(BillingService, "_send_request") as mock:
            yield mock

    def test_get_info_success(self, mock_send_request):
        """Test successful retrieval of billing information."""
        # Arrange
        tenant_id = "tenant-123"
        expected_response = {
            "subscription_plan": "professional",
            "billing_cycle": "monthly",
            "status": "active",
        }
        mock_send_request.return_value = expected_response

        # Act
        result = BillingService.get_info(tenant_id)

        # Assert
        assert result == expected_response
        mock_send_request.assert_called_once_with("GET", "/subscription/info", params={"tenant_id": tenant_id})

    def test_get_knowledge_rate_limit_with_defaults(self, mock_send_request):
        """Test knowledge rate limit retrieval with default values."""
        # Arrange
        tenant_id = "tenant-456"
        mock_send_request.return_value = {}

        # Act
        result = BillingService.get_knowledge_rate_limit(tenant_id)

        # Assert
        assert result["limit"] == 10  # Default limit
        assert result["subscription_plan"] == CloudPlan.SANDBOX  # Default plan
        mock_send_request.assert_called_once_with(
            "GET", "/subscription/knowledge-rate-limit", params={"tenant_id": tenant_id}
        )

    def test_get_knowledge_rate_limit_with_custom_values(self, mock_send_request):
        """Test knowledge rate limit retrieval with custom values."""
        # Arrange
        tenant_id = "tenant-789"
        mock_send_request.return_value = {"limit": 100, "subscription_plan": CloudPlan.PROFESSIONAL}

        # Act
        result = BillingService.get_knowledge_rate_limit(tenant_id)

        # Assert
        assert result["limit"] == 100
        assert result["subscription_plan"] == CloudPlan.PROFESSIONAL

    def test_get_subscription_payment_link(self, mock_send_request):
        """Test subscription payment link generation."""
        # Arrange
        plan = "professional"
        interval = "monthly"
        email = "user@example.com"
        tenant_id = "tenant-123"
        expected_response = {"payment_link": "https://payment.example.com/checkout"}
        mock_send_request.return_value = expected_response

        # Act
        result = BillingService.get_subscription(plan, interval, email, tenant_id)

        # Assert
        assert result == expected_response
        mock_send_request.assert_called_once_with(
            "GET",
            "/subscription/payment-link",
            params={"plan": plan, "interval": interval, "prefilled_email": email, "tenant_id": tenant_id},
        )

    def test_get_model_provider_payment_link(self, mock_send_request):
        """Test model provider payment link generation."""
        # Arrange
        provider_name = "openai"
        tenant_id = "tenant-123"
        account_id = "account-456"
        email = "user@example.com"
        expected_response = {"payment_link": "https://payment.example.com/provider"}
        mock_send_request.return_value = expected_response

        # Act
        result = BillingService.get_model_provider_payment_link(provider_name, tenant_id, account_id, email)

        # Assert
        assert result == expected_response
        mock_send_request.assert_called_once_with(
            "GET",
            "/model-provider/payment-link",
            params={
                "provider_name": provider_name,
                "tenant_id": tenant_id,
                "account_id": account_id,
                "prefilled_email": email,
            },
        )

    def test_get_invoices(self, mock_send_request):
        """Test invoice retrieval."""
        # Arrange
        email = "user@example.com"
        tenant_id = "tenant-123"
        expected_response = {"invoices": [{"id": "inv-1", "amount": 100}]}
        mock_send_request.return_value = expected_response

        # Act
        result = BillingService.get_invoices(email, tenant_id)

        # Assert
        assert result == expected_response
        mock_send_request.assert_called_once_with(
            "GET", "/invoices", params={"prefilled_email": email, "tenant_id": tenant_id}
        )


class TestBillingServiceUsageCalculation:
    """Unit tests for usage calculation and credit management.

    Tests cover:
    - Feature plan usage information retrieval
    - Credit addition (positive delta)
    - Credit consumption (negative delta)
    - Usage refunds
    - Specific feature usage queries
    """

    @pytest.fixture
    def mock_send_request(self):
        """Mock _send_request method."""
        with patch.object(BillingService, "_send_request") as mock:
            yield mock

    def test_get_tenant_feature_plan_usage_info(self, mock_send_request):
        """Test retrieval of tenant feature plan usage information."""
        # Arrange
        tenant_id = "tenant-123"
        expected_response = {"features": {"trigger": {"used": 50, "limit": 100}, "workflow": {"used": 20, "limit": 50}}}
        mock_send_request.return_value = expected_response

        # Act
        result = BillingService.get_tenant_feature_plan_usage_info(tenant_id)

        # Assert
        assert result == expected_response
        mock_send_request.assert_called_once_with("GET", "/tenant-feature-usage/info", params={"tenant_id": tenant_id})

    def test_update_tenant_feature_plan_usage_positive_delta(self, mock_send_request):
        """Test updating tenant feature usage with positive delta (adding credits)."""
        # Arrange
        tenant_id = "tenant-123"
        feature_key = "trigger"
        delta = 10
        expected_response = {"result": "success", "history_id": "hist-uuid-123"}
        mock_send_request.return_value = expected_response

        # Act
        result = BillingService.update_tenant_feature_plan_usage(tenant_id, feature_key, delta)

        # Assert
        assert result == expected_response
        assert result["result"] == "success"
        assert "history_id" in result
        mock_send_request.assert_called_once_with(
            "POST",
            "/tenant-feature-usage/usage",
            params={"tenant_id": tenant_id, "feature_key": feature_key, "delta": delta},
        )

    def test_update_tenant_feature_plan_usage_negative_delta(self, mock_send_request):
        """Test updating tenant feature usage with negative delta (consuming credits)."""
        # Arrange
        tenant_id = "tenant-456"
        feature_key = "workflow"
        delta = -5
        expected_response = {"result": "success", "history_id": "hist-uuid-456"}
        mock_send_request.return_value = expected_response

        # Act
        result = BillingService.update_tenant_feature_plan_usage(tenant_id, feature_key, delta)

        # Assert
        assert result == expected_response
        mock_send_request.assert_called_once_with(
            "POST",
            "/tenant-feature-usage/usage",
            params={"tenant_id": tenant_id, "feature_key": feature_key, "delta": delta},
        )

    def test_refund_tenant_feature_plan_usage(self, mock_send_request):
        """Test refunding a previous usage charge."""
        # Arrange
        history_id = "hist-uuid-789"
        expected_response = {"result": "success", "history_id": history_id}
        mock_send_request.return_value = expected_response

        # Act
        result = BillingService.refund_tenant_feature_plan_usage(history_id)

        # Assert
        assert result == expected_response
        assert result["result"] == "success"
        mock_send_request.assert_called_once_with(
            "POST", "/tenant-feature-usage/refund", params={"quota_usage_history_id": history_id}
        )

    def test_get_tenant_feature_plan_usage(self, mock_send_request):
        """Test getting specific feature usage for a tenant."""
        # Arrange
        tenant_id = "tenant-123"
        feature_key = "trigger"
        expected_response = {"used": 75, "limit": 100, "remaining": 25}
        mock_send_request.return_value = expected_response

        # Act
        result = BillingService.get_tenant_feature_plan_usage(tenant_id, feature_key)

        # Assert
        assert result == expected_response
        mock_send_request.assert_called_once_with(
            "GET", "/billing/tenant_feature_plan/usage", params={"tenant_id": tenant_id, "feature_key": feature_key}
        )


class TestBillingServiceRateLimitEnforcement:
    """Unit tests for rate limit enforcement mechanisms.

    Tests cover:
    - Compliance download rate limiting (4 requests per 60 seconds)
    - Education verification rate limiting (10 requests per 60 seconds)
    - Education activation rate limiting (10 requests per 60 seconds)
    - Rate limit increment after successful operations
    - Proper exception raising when limits are exceeded
    """

    @pytest.fixture
    def mock_send_request(self):
        """Mock _send_request method."""
        with patch.object(BillingService, "_send_request") as mock:
            yield mock

    def test_compliance_download_rate_limiter_not_limited(self, mock_send_request):
        """Test compliance download when rate limit is not exceeded."""
        # Arrange
        doc_name = "compliance_report.pdf"
        account_id = "account-123"
        tenant_id = "tenant-456"
        ip = "192.168.1.1"
        device_info = "Mozilla/5.0"
        expected_response = {"download_link": "https://example.com/download"}

        # Mock the rate limiter to return False (not limited)
        with (
            patch.object(
                BillingService.compliance_download_rate_limiter, "is_rate_limited", return_value=False
            ) as mock_is_limited,
            patch.object(BillingService.compliance_download_rate_limiter, "increment_rate_limit") as mock_increment,
        ):
            mock_send_request.return_value = expected_response

            # Act
            result = BillingService.get_compliance_download_link(doc_name, account_id, tenant_id, ip, device_info)

            # Assert
            assert result == expected_response
            mock_is_limited.assert_called_once_with(f"{account_id}:{tenant_id}")
            mock_send_request.assert_called_once_with(
                "POST",
                "/compliance/download",
                json={
                    "doc_name": doc_name,
                    "account_id": account_id,
                    "tenant_id": tenant_id,
                    "ip_address": ip,
                    "device_info": device_info,
                },
            )
            # Verify rate limit was incremented after successful download
            mock_increment.assert_called_once_with(f"{account_id}:{tenant_id}")

    def test_compliance_download_rate_limiter_exceeded(self, mock_send_request):
        """Test compliance download when rate limit is exceeded."""
        # Arrange
        doc_name = "compliance_report.pdf"
        account_id = "account-123"
        tenant_id = "tenant-456"
        ip = "192.168.1.1"
        device_info = "Mozilla/5.0"

        # Import the error class to properly catch it
        from controllers.console.error import ComplianceRateLimitError

        # Mock the rate limiter to return True (rate limited)
        with patch.object(
            BillingService.compliance_download_rate_limiter, "is_rate_limited", return_value=True
        ) as mock_is_limited:
            # Act & Assert
            with pytest.raises(ComplianceRateLimitError):
                BillingService.get_compliance_download_link(doc_name, account_id, tenant_id, ip, device_info)

            mock_is_limited.assert_called_once_with(f"{account_id}:{tenant_id}")
            mock_send_request.assert_not_called()

    def test_education_verify_rate_limit_not_exceeded(self, mock_send_request):
        """Test education verification when rate limit is not exceeded."""
        # Arrange
        account_id = "account-123"
        account_email = "student@university.edu"
        expected_response = {"verified": True, "institution": "University"}

        # Mock the rate limiter to return False (not limited)
        with (
            patch.object(
                BillingService.EducationIdentity.verification_rate_limit, "is_rate_limited", return_value=False
            ) as mock_is_limited,
            patch.object(
                BillingService.EducationIdentity.verification_rate_limit, "increment_rate_limit"
            ) as mock_increment,
        ):
            mock_send_request.return_value = expected_response

            # Act
            result = BillingService.EducationIdentity.verify(account_id, account_email)

            # Assert
            assert result == expected_response
            mock_is_limited.assert_called_once_with(account_email)
            mock_send_request.assert_called_once_with("GET", "/education/verify", params={"account_id": account_id})
            mock_increment.assert_called_once_with(account_email)

    def test_education_verify_rate_limit_exceeded(self, mock_send_request):
        """Test education verification when rate limit is exceeded."""
        # Arrange
        account_id = "account-123"
        account_email = "student@university.edu"

        # Import the error class to properly catch it
        from controllers.console.error import EducationVerifyLimitError

        # Mock the rate limiter to return True (rate limited)
        with patch.object(
            BillingService.EducationIdentity.verification_rate_limit, "is_rate_limited", return_value=True
        ) as mock_is_limited:
            # Act & Assert
            with pytest.raises(EducationVerifyLimitError):
                BillingService.EducationIdentity.verify(account_id, account_email)

            mock_is_limited.assert_called_once_with(account_email)
            mock_send_request.assert_not_called()

    def test_education_activate_rate_limit_not_exceeded(self, mock_send_request):
        """Test education activation when rate limit is not exceeded."""
        # Arrange
        account = MagicMock(spec=Account)
        account.id = "account-123"
        account.email = "student@university.edu"
        account.current_tenant_id = "tenant-456"
        token = "verification-token"
        institution = "MIT"
        role = "student"
        expected_response = {"result": "success", "activated": True}

        # Mock the rate limiter to return False (not limited)
        with (
            patch.object(
                BillingService.EducationIdentity.activation_rate_limit, "is_rate_limited", return_value=False
            ) as mock_is_limited,
            patch.object(
                BillingService.EducationIdentity.activation_rate_limit, "increment_rate_limit"
            ) as mock_increment,
        ):
            mock_send_request.return_value = expected_response

            # Act
            result = BillingService.EducationIdentity.activate(account, token, institution, role)

            # Assert
            assert result == expected_response
            mock_is_limited.assert_called_once_with(account.email)
            mock_send_request.assert_called_once_with(
                "POST",
                "/education/",
                json={"institution": institution, "token": token, "role": role},
                params={"account_id": account.id, "curr_tenant_id": account.current_tenant_id},
            )
            mock_increment.assert_called_once_with(account.email)

    def test_education_activate_rate_limit_exceeded(self, mock_send_request):
        """Test education activation when rate limit is exceeded."""
        # Arrange
        account = MagicMock(spec=Account)
        account.id = "account-123"
        account.email = "student@university.edu"
        account.current_tenant_id = "tenant-456"
        token = "verification-token"
        institution = "MIT"
        role = "student"

        # Import the error class to properly catch it
        from controllers.console.error import EducationActivateLimitError

        # Mock the rate limiter to return True (rate limited)
        with patch.object(
            BillingService.EducationIdentity.activation_rate_limit, "is_rate_limited", return_value=True
        ) as mock_is_limited:
            # Act & Assert
            with pytest.raises(EducationActivateLimitError):
                BillingService.EducationIdentity.activate(account, token, institution, role)

            mock_is_limited.assert_called_once_with(account.email)
            mock_send_request.assert_not_called()


class TestBillingServiceEducationIdentity:
    """Unit tests for education identity verification and management.

    Tests cover:
    - Education verification status checking
    - Institution autocomplete with pagination
    - Default parameter handling
    """

    @pytest.fixture
    def mock_send_request(self):
        """Mock _send_request method."""
        with patch.object(BillingService, "_send_request") as mock:
            yield mock

    def test_education_status(self, mock_send_request):
        """Test checking education verification status."""
        # Arrange
        account_id = "account-123"
        expected_response = {"verified": True, "institution": "MIT", "role": "student"}
        mock_send_request.return_value = expected_response

        # Act
        result = BillingService.EducationIdentity.status(account_id)

        # Assert
        assert result == expected_response
        mock_send_request.assert_called_once_with("GET", "/education/status", params={"account_id": account_id})

    def test_education_autocomplete(self, mock_send_request):
        """Test education institution autocomplete."""
        # Arrange
        keywords = "Massachusetts"
        page = 0
        limit = 20
        expected_response = {
            "institutions": [
                {"name": "Massachusetts Institute of Technology", "domain": "mit.edu"},
                {"name": "University of Massachusetts", "domain": "umass.edu"},
            ]
        }
        mock_send_request.return_value = expected_response

        # Act
        result = BillingService.EducationIdentity.autocomplete(keywords, page, limit)

        # Assert
        assert result == expected_response
        mock_send_request.assert_called_once_with(
            "GET", "/education/autocomplete", params={"keywords": keywords, "page": page, "limit": limit}
        )

    def test_education_autocomplete_with_defaults(self, mock_send_request):
        """Test education institution autocomplete with default parameters."""
        # Arrange
        keywords = "Stanford"
        expected_response = {"institutions": [{"name": "Stanford University", "domain": "stanford.edu"}]}
        mock_send_request.return_value = expected_response

        # Act
        result = BillingService.EducationIdentity.autocomplete(keywords)

        # Assert
        assert result == expected_response
        mock_send_request.assert_called_once_with(
            "GET", "/education/autocomplete", params={"keywords": keywords, "page": 0, "limit": 20}
        )


class TestBillingServiceAccountManagement:
    """Unit tests for account-related billing operations.

    Tests cover:
    - Account deletion
    - Email freeze status checking
    - Account deletion feedback submission
    - Tenant owner/admin permission validation
    - Error handling for missing tenant joins
    """

    @pytest.fixture
    def mock_send_request(self):
        """Mock _send_request method."""
        with patch.object(BillingService, "_send_request") as mock:
            yield mock

    @pytest.fixture
    def mock_db_session(self):
        """Mock database session."""
        with patch("services.billing_service.db.session") as mock_session:
            yield mock_session

    def test_delete_account(self, mock_send_request):
        """Test account deletion."""
        # Arrange
        account_id = "account-123"
        expected_response = {"result": "success", "deleted": True}
        mock_send_request.return_value = expected_response

        # Act
        result = BillingService.delete_account(account_id)

        # Assert
        assert result == expected_response
        mock_send_request.assert_called_once_with("DELETE", "/account", params={"account_id": account_id})

    def test_is_email_in_freeze_true(self, mock_send_request):
        """Test checking if email is frozen (returns True)."""
        # Arrange
        email = "frozen@example.com"
        mock_send_request.return_value = {"data": True}

        # Act
        result = BillingService.is_email_in_freeze(email)

        # Assert
        assert result is True
        mock_send_request.assert_called_once_with("GET", "/account/in-freeze", params={"email": email})

    def test_is_email_in_freeze_false(self, mock_send_request):
        """Test checking if email is frozen (returns False)."""
        # Arrange
        email = "active@example.com"
        mock_send_request.return_value = {"data": False}

        # Act
        result = BillingService.is_email_in_freeze(email)

        # Assert
        assert result is False
        mock_send_request.assert_called_once_with("GET", "/account/in-freeze", params={"email": email})

    def test_is_email_in_freeze_exception_returns_false(self, mock_send_request):
        """Test that is_email_in_freeze returns False on exception."""
        # Arrange
        email = "error@example.com"
        mock_send_request.side_effect = Exception("Network error")

        # Act
        result = BillingService.is_email_in_freeze(email)

        # Assert
        assert result is False

    def test_update_account_deletion_feedback(self, mock_send_request):
        """Test updating account deletion feedback."""
        # Arrange
        email = "user@example.com"
        feedback = "Service was too expensive"
        expected_response = {"result": "success"}
        mock_send_request.return_value = expected_response

        # Act
        result = BillingService.update_account_deletion_feedback(email, feedback)

        # Assert
        assert result == expected_response
        mock_send_request.assert_called_once_with(
            "POST", "/account/delete-feedback", json={"email": email, "feedback": feedback}
        )

    def test_is_tenant_owner_or_admin_owner(self, mock_db_session):
        """Test tenant owner/admin check for owner role."""
        # Arrange
        current_user = MagicMock(spec=Account)
        current_user.id = "account-123"
        current_user.current_tenant_id = "tenant-456"

        mock_join = MagicMock(spec=TenantAccountJoin)
        mock_join.role = TenantAccountRole.OWNER

        mock_query = MagicMock()
        mock_query.where.return_value.first.return_value = mock_join
        mock_db_session.query.return_value = mock_query

        # Act - should not raise exception
        BillingService.is_tenant_owner_or_admin(current_user)

        # Assert
        mock_db_session.query.assert_called_once()

    def test_is_tenant_owner_or_admin_admin(self, mock_db_session):
        """Test tenant owner/admin check for admin role."""
        # Arrange
        current_user = MagicMock(spec=Account)
        current_user.id = "account-123"
        current_user.current_tenant_id = "tenant-456"

        mock_join = MagicMock(spec=TenantAccountJoin)
        mock_join.role = TenantAccountRole.ADMIN

        mock_query = MagicMock()
        mock_query.where.return_value.first.return_value = mock_join
        mock_db_session.query.return_value = mock_query

        # Act - should not raise exception
        BillingService.is_tenant_owner_or_admin(current_user)

        # Assert
        mock_db_session.query.assert_called_once()

    def test_is_tenant_owner_or_admin_normal_user_raises_error(self, mock_db_session):
        """Test tenant owner/admin check raises error for normal user."""
        # Arrange
        current_user = MagicMock(spec=Account)
        current_user.id = "account-123"
        current_user.current_tenant_id = "tenant-456"

        mock_join = MagicMock(spec=TenantAccountJoin)
        mock_join.role = TenantAccountRole.NORMAL

        mock_query = MagicMock()
        mock_query.where.return_value.first.return_value = mock_join
        mock_db_session.query.return_value = mock_query

        # Act & Assert
        with pytest.raises(ValueError) as exc_info:
            BillingService.is_tenant_owner_or_admin(current_user)
        assert "Only team owner or team admin can perform this action" in str(exc_info.value)

    def test_is_tenant_owner_or_admin_no_join_raises_error(self, mock_db_session):
        """Test tenant owner/admin check raises error when join not found."""
        # Arrange
        current_user = MagicMock(spec=Account)
        current_user.id = "account-123"
        current_user.current_tenant_id = "tenant-456"

        mock_query = MagicMock()
        mock_query.where.return_value.first.return_value = None
        mock_db_session.query.return_value = mock_query

        # Act & Assert
        with pytest.raises(ValueError) as exc_info:
            BillingService.is_tenant_owner_or_admin(current_user)
        assert "Tenant account join not found" in str(exc_info.value)


class TestBillingServiceCacheManagement:
    """Unit tests for billing cache management.

    Tests cover:
    - Billing info cache invalidation
    - Proper Redis key formatting
    """

    @pytest.fixture
    def mock_redis_client(self):
        """Mock Redis client."""
        with patch("services.billing_service.redis_client") as mock_redis:
            yield mock_redis

    def test_clean_billing_info_cache(self, mock_redis_client):
        """Test cleaning billing info cache."""
        # Arrange
        tenant_id = "tenant-123"
        expected_key = f"tenant:{tenant_id}:billing_info"

        # Act
        BillingService.clean_billing_info_cache(tenant_id)

        # Assert
        mock_redis_client.delete.assert_called_once_with(expected_key)


class TestBillingServicePartnerIntegration:
    """Unit tests for partner integration features.

    Tests cover:
    - Partner tenant binding synchronization
    - Click ID tracking
    """

    @pytest.fixture
    def mock_send_request(self):
        """Mock _send_request method."""
        with patch.object(BillingService, "_send_request") as mock:
            yield mock

    def test_sync_partner_tenants_bindings(self, mock_send_request):
        """Test syncing partner tenant bindings."""
        # Arrange
        account_id = "account-123"
        partner_key = "partner-xyz"
        click_id = "click-789"
        expected_response = {"result": "success", "synced": True}
        mock_send_request.return_value = expected_response

        # Act
        result = BillingService.sync_partner_tenants_bindings(account_id, partner_key, click_id)

        # Assert
        assert result == expected_response
        mock_send_request.assert_called_once_with(
            "PUT", f"/partners/{partner_key}/tenants", json={"account_id": account_id, "click_id": click_id}
        )


class TestBillingServiceEdgeCases:
    """Unit tests for edge cases and error scenarios.

    Tests cover:
    - Empty responses from billing API
    - Malformed JSON responses
    - Boundary conditions for rate limits
    - Multiple subscription tiers
    - Zero and negative usage deltas
    """

    @pytest.fixture
    def mock_send_request(self):
        """Mock _send_request method."""
        with patch.object(BillingService, "_send_request") as mock:
            yield mock

    def test_get_info_empty_response(self, mock_send_request):
        """Test handling of empty billing info response."""
        # Arrange
        tenant_id = "tenant-empty"
        mock_send_request.return_value = {}

        # Act
        result = BillingService.get_info(tenant_id)

        # Assert
        assert result == {}
        mock_send_request.assert_called_once()

    def test_update_tenant_feature_plan_usage_zero_delta(self, mock_send_request):
        """Test updating tenant feature usage with zero delta (no change)."""
        # Arrange
        tenant_id = "tenant-123"
        feature_key = "trigger"
        delta = 0  # No change
        expected_response = {"result": "success", "history_id": "hist-uuid-zero"}
        mock_send_request.return_value = expected_response

        # Act
        result = BillingService.update_tenant_feature_plan_usage(tenant_id, feature_key, delta)

        # Assert
        assert result == expected_response
        mock_send_request.assert_called_once_with(
            "POST",
            "/tenant-feature-usage/usage",
            params={"tenant_id": tenant_id, "feature_key": feature_key, "delta": delta},
        )

    def test_update_tenant_feature_plan_usage_large_negative_delta(self, mock_send_request):
        """Test updating tenant feature usage with large negative delta."""
        # Arrange
        tenant_id = "tenant-456"
        feature_key = "workflow"
        delta = -1000  # Large consumption
        expected_response = {"result": "success", "history_id": "hist-uuid-large"}
        mock_send_request.return_value = expected_response

        # Act
        result = BillingService.update_tenant_feature_plan_usage(tenant_id, feature_key, delta)

        # Assert
        assert result == expected_response
        mock_send_request.assert_called_once()

    def test_get_knowledge_rate_limit_all_subscription_tiers(self, mock_send_request):
        """Test knowledge rate limit for all subscription tiers."""
        # Test SANDBOX tier
        mock_send_request.return_value = {"limit": 10, "subscription_plan": CloudPlan.SANDBOX}
        result = BillingService.get_knowledge_rate_limit("tenant-sandbox")
        assert result["subscription_plan"] == CloudPlan.SANDBOX
        assert result["limit"] == 10

        # Test PROFESSIONAL tier
        mock_send_request.return_value = {"limit": 100, "subscription_plan": CloudPlan.PROFESSIONAL}
        result = BillingService.get_knowledge_rate_limit("tenant-pro")
        assert result["subscription_plan"] == CloudPlan.PROFESSIONAL
        assert result["limit"] == 100

        # Test TEAM tier
        mock_send_request.return_value = {"limit": 500, "subscription_plan": CloudPlan.TEAM}
        result = BillingService.get_knowledge_rate_limit("tenant-team")
        assert result["subscription_plan"] == CloudPlan.TEAM
        assert result["limit"] == 500

    def test_get_subscription_with_empty_optional_params(self, mock_send_request):
        """Test subscription payment link with empty optional parameters."""
        # Arrange
        plan = "professional"
        interval = "yearly"
        expected_response = {"payment_link": "https://payment.example.com/checkout"}
        mock_send_request.return_value = expected_response

        # Act - empty email and tenant_id
        result = BillingService.get_subscription(plan, interval, "", "")

        # Assert
        assert result == expected_response
        mock_send_request.assert_called_once_with(
            "GET",
            "/subscription/payment-link",
            params={"plan": plan, "interval": interval, "prefilled_email": "", "tenant_id": ""},
        )

    def test_get_invoices_with_empty_params(self, mock_send_request):
        """Test invoice retrieval with empty parameters."""
        # Arrange
        expected_response = {"invoices": []}
        mock_send_request.return_value = expected_response

        # Act
        result = BillingService.get_invoices("", "")

        # Assert
        assert result == expected_response
        assert result["invoices"] == []

    def test_refund_with_invalid_history_id_format(self, mock_send_request):
        """Test refund with various history ID formats."""
        # Arrange - test with different ID formats
        test_ids = ["hist-123", "uuid-abc-def", "12345", ""]

        for history_id in test_ids:
            expected_response = {"result": "success", "history_id": history_id}
            mock_send_request.return_value = expected_response

            # Act
            result = BillingService.refund_tenant_feature_plan_usage(history_id)

            # Assert
            assert result["history_id"] == history_id

    def test_is_tenant_owner_or_admin_editor_role_raises_error(self):
        """Test tenant owner/admin check raises error for editor role."""
        # Arrange
        current_user = MagicMock(spec=Account)
        current_user.id = "account-123"
        current_user.current_tenant_id = "tenant-456"

        mock_join = MagicMock(spec=TenantAccountJoin)
        mock_join.role = TenantAccountRole.EDITOR  # Editor is not privileged

        with patch("services.billing_service.db.session") as mock_session:
            mock_query = MagicMock()
            mock_query.where.return_value.first.return_value = mock_join
            mock_session.query.return_value = mock_query

            # Act & Assert
            with pytest.raises(ValueError) as exc_info:
                BillingService.is_tenant_owner_or_admin(current_user)
            assert "Only team owner or team admin can perform this action" in str(exc_info.value)

    def test_is_tenant_owner_or_admin_dataset_operator_raises_error(self):
        """Test tenant owner/admin check raises error for dataset operator role."""
        # Arrange
        current_user = MagicMock(spec=Account)
        current_user.id = "account-123"
        current_user.current_tenant_id = "tenant-456"

        mock_join = MagicMock(spec=TenantAccountJoin)
        mock_join.role = TenantAccountRole.DATASET_OPERATOR  # Dataset operator is not privileged

        with patch("services.billing_service.db.session") as mock_session:
            mock_query = MagicMock()
            mock_query.where.return_value.first.return_value = mock_join
            mock_session.query.return_value = mock_query

            # Act & Assert
            with pytest.raises(ValueError) as exc_info:
                BillingService.is_tenant_owner_or_admin(current_user)
            assert "Only team owner or team admin can perform this action" in str(exc_info.value)


class TestBillingServiceSubscriptionOperations:
    """Unit tests for subscription operations in BillingService.

    Tests cover:
    - Bulk plan retrieval with chunking
    - Expired subscription cleanup whitelist retrieval
    """

    @pytest.fixture
    def mock_send_request(self):
        """Mock _send_request method."""
        with patch.object(BillingService, "_send_request") as mock:
            yield mock

    def test_get_plan_bulk_with_empty_list(self, mock_send_request):
        """Test bulk plan retrieval with empty tenant list."""
        # Arrange
        tenant_ids = []

        # Act
        result = BillingService.get_plan_bulk(tenant_ids)

        # Assert
        assert result == {}
        mock_send_request.assert_not_called()

    def test_get_plan_bulk_with_chunking(self, mock_send_request):
        """Test bulk plan retrieval with more than 200 tenants (chunking logic)."""
        # Arrange - 250 tenants to test chunking (chunk_size = 200)
        tenant_ids = [f"tenant-{i}" for i in range(250)]

        # First chunk: tenants 0-199
        first_chunk_response = {
            "data": {f"tenant-{i}": {"plan": "sandbox", "expiration_date": 1735689600} for i in range(200)}
        }

        # Second chunk: tenants 200-249
        second_chunk_response = {
            "data": {f"tenant-{i}": {"plan": "professional", "expiration_date": 1767225600} for i in range(200, 250)}
        }

        mock_send_request.side_effect = [first_chunk_response, second_chunk_response]

        # Act
        result = BillingService.get_plan_bulk(tenant_ids)

        # Assert
        assert len(result) == 250
        assert result["tenant-0"]["plan"] == "sandbox"
        assert result["tenant-199"]["plan"] == "sandbox"
        assert result["tenant-200"]["plan"] == "professional"
        assert result["tenant-249"]["plan"] == "professional"
        assert mock_send_request.call_count == 2

        # Verify first chunk call
        first_call = mock_send_request.call_args_list[0]
        assert first_call[0][0] == "POST"
        assert first_call[0][1] == "/subscription/plan/batch"
        assert len(first_call[1]["json"]["tenant_ids"]) == 200

        # Verify second chunk call
        second_call = mock_send_request.call_args_list[1]
        assert len(second_call[1]["json"]["tenant_ids"]) == 50

    def test_get_plan_bulk_with_partial_batch_failure(self, mock_send_request):
        """Test bulk plan retrieval when one batch fails but others succeed."""
        # Arrange - 250 tenants, second batch will fail
        tenant_ids = [f"tenant-{i}" for i in range(250)]

        # First chunk succeeds
        first_chunk_response = {
            "data": {f"tenant-{i}": {"plan": "sandbox", "expiration_date": 1735689600} for i in range(200)}
        }

        # Second chunk fails - need to create a mock that raises when called
        def side_effect_func(*args, **kwargs):
            if mock_send_request.call_count == 1:
                return first_chunk_response
            else:
                raise ValueError("API error")

        mock_send_request.side_effect = side_effect_func

        # Act
        result = BillingService.get_plan_bulk(tenant_ids)

        # Assert - should only have data from first batch
        assert len(result) == 200
        assert result["tenant-0"]["plan"] == "sandbox"
        assert result["tenant-199"]["plan"] == "sandbox"
        assert "tenant-200" not in result
        assert mock_send_request.call_count == 2

    def test_get_plan_bulk_with_all_batches_failing(self, mock_send_request):
        """Test bulk plan retrieval when all batches fail."""
        # Arrange
        tenant_ids = [f"tenant-{i}" for i in range(250)]

        # All chunks fail
        def side_effect_func(*args, **kwargs):
            raise ValueError("API error")

        mock_send_request.side_effect = side_effect_func

        # Act
        result = BillingService.get_plan_bulk(tenant_ids)

        # Assert - should return empty dict
        assert result == {}
        assert mock_send_request.call_count == 2

    def test_get_plan_bulk_with_exactly_200_tenants(self, mock_send_request):
        """Test bulk plan retrieval with exactly 200 tenants (boundary condition)."""
        # Arrange
        tenant_ids = [f"tenant-{i}" for i in range(200)]
        mock_send_request.return_value = {
            "data": {f"tenant-{i}": {"plan": "sandbox", "expiration_date": 1735689600} for i in range(200)}
        }

        # Act
        result = BillingService.get_plan_bulk(tenant_ids)

        # Assert
        assert len(result) == 200
        assert mock_send_request.call_count == 1

    def test_get_plan_bulk_with_empty_data_response(self, mock_send_request):
        """Test bulk plan retrieval with empty data in response."""
        # Arrange
        tenant_ids = ["tenant-1", "tenant-2"]
        mock_send_request.return_value = {"data": {}}

        # Act
        result = BillingService.get_plan_bulk(tenant_ids)

        # Assert
        assert result == {}

    def test_get_plan_bulk_with_invalid_tenant_plan_skipped(self, mock_send_request):
        """Test bulk plan retrieval when one tenant has invalid plan data (should skip that tenant)."""
        # Arrange
        tenant_ids = ["tenant-valid-1", "tenant-invalid", "tenant-valid-2"]

        # Response with one invalid tenant plan (missing expiration_date) and two valid ones
        mock_send_request.return_value = {
            "data": {
                "tenant-valid-1": {"plan": "sandbox", "expiration_date": 1735689600},
                "tenant-invalid": {"plan": "professional"},  # Missing expiration_date field
                "tenant-valid-2": {"plan": "team", "expiration_date": 1767225600},
            }
        }

        # Act
        with patch("services.billing_service.logger") as mock_logger:
            result = BillingService.get_plan_bulk(tenant_ids)

        # Assert - should only contain valid tenants
        assert len(result) == 2
        assert "tenant-valid-1" in result
        assert "tenant-valid-2" in result
        assert "tenant-invalid" not in result

        # Verify valid tenants have correct data
        assert result["tenant-valid-1"]["plan"] == "sandbox"
        assert result["tenant-valid-1"]["expiration_date"] == 1735689600
        assert result["tenant-valid-2"]["plan"] == "team"
        assert result["tenant-valid-2"]["expiration_date"] == 1767225600

        # Verify exception was logged for the invalid tenant
        mock_logger.exception.assert_called_once()
        log_call_args = mock_logger.exception.call_args[0]
        assert "get_plan_bulk: failed to validate subscription plan for tenant" in log_call_args[0]
        assert "tenant-invalid" in log_call_args[1]

    def test_get_expired_subscription_cleanup_whitelist_success(self, mock_send_request):
        """Test successful retrieval of expired subscription cleanup whitelist."""
        # Arrange
        api_response = [
            {
                "created_at": "2025-10-16T01:56:17",
                "tenant_id": "36bd55ec-2ea9-4d75-a9ea-1f26aeb4ffe6",
                "contact": "example@dify.ai",
                "id": "36bd55ec-2ea9-4d75-a9ea-1f26aeb4ffe5",
                "expired_at": "2026-01-01T01:56:17",
                "updated_at": "2025-10-16T01:56:17",
            },
            {
                "created_at": "2025-10-16T02:00:00",
                "tenant_id": "tenant-2",
                "contact": "test@example.com",
                "id": "whitelist-id-2",
                "expired_at": "2026-02-01T00:00:00",
                "updated_at": "2025-10-16T02:00:00",
            },
            {
                "created_at": "2025-10-16T03:00:00",
                "tenant_id": "tenant-3",
                "contact": "another@example.com",
                "id": "whitelist-id-3",
                "expired_at": "2026-03-01T00:00:00",
                "updated_at": "2025-10-16T03:00:00",
            },
        ]
        mock_send_request.return_value = {"data": api_response}

        # Act
        result = BillingService.get_expired_subscription_cleanup_whitelist()

        # Assert - should return only tenant_ids
        assert result == ["36bd55ec-2ea9-4d75-a9ea-1f26aeb4ffe6", "tenant-2", "tenant-3"]
        assert len(result) == 3
        assert result[0] == "36bd55ec-2ea9-4d75-a9ea-1f26aeb4ffe6"
        assert result[1] == "tenant-2"
        assert result[2] == "tenant-3"
        mock_send_request.assert_called_once_with("GET", "/subscription/cleanup/whitelist")

    def test_get_expired_subscription_cleanup_whitelist_empty_list(self, mock_send_request):
        """Test retrieval of empty cleanup whitelist."""
        # Arrange
        mock_send_request.return_value = {"data": []}

        # Act
        result = BillingService.get_expired_subscription_cleanup_whitelist()

        # Assert
        assert result == []
        assert len(result) == 0


class TestBillingServiceIntegrationScenarios:
    """Integration-style tests simulating real-world usage scenarios.

    These tests combine multiple service methods to test common workflows:
    - Complete subscription upgrade flow
    - Usage tracking and refund workflow
    - Rate limit boundary testing
    """

    @pytest.fixture
    def mock_send_request(self):
        """Mock _send_request method."""
        with patch.object(BillingService, "_send_request") as mock:
            yield mock

    def test_subscription_upgrade_workflow(self, mock_send_request):
        """Test complete subscription upgrade workflow."""
        # Arrange
        tenant_id = "tenant-upgrade"

        # Step 1: Get current billing info
        mock_send_request.return_value = {
            "subscription_plan": "sandbox",
            "billing_cycle": "monthly",
            "status": "active",
        }
        current_info = BillingService.get_info(tenant_id)
        assert current_info["subscription_plan"] == "sandbox"

        # Step 2: Get payment link for upgrade
        mock_send_request.return_value = {"payment_link": "https://payment.example.com/upgrade"}
        payment_link = BillingService.get_subscription("professional", "monthly", "user@example.com", tenant_id)
        assert "payment_link" in payment_link

        # Step 3: Verify new rate limits after upgrade
        mock_send_request.return_value = {"limit": 100, "subscription_plan": CloudPlan.PROFESSIONAL}
        rate_limit = BillingService.get_knowledge_rate_limit(tenant_id)
        assert rate_limit["subscription_plan"] == CloudPlan.PROFESSIONAL
        assert rate_limit["limit"] == 100

    def test_usage_tracking_and_refund_workflow(self, mock_send_request):
        """Test usage tracking with subsequent refund."""
        # Arrange
        tenant_id = "tenant-usage"
        feature_key = "workflow"

        # Step 1: Consume credits
        mock_send_request.return_value = {"result": "success", "history_id": "hist-consume-123"}
        consume_result = BillingService.update_tenant_feature_plan_usage(tenant_id, feature_key, -10)
        history_id = consume_result["history_id"]
        assert history_id == "hist-consume-123"

        # Step 2: Check current usage
        mock_send_request.return_value = {"used": 10, "limit": 100, "remaining": 90}
        usage = BillingService.get_tenant_feature_plan_usage(tenant_id, feature_key)
        assert usage["used"] == 10
        assert usage["remaining"] == 90

        # Step 3: Refund the usage
        mock_send_request.return_value = {"result": "success", "history_id": history_id}
        refund_result = BillingService.refund_tenant_feature_plan_usage(history_id)
        assert refund_result["result"] == "success"

        # Step 4: Verify usage after refund
        mock_send_request.return_value = {"used": 0, "limit": 100, "remaining": 100}
        updated_usage = BillingService.get_tenant_feature_plan_usage(tenant_id, feature_key)
        assert updated_usage["used"] == 0
        assert updated_usage["remaining"] == 100

    def test_compliance_download_multiple_requests_within_limit(self, mock_send_request):
        """Test multiple compliance downloads within rate limit."""
        # Arrange
        account_id = "account-compliance"
        tenant_id = "tenant-compliance"
        doc_name = "compliance_report.pdf"
        ip = "192.168.1.1"
        device_info = "Mozilla/5.0"

        # Mock rate limiter to allow 3 requests (under limit of 4)
        with (
            patch.object(
                BillingService.compliance_download_rate_limiter, "is_rate_limited", side_effect=[False, False, False]
            ) as mock_is_limited,
            patch.object(BillingService.compliance_download_rate_limiter, "increment_rate_limit") as mock_increment,
        ):
            mock_send_request.return_value = {"download_link": "https://example.com/download"}

            # Act - Make 3 requests
            for i in range(3):
                result = BillingService.get_compliance_download_link(doc_name, account_id, tenant_id, ip, device_info)
                assert "download_link" in result

            # Assert - All 3 requests succeeded
            assert mock_is_limited.call_count == 3
            assert mock_increment.call_count == 3

    def test_education_verification_and_activation_flow(self, mock_send_request):
        """Test complete education verification and activation flow."""
        # Arrange
        account = MagicMock(spec=Account)
        account.id = "account-edu"
        account.email = "student@mit.edu"
        account.current_tenant_id = "tenant-edu"

        # Step 1: Search for institution
        with (
            patch.object(
                BillingService.EducationIdentity.verification_rate_limit, "is_rate_limited", return_value=False
            ),
            patch.object(BillingService.EducationIdentity.verification_rate_limit, "increment_rate_limit"),
        ):
            mock_send_request.return_value = {
                "institutions": [{"name": "Massachusetts Institute of Technology", "domain": "mit.edu"}]
            }
            institutions = BillingService.EducationIdentity.autocomplete("MIT")
            assert len(institutions["institutions"]) > 0

        # Step 2: Verify email
        with (
            patch.object(
                BillingService.EducationIdentity.verification_rate_limit, "is_rate_limited", return_value=False
            ),
            patch.object(BillingService.EducationIdentity.verification_rate_limit, "increment_rate_limit"),
        ):
            mock_send_request.return_value = {"verified": True, "institution": "MIT"}
            verify_result = BillingService.EducationIdentity.verify(account.id, account.email)
            assert verify_result["verified"] is True

        # Step 3: Check status
        mock_send_request.return_value = {"verified": True, "institution": "MIT", "role": "student"}
        status = BillingService.EducationIdentity.status(account.id)
        assert status["verified"] is True

        # Step 4: Activate education benefits
        with (
            patch.object(BillingService.EducationIdentity.activation_rate_limit, "is_rate_limited", return_value=False),
            patch.object(BillingService.EducationIdentity.activation_rate_limit, "increment_rate_limit"),
        ):
            mock_send_request.return_value = {"result": "success", "activated": True}
            activate_result = BillingService.EducationIdentity.activate(account, "token-123", "MIT", "student")
            assert activate_result["activated"] is True
