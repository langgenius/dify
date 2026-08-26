"""Comprehensive unit tests for BillingService.

This test module covers all aspects of the billing service including:
- HTTP request handling with retry logic
- Subscription tier management and billing information retrieval
- Usage calculation and credit management (positive/negative deltas)
- Compliance and education billing-provider requests
- Account management and permission checks
- Cache management for billing data
- Partner integration features

Network, billing-provider, and cache boundaries are mocked.
Tests follow the Arrange-Act-Assert pattern for clarity.
"""

import json
import logging
from unittest.mock import MagicMock, patch

import httpx
import pytest
from werkzeug.exceptions import InternalServerError

from enums import CloudPlan
from models import Account, Tenant
from services.billing_service import BillingService, _BillingHTTPStatusError
from services.errors.billing import (
    BillingUpstreamInvalidResponseError,
    BillingUpstreamUnavailableError,
)

TENANT_ID = "11111111-1111-1111-1111-111111111111"
ACCOUNT_ID = "33333333-3333-3333-3333-333333333333"


def _account(*, account_id: str = ACCOUNT_ID, email: str = "user@example.com", tenant_id: str = TENANT_ID) -> Account:
    tenant = Tenant(name="Test Tenant")
    tenant.id = tenant_id
    account = Account(name="Test User", email=email)
    account.id = account_id
    account._current_tenant = tenant
    return account


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
        with patch("services.billing_service._http_client.request") as mock_request:
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

    def test_send_request_with_base_url_override(self, mock_httpx_request, mock_billing_config):
        """Quota APIs can use the new billing service without changing legacy billing calls."""
        # Arrange
        expected_response = {"result": "success"}
        mock_response = MagicMock()
        mock_response.status_code = httpx.codes.OK
        mock_response.json.return_value = expected_response
        mock_httpx_request.return_value = mock_response

        # Act
        result = BillingService._send_request("GET", "/quota/balance", base_url="https://quota.example.com")

        # Assert
        assert result == expected_response
        call_args = mock_httpx_request.call_args
        assert call_args[0][1] == "https://quota.example.com/quota/balance"

    @pytest.mark.parametrize(
        "status_code", [httpx.codes.NOT_FOUND, httpx.codes.INTERNAL_SERVER_ERROR, httpx.codes.BAD_REQUEST]
    )
    def test_get_request_non_200_status_code(self, mock_httpx_request, mock_billing_config, status_code):
        """Test GET request preserves the upstream status for its public caller."""
        # Arrange
        mock_response = MagicMock()
        mock_response.status_code = status_code
        mock_httpx_request.return_value = mock_response

        # Act & Assert
        with pytest.raises(_BillingHTTPStatusError) as exc_info:
            BillingService._send_request("GET", "/test")
        assert exc_info.value.status_code == status_code
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

    def test_new_agent_beta_ensure_uses_secret_authenticated_v1_base(self, mock_httpx_request, mock_billing_config):
        mock_response = MagicMock()
        mock_response.status_code = httpx.codes.OK
        mock_response.json.return_value = {"status": "issued"}
        mock_httpx_request.return_value = mock_response

        BillingService.ensure_new_agent_beta_revision("revision-1")

        call_args = mock_httpx_request.call_args
        assert call_args.args == (
            "POST",
            "https://billing-api.example.com/new-agent-beta/revisions/revision-1/ensure",
        )
        assert call_args.kwargs["headers"]["Billing-Api-Secret-Key"] == "test-secret-key"

    def test_new_agent_beta_ensure_requires_json_response(self, mock_httpx_request, mock_billing_config):
        mock_response = MagicMock()
        mock_response.status_code = httpx.codes.OK
        mock_response.json.side_effect = json.JSONDecodeError("Expecting value", "", 0)
        mock_httpx_request.return_value = mock_response

        with pytest.raises(json.JSONDecodeError):
            BillingService.ensure_new_agent_beta_revision("revision-1")

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
        with pytest.raises(_BillingHTTPStatusError) as exc_info:
            BillingService._send_request("POST", "/test", json={"key": "value"})
        assert "Unable to send request to" in str(exc_info.value)
        assert exc_info.value.status_code == status_code

    @pytest.mark.parametrize(
        "status_code", [httpx.codes.BAD_REQUEST, httpx.codes.INTERNAL_SERVER_ERROR, httpx.codes.NOT_FOUND]
    )
    def test_delete_request_non_200_with_valid_json(
        self, mock_httpx_request, mock_billing_config, status_code, caplog: pytest.LogCaptureFixture
    ):
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
        with caplog.at_level(logging.ERROR, logger="services.billing_service"):
            with pytest.raises(ValueError) as exc_info:
                BillingService._send_request("DELETE", "/test", json={"key": "value"})
            assert "Unable to process delete request" in str(exc_info.value)
            assert "DELETE response" in caplog.text

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
        # POST checks status code before calling response.json().
        with pytest.raises(_BillingHTTPStatusError) as exc_info:
            BillingService._send_request("POST", "/test", json={"key": "value"})
        assert "Unable to send request to" in str(exc_info.value)
        assert exc_info.value.status_code == status_code

    @pytest.mark.parametrize(
        "status_code", [httpx.codes.BAD_REQUEST, httpx.codes.INTERNAL_SERVER_ERROR, httpx.codes.NOT_FOUND]
    )
    def test_delete_request_non_200_with_invalid_json(
        self, mock_httpx_request, mock_billing_config, status_code, caplog: pytest.LogCaptureFixture
    ):
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
        with caplog.at_level(logging.ERROR, logger="services.billing_service"):
            with pytest.raises(ValueError) as exc_info:
                BillingService._send_request("DELETE", "/test", json={"key": "value"})
            assert "Unable to process delete request" in str(exc_info.value)
            assert "DELETE response" in caplog.text

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


class TestBillingServicePortalRequest:
    def test_sends_get_request(self) -> None:
        params = {"tenant_id": "tenant-1"}
        with patch.object(
            BillingService,
            "_send_request",
            return_value={"url": "https://example.com", "ignored": True},
        ) as send_request:
            result = BillingService._send_billing_portal_request("/test", params=params)

        assert result == {"url": "https://example.com"}
        send_request.assert_called_once_with("GET", "/test", params=params)

    def test_invalid_response_shape_is_invalid_upstream_response(self) -> None:
        with patch.object(BillingService, "_send_request", return_value={}):
            with pytest.raises(BillingUpstreamInvalidResponseError):
                BillingService._send_billing_portal_request("/test", params={})

    @pytest.mark.parametrize(
        "status_code",
        [httpx.codes.BAD_REQUEST, httpx.codes.UNAUTHORIZED, httpx.codes.NOT_FOUND],
    )
    def test_terminal_http_response_is_invalid_upstream_response(self, status_code: int) -> None:
        with patch.object(
            BillingService,
            "_send_request",
            side_effect=_BillingHTTPStatusError("request failed", status_code),
        ):
            with pytest.raises(BillingUpstreamInvalidResponseError):
                BillingService._send_billing_portal_request("/test", params={})

    @pytest.mark.parametrize(
        "status_code",
        [httpx.codes.REQUEST_TIMEOUT, httpx.codes.TOO_MANY_REQUESTS, httpx.codes.INTERNAL_SERVER_ERROR],
    )
    def test_retryable_http_response_is_unavailable(self, status_code: int) -> None:
        with patch.object(
            BillingService,
            "_send_request",
            side_effect=_BillingHTTPStatusError("request failed", status_code),
        ):
            with pytest.raises(BillingUpstreamUnavailableError):
                BillingService._send_billing_portal_request("/test", params={})

    def test_transport_failure_is_unavailable(self) -> None:
        with patch.object(
            BillingService,
            "_send_request",
            side_effect=httpx.RequestError("network error"),
        ):
            with pytest.raises(BillingUpstreamUnavailableError):
                BillingService._send_billing_portal_request("/test", params={})

    @pytest.mark.parametrize(
        "decode_error",
        [
            json.JSONDecodeError("Expecting value", "", 0),
            UnicodeDecodeError("utf-8", b"\xff", 0, 1, "invalid start byte"),
        ],
    )
    def test_invalid_payload_is_invalid_upstream_response(self, decode_error: Exception) -> None:
        with patch.object(BillingService, "_send_request", side_effect=decode_error):
            with pytest.raises(BillingUpstreamInvalidResponseError):
                BillingService._send_billing_portal_request("/test", params={})

    def test_unknown_error_is_not_reclassified(self) -> None:
        with patch.object(BillingService, "_send_request", side_effect=RuntimeError("programming error")):
            with pytest.raises(RuntimeError, match="programming error"):
                BillingService._send_billing_portal_request("/test", params={})

    def test_unknown_value_error_is_not_exposed_as_invalid_request(self) -> None:
        original_error = ValueError("programming error")
        with patch.object(BillingService, "_send_request", side_effect=original_error):
            with pytest.raises(RuntimeError, match="Unexpected billing service value error") as exc_info:
                BillingService._send_billing_portal_request("/test", params={})

        assert exc_info.value.__cause__ is original_error


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
            "enabled": True,
            "subscription": {"plan": "professional", "interval": "month", "education": False},
            "members": {"size": 1, "limit": 50},
            "apps": {"size": 1, "limit": 200},
            "vector_space": {"size": 0.0, "limit": 20480},
            "knowledge_rate_limit": {"limit": 1000},
            "documents_upload_quota": {"size": 0, "limit": 1000},
            "annotation_quota_limit": {"size": 0, "limit": 5000},
            "docs_processing": "top-priority",
            "can_replace_logo": True,
            "model_load_balancing_enabled": True,
            "knowledge_pipeline_publish_enabled": True,
            "next_credit_reset_date": 1775952000,
        }
        mock_send_request.return_value = expected_response

        # Act
        result = BillingService.get_info(tenant_id)

        # Assert
        assert result == expected_response
        mock_send_request.assert_called_once_with("GET", "/subscription/info", params={"tenant_id": tenant_id})

    def test_get_info_exclude_vector_space(self, mock_send_request):
        """When requested, get_info asks billing to skip vector_space."""
        # Arrange
        tenant_id = "tenant-123"
        expected_response = {
            "enabled": True,
            "subscription": {"plan": "professional", "interval": "month", "education": False},
            "members": {"size": 1, "limit": 50},
            "apps": {"size": 1, "limit": 200},
            "knowledge_rate_limit": {"limit": 1000},
            "documents_upload_quota": {"size": 0, "limit": 1000},
            "annotation_quota_limit": {"size": 0, "limit": 5000},
            "docs_processing": "top-priority",
            "can_replace_logo": True,
            "model_load_balancing_enabled": True,
            "knowledge_pipeline_publish_enabled": True,
        }
        mock_send_request.return_value = expected_response

        # Act
        result = BillingService.get_info(tenant_id, exclude_vector_space=True)

        # Assert
        assert "vector_space" not in result
        mock_send_request.assert_called_once_with(
            "GET",
            "/subscription/info",
            params={"tenant_id": tenant_id, "exclude_vector_space": "true"},
        )

    def test_get_info_exclude_vector_space_normalizes_null_field(self, mock_send_request):
        """When billing serializes skipped vector_space as null, get_info treats it as absent."""
        # Arrange
        tenant_id = "tenant-123"
        expected_response = {
            "enabled": True,
            "subscription": {"plan": "professional", "interval": "month", "education": False},
            "members": {"size": 1, "limit": 50},
            "apps": {"size": 1, "limit": 200},
            "vector_space": None,
            "knowledge_rate_limit": {"limit": 1000},
            "documents_upload_quota": {"size": 0, "limit": 1000},
            "annotation_quota_limit": {"size": 0, "limit": 5000},
            "docs_processing": "top-priority",
            "can_replace_logo": True,
            "model_load_balancing_enabled": True,
            "knowledge_pipeline_publish_enabled": True,
        }
        mock_send_request.return_value = expected_response

        # Act
        result = BillingService.get_info(tenant_id, exclude_vector_space=True)

        # Assert
        assert "vector_space" not in result
        mock_send_request.assert_called_once_with(
            "GET",
            "/subscription/info",
            params={"tenant_id": tenant_id, "exclude_vector_space": "true"},
        )

    def test_get_vector_space_success(self, mock_send_request):
        """Test successful retrieval of vector-space usage and limit."""
        # Arrange
        tenant_id = "tenant-123"
        expected_response = {"size": 5120.75, "limit": 20480}
        mock_send_request.return_value = expected_response

        # Act
        result = BillingService.get_vector_space(tenant_id)

        # Assert
        assert result == expected_response
        mock_send_request.assert_called_once_with(
            "GET",
            "/subscription/vector-space",
            params={"tenant_id": tenant_id},
        )

    def test_get_vector_space_preserves_unknown_usage(self, mock_send_request):
        tenant_id = "tenant-123"
        expected_response = {"size": 0.0, "limit": 50, "usage_unknown": True}
        mock_send_request.return_value = expected_response

        result = BillingService.get_vector_space(tenant_id)

        assert result == expected_response

    def test_get_info_preserves_unknown_vector_space_usage(self, mock_send_request):
        tenant_id = "tenant-123"
        expected_response = {
            "enabled": True,
            "subscription": {"plan": "sandbox", "interval": "", "education": False},
            "members": {"size": 1, "limit": 1},
            "apps": {"size": 1, "limit": 10},
            "vector_space": {"size": 0.0, "limit": 50, "usage_unknown": True},
            "knowledge_rate_limit": {"limit": 10},
            "documents_upload_quota": {"size": 1, "limit": 50},
            "annotation_quota_limit": {"size": 0, "limit": 10},
            "docs_processing": "standard",
            "can_replace_logo": False,
            "model_load_balancing_enabled": False,
            "knowledge_pipeline_publish_enabled": False,
        }
        mock_send_request.return_value = expected_response

        result = BillingService.get_info(tenant_id)

        assert result["vector_space"]["usage_unknown"] is True

    def test_get_vector_space_bypasses_cache(self, mock_send_request):
        tenant_id = "tenant-123"
        mock_send_request.return_value = {"size": 4096, "limit": 20480}

        result = BillingService.get_vector_space(tenant_id, bypass_cache=True)

        assert result == {"size": 4096, "limit": 20480}
        mock_send_request.assert_called_once_with(
            "GET",
            "/subscription/vector-space",
            params={"tenant_id": tenant_id, "bypass_cache": "true"},
        )

    def test_invalidate_vector_space_cache_bypasses_cache(self):
        tenant_id = "tenant-123"

        with patch.object(BillingService, "get_vector_space") as get_vector_space:
            BillingService.invalidate_vector_space_cache(tenant_id)

        get_vector_space.assert_called_once_with(tenant_id, bypass_cache=True)

    def test_quota_get_balance_uses_quota_request(self):
        tenant_id = "tenant-123"
        with patch.object(BillingService, "_send_quota_request") as mock_send_quota_request:
            mock_send_quota_request.return_value = {
                "quota": "200",
                "usage": "6",
                "available": "194",
                "reserved": "0",
                "exhausted_at": "1748908800",
            }

            result = BillingService.quota_get_balance(tenant_id, "credit_pool", bucket="trial")

        assert result == {"quota": 200, "usage": 6, "available": 194, "reserved": 0, "exhausted_at": 1748908800}
        mock_send_quota_request.assert_called_once_with(
            "GET",
            "/quota/balance",
            params={"tenant_id": tenant_id, "feature_key": "credit_pool", "bucket": "trial"},
        )

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

    def test_get_subscription_payment_link(self):
        """Test subscription payment link generation."""
        # Arrange
        plan = "professional"
        interval = "month"
        email = "user@example.com"
        tenant_id = "tenant-123"
        expected_response = {"url": "https://payment.example.com/checkout"}
        with patch.object(
            BillingService, "_send_billing_portal_request", return_value=expected_response
        ) as send_request:
            result = BillingService.get_subscription(plan, interval, email, tenant_id)

        # Assert
        assert result == expected_response
        send_request.assert_called_once_with(
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

    def test_get_invoices(self):
        """Test invoice retrieval."""
        # Arrange
        email = "user@example.com"
        tenant_id = "tenant-123"
        expected_response = {"url": "https://payment.example.com/invoices"}
        with patch.object(
            BillingService, "_send_billing_portal_request", return_value=expected_response
        ) as send_request:
            result = BillingService.get_invoices(email, tenant_id)

        # Assert
        assert result == expected_response
        send_request.assert_called_once_with("/invoices", params={"prefilled_email": email, "tenant_id": tenant_id})


class TestBillingServiceUsageCalculation:
    """Unit tests for usage calculation and credit management.

    Tests cover:
    - Quota information retrieval
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

    def test_get_quota_info(self):
        """Test retrieval of quota info from new endpoint."""
        # Arrange
        tenant_id = "tenant-123"
        expected_response = {"trigger_event": {"limit": 100, "usage": 30}, "api_rate_limit": {"limit": -1, "usage": 0}}
        with patch.object(BillingService, "_send_quota_request") as mock_send_quota_request:
            mock_send_quota_request.return_value = expected_response

            # Act
            result = BillingService.get_quota_info(tenant_id)

        # Assert
        assert result == expected_response
        mock_send_quota_request.assert_called_once_with("GET", "/quota/info", params={"tenant_id": tenant_id})

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


class TestBillingServiceQuotaOperations:
    """Unit tests for quota reserve/commit/release operations."""

    @pytest.fixture
    def mock_send_request(self):
        with patch.object(BillingService, "_send_quota_request") as mock:
            yield mock

    def test_quota_reserve_success(self, mock_send_request):
        expected = {"reservation_id": "rid-1", "available": 99, "reserved": 1}
        mock_send_request.return_value = expected

        result = BillingService.quota_reserve(tenant_id="t1", feature_key="trigger_event", request_id="req-1", amount=1)

        assert result == expected
        mock_send_request.assert_called_once_with(
            "POST",
            "/quota/reserve",
            json={"tenant_id": "t1", "feature_key": "trigger_event", "request_id": "req-1", "amount": 1},
        )

    def test_quota_reserve_coerces_string_to_int(self, mock_send_request):
        """Test that TypeAdapter coerces string values to int."""
        mock_send_request.return_value = {"reservation_id": "rid-str", "available": "99", "reserved": "1"}

        result = BillingService.quota_reserve(tenant_id="t1", feature_key="trigger_event", request_id="req-s", amount=1)

        assert result["available"] == 99
        assert isinstance(result["available"], int)
        assert result["reserved"] == 1
        assert isinstance(result["reserved"], int)

    def test_quota_reserve_with_meta(self, mock_send_request):
        mock_send_request.return_value = {"reservation_id": "rid-2", "available": 98, "reserved": 1}
        meta = {"source": "webhook"}

        BillingService.quota_reserve(
            tenant_id="t1", feature_key="trigger_event", request_id="req-2", amount=1, meta=meta
        )

        call_json = mock_send_request.call_args[1]["json"]
        assert call_json["meta"] == {"source": "webhook"}

    def test_quota_reserve_with_bucket(self, mock_send_request):
        mock_send_request.return_value = {"reservation_id": "rid-2", "available": 98, "reserved": 1}

        BillingService.quota_reserve(
            tenant_id="t1", feature_key="credit_pool", request_id="req-2", amount=1, bucket="trial"
        )

        call_json = mock_send_request.call_args[1]["json"]
        assert call_json["bucket"] == "trial"

    def test_quota_commit_success(self, mock_send_request):
        expected = {"available": 98, "reserved": 0, "refunded": 0}
        mock_send_request.return_value = expected

        result = BillingService.quota_commit(
            tenant_id="t1", feature_key="trigger_event", reservation_id="rid-1", actual_amount=1
        )

        assert result == expected
        mock_send_request.assert_called_once_with(
            "POST",
            "/quota/commit",
            json={
                "tenant_id": "t1",
                "feature_key": "trigger_event",
                "reservation_id": "rid-1",
                "actual_amount": 1,
            },
        )

    def test_quota_commit_coerces_string_to_int(self, mock_send_request):
        """Test that TypeAdapter coerces string values to int."""
        mock_send_request.return_value = {"available": "97", "reserved": "0", "refunded": "1"}

        result = BillingService.quota_commit(
            tenant_id="t1", feature_key="trigger_event", reservation_id="rid-s", actual_amount=1
        )

        assert result["available"] == 97
        assert isinstance(result["available"], int)
        assert result["refunded"] == 1
        assert isinstance(result["refunded"], int)

    def test_quota_commit_with_meta(self, mock_send_request):
        mock_send_request.return_value = {"available": 97, "reserved": 0, "refunded": 0}
        meta = {"reason": "partial"}

        BillingService.quota_commit(
            tenant_id="t1", feature_key="trigger_event", reservation_id="rid-1", actual_amount=1, meta=meta
        )

        call_json = mock_send_request.call_args[1]["json"]
        assert call_json["meta"] == {"reason": "partial"}

    def test_quota_commit_with_bucket(self, mock_send_request):
        mock_send_request.return_value = {"available": 97, "reserved": 0, "refunded": 0}

        BillingService.quota_commit(
            tenant_id="t1",
            feature_key="credit_pool",
            reservation_id="rid-1",
            actual_amount=1,
            bucket="paid",
        )

        call_json = mock_send_request.call_args[1]["json"]
        assert call_json["bucket"] == "paid"

    def test_quota_release_success(self, mock_send_request):
        expected = {"available": 100, "reserved": 0, "released": 1}
        mock_send_request.return_value = expected

        result = BillingService.quota_release(tenant_id="t1", feature_key="trigger_event", reservation_id="rid-1")

        assert result == expected
        mock_send_request.assert_called_once_with(
            "POST",
            "/quota/release",
            json={"tenant_id": "t1", "feature_key": "trigger_event", "reservation_id": "rid-1"},
        )

    def test_quota_release_coerces_string_to_int(self, mock_send_request):
        """Test that TypeAdapter coerces string values to int."""
        mock_send_request.return_value = {"available": "100", "reserved": "0", "released": "1"}

        result = BillingService.quota_release(tenant_id="t1", feature_key="trigger_event", reservation_id="rid-s")

        assert result["available"] == 100
        assert isinstance(result["available"], int)
        assert result["released"] == 1
        assert isinstance(result["released"], int)

    def test_quota_release_with_bucket(self, mock_send_request):
        mock_send_request.return_value = {"available": 100, "reserved": 0, "released": 1}

        BillingService.quota_release(tenant_id="t1", feature_key="credit_pool", reservation_id="rid-1", bucket="trial")

        call_json = mock_send_request.call_args[1]["json"]
        assert call_json["bucket"] == "trial"

    def test_quota_consume_capped_success(self, mock_send_request):
        mock_send_request.return_value = {
            "deducted": "2",
            "available": "8",
            "reserved": "0",
            "quota": "10",
            "usage": "2",
        }

        result = BillingService.quota_consume_capped(
            tenant_id="t1",
            feature_key="credit_pool",
            request_id="req-1",
            amount=5,
            bucket="paid",
            meta={"source": "test"},
        )

        assert result == {"deducted": 2, "available": 8, "reserved": 0, "quota": 10, "usage": 2}
        mock_send_request.assert_called_once_with(
            "POST",
            "/quota/consume-capped",
            json={
                "tenant_id": "t1",
                "feature_key": "credit_pool",
                "request_id": "req-1",
                "amount": 5,
                "bucket": "paid",
                "meta": {"source": "test"},
            },
        )

    def test_send_quota_request_uses_quota_base_url(self):
        with (
            patch.object(BillingService, "quota_base_url", "https://quota.example.com/v1"),
            patch.object(BillingService, "_send_request") as mock_send_request,
        ):
            mock_send_request.return_value = {"ok": True}

            result = BillingService._send_quota_request("GET", "/quota/info", params={"tenant_id": "t1"})

        assert result == {"ok": True}
        mock_send_request.assert_called_once_with(
            "GET",
            "/quota/info",
            json=None,
            params={"tenant_id": "t1"},
            base_url="https://quota.example.com/v1",
        )

    def test_get_quota_info_coerces_string_to_int(self, mock_send_request):
        """Test that TypeAdapter coerces string values to int for get_quota_info."""
        mock_send_request.return_value = {
            "trigger_event": {"usage": "42", "limit": "3000", "reset_date": "1700000000"},
            "api_rate_limit": {"usage": "10", "limit": "-1", "reset_date": "-1"},
        }

        result = BillingService.get_quota_info("t1")

        assert result["trigger_event"]["usage"] == 42
        assert isinstance(result["trigger_event"]["usage"], int)
        assert result["trigger_event"]["limit"] == 3000
        assert isinstance(result["trigger_event"]["limit"], int)
        assert result["trigger_event"]["reset_date"] == 1700000000
        assert isinstance(result["trigger_event"]["reset_date"], int)
        assert result["api_rate_limit"]["limit"] == -1
        assert isinstance(result["api_rate_limit"]["limit"], int)

    def test_get_quota_info_accepts_int_values(self, mock_send_request):
        """Test that get_quota_info works with native int values."""
        expected = {
            "trigger_event": {"usage": 42, "limit": 3000, "reset_date": 1700000000},
            "api_rate_limit": {"usage": 0, "limit": -1},
        }
        mock_send_request.return_value = expected

        result = BillingService.get_quota_info("t1")

        assert result["trigger_event"]["usage"] == 42
        assert result["trigger_event"]["limit"] == 3000
        assert result["api_rate_limit"]["limit"] == -1


class TestBillingServiceComplianceDownload:
    """Unit tests for compliance download requests."""

    @pytest.fixture
    def mock_send_request(self):
        """Mock _send_request method."""
        with patch.object(BillingService, "_send_request") as mock:
            yield mock

    def test_compliance_download_returns_validated_link(self, mock_send_request):
        doc_name = "compliance_report.pdf"
        account_id = "account-123"
        tenant_id = "tenant-456"
        ip = "192.168.1.1"
        device_info = "Mozilla/5.0"
        expected_response = {"url": "https://example.com/download", "ignored": True}
        mock_send_request.return_value = expected_response

        result = BillingService.get_compliance_download_link(doc_name, account_id, tenant_id, ip, device_info)

        assert result == {"url": "https://example.com/download"}
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

    @pytest.mark.parametrize(
        ("request_error", "error_type"),
        [
            (_BillingHTTPStatusError("request failed", httpx.codes.BAD_REQUEST), BillingUpstreamInvalidResponseError),
            (_BillingHTTPStatusError("request failed", httpx.codes.REQUEST_TIMEOUT), BillingUpstreamUnavailableError),
            (_BillingHTTPStatusError("request failed", httpx.codes.TOO_MANY_REQUESTS), BillingUpstreamUnavailableError),
            (
                _BillingHTTPStatusError("request failed", httpx.codes.INTERNAL_SERVER_ERROR),
                BillingUpstreamUnavailableError,
            ),
            (httpx.RequestError("request failed"), BillingUpstreamUnavailableError),
        ],
    )
    def test_compliance_download_maps_request_failure(
        self, mock_send_request, request_error: Exception, error_type: type[Exception]
    ) -> None:
        mock_send_request.side_effect = request_error

        with pytest.raises(error_type):
            BillingService.get_compliance_download_link("SOC2_Type_II", "account-1", "tenant-1", "127.0.0.1", "test")

    def test_compliance_download_rejects_invalid_response(self, mock_send_request) -> None:
        mock_send_request.return_value = {}

        with pytest.raises(BillingUpstreamInvalidResponseError):
            BillingService.get_compliance_download_link("SOC2_Type_II", "account-1", "tenant-1", "127.0.0.1", "test")


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

    def test_education_verify(self, mock_send_request):
        account_id = "account-123"
        expected_response = {"token": "education-token"}
        mock_send_request.return_value = expected_response

        result = BillingService.EducationIdentity.verify(account_id)

        assert result == expected_response
        mock_send_request.assert_called_once_with("GET", "/education/verify", params={"account_id": account_id})

    def test_education_activate(self, mock_send_request):
        expected_response = {"message": "success"}
        mock_send_request.return_value = expected_response

        result = BillingService.EducationIdentity.activate(
            account_id="account-123",
            tenant_id="tenant-456",
            token="verification-token",
            institution="MIT",
            role="student",
        )

        assert result == expected_response
        mock_send_request.assert_called_once_with(
            "POST",
            "/education/",
            json={"institution": "MIT", "token": "verification-token", "role": "student"},
            params={"account_id": "account-123", "curr_tenant_id": "tenant-456"},
        )

    def test_education_status(self, mock_send_request):
        """Test checking education verification status."""
        # Arrange
        account_id = "account-123"
        expected_response = {
            "result": True,
            "is_student": True,
            "expire_at": "2027-01-01T00:00:00Z",
            "allow_refresh": False,
        }
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
            "data": ["Massachusetts Institute of Technology", "University of Massachusetts"],
            "curr_page": 0,
            "has_next": False,
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
        expected_response = {"data": ["Stanford University"], "curr_page": 0, "has_next": False}
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

    def test_delete_account(self, mock_send_request):
        """Test account deletion."""
        # Arrange
        account_id = "account-123"
        expected_response = {"message": "Account deleted successfully."}
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

    def test_get_email_freeze_type_for_suspended_domain(self, mock_send_request):
        email = "user@suspended.example"
        mock_send_request.return_value = {"data": True, "freezeType": "email_domain_suspended"}

        result = BillingService.get_email_freeze_type(email)

        assert result == "email_domain_suspended"
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
        expected_response = {"message": "Reason added successfully."}
        mock_send_request.return_value = expected_response

        # Act
        result = BillingService.update_account_deletion_feedback(email, feedback)

        # Assert
        assert result == expected_response
        mock_send_request.assert_called_once_with(
            "POST", "/account/delete-feedback", json={"email": email, "feedback": feedback}
        )


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
        expected_response = {"message": "Successfully synced partner tenants"}
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
        """Empty response from billing API should raise ValidationError due to missing required fields."""
        from pydantic import ValidationError

        tenant_id = "tenant-empty"
        mock_send_request.return_value = {}

        with pytest.raises(ValidationError):
            BillingService.get_info(tenant_id)

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
        interval = "year"
        expected_response = {"url": "https://payment.example.com/checkout"}
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
        expected_response = {"url": "https://payment.example.com/invoices"}
        mock_send_request.return_value = expected_response

        # Act
        result = BillingService.get_invoices("", "")

        # Assert
        assert result == expected_response

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

    def test_get_plan_bulk_converts_string_expiration_date_to_int(self, mock_send_request):
        """Test bulk plan retrieval converts string expiration_date to int."""
        # Arrange
        tenant_ids = ["tenant-1"]
        mock_send_request.return_value = {
            "data": {
                "tenant-1": {"plan": "sandbox", "expiration_date": "1735689600"},
            }
        }

        # Act
        result = BillingService.get_plan_bulk(tenant_ids)

        # Assert
        assert "tenant-1" in result
        assert isinstance(result["tenant-1"]["expiration_date"], int)
        assert result["tenant-1"]["expiration_date"] == 1735689600

    def test_get_plan_bulk_with_invalid_tenant_plan_skipped(self, mock_send_request, caplog: pytest.LogCaptureFixture):
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
        with caplog.at_level(logging.ERROR, logger="services.billing_service"):
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
        exception_records = [r for r in caplog.records if r.levelname == "ERROR"]
        assert len(exception_records) == 1
        formatted = exception_records[0].getMessage()
        assert "get_plan_bulk: failed to validate subscription plan for tenant" in formatted
        assert "tenant-invalid" in formatted

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
            "enabled": True,
            "subscription": {"plan": "sandbox", "interval": "", "education": False},
            "members": {"size": 0, "limit": 1},
            "apps": {"size": 0, "limit": 5},
            "vector_space": {"size": 0.0, "limit": 50},
            "knowledge_rate_limit": {"limit": 10},
            "documents_upload_quota": {"size": 0, "limit": 50},
            "annotation_quota_limit": {"size": 0, "limit": 10},
            "docs_processing": "standard",
            "can_replace_logo": False,
            "model_load_balancing_enabled": False,
            "knowledge_pipeline_publish_enabled": False,
        }
        current_info = BillingService.get_info(tenant_id)
        assert current_info["subscription"]["plan"] == "sandbox"

        # Step 2: Get payment link for upgrade
        mock_send_request.return_value = {"url": "https://payment.example.com/upgrade"}
        payment_link = BillingService.get_subscription("professional", "month", "user@example.com", tenant_id)
        assert "url" in payment_link

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


class TestBillingServiceSubscriptionInfoDataType:
    """Unit tests for data type coercion in BillingService.get_info

    1. Verifies the get_info returns correct Python types for numeric fields
    2. Ensure the compatibility regardless of what results the upstream billing API returns
    """

    @pytest.fixture
    def mock_send_request(self):
        with patch.object(BillingService, "_send_request") as mock:
            yield mock

    @pytest.fixture
    def normal_billing_response(self) -> dict:
        return {
            "enabled": True,
            "subscription": {
                "plan": "team",
                "interval": "year",
                "education": False,
            },
            "members": {"size": 10, "limit": 50},
            "apps": {"size": 80, "limit": 200},
            "vector_space": {"size": 5120.75, "limit": 20480},
            "knowledge_rate_limit": {"limit": 1000},
            "documents_upload_quota": {"size": 450, "limit": 1000},
            "annotation_quota_limit": {"size": 1200, "limit": 5000},
            "docs_processing": "top-priority",
            "can_replace_logo": True,
            "model_load_balancing_enabled": True,
            "knowledge_pipeline_publish_enabled": True,
            "next_credit_reset_date": 1745971200,
        }

    @pytest.fixture
    def string_billing_response(self) -> dict:
        return {
            "enabled": True,
            "subscription": {
                "plan": "team",
                "interval": "year",
                "education": False,
            },
            "members": {"size": "10", "limit": "50"},
            "apps": {"size": "80", "limit": "200"},
            "vector_space": {"size": 5120.75, "limit": "20480"},
            "knowledge_rate_limit": {"limit": "1000"},
            "documents_upload_quota": {"size": "450", "limit": "1000"},
            "annotation_quota_limit": {"size": "1200", "limit": "5000"},
            "docs_processing": "top-priority",
            "can_replace_logo": True,
            "model_load_balancing_enabled": True,
            "knowledge_pipeline_publish_enabled": True,
            "next_credit_reset_date": "1745971200",
        }

    @staticmethod
    def _assert_billing_info_types(result: dict):
        assert isinstance(result["enabled"], bool)
        assert isinstance(result["subscription"]["plan"], str)
        assert isinstance(result["subscription"]["interval"], str)
        assert isinstance(result["subscription"]["education"], bool)

        assert isinstance(result["members"]["size"], int)
        assert isinstance(result["members"]["limit"], int)

        assert isinstance(result["apps"]["size"], int)
        assert isinstance(result["apps"]["limit"], int)

        if "vector_space" in result:
            assert isinstance(result["vector_space"]["size"], float)
            assert isinstance(result["vector_space"]["limit"], int)
            if "usage_unknown" in result["vector_space"]:
                assert isinstance(result["vector_space"]["usage_unknown"], bool)

        assert isinstance(result["knowledge_rate_limit"]["limit"], int)

        assert isinstance(result["documents_upload_quota"]["size"], int)
        assert isinstance(result["documents_upload_quota"]["limit"], int)

        assert isinstance(result["annotation_quota_limit"]["size"], int)
        assert isinstance(result["annotation_quota_limit"]["limit"], int)

        assert isinstance(result["docs_processing"], str)
        assert isinstance(result["can_replace_logo"], bool)
        assert isinstance(result["model_load_balancing_enabled"], bool)
        assert isinstance(result["knowledge_pipeline_publish_enabled"], bool)
        if "next_credit_reset_date" in result:
            assert isinstance(result["next_credit_reset_date"], int)

    def test_get_info_with_normal_types(self, mock_send_request, normal_billing_response):
        """When the billing API returns native numeric types, get_info should preserve them."""
        mock_send_request.return_value = normal_billing_response

        result = BillingService.get_info("tenant-type-test")

        self._assert_billing_info_types(result)
        mock_send_request.assert_called_once_with("GET", "/subscription/info", params={"tenant_id": "tenant-type-test"})

    def test_get_info_with_string_types(self, mock_send_request, string_billing_response):
        """When the billing API returns numeric values as strings, get_info should coerce them."""
        mock_send_request.return_value = string_billing_response

        result = BillingService.get_info("tenant-type-test")

        self._assert_billing_info_types(result)
        mock_send_request.assert_called_once_with("GET", "/subscription/info", params={"tenant_id": "tenant-type-test"})

    def test_get_info_without_optional_fields(self, mock_send_request, string_billing_response):
        """NotRequired fields can be absent without raising."""
        del string_billing_response["next_credit_reset_date"]
        del string_billing_response["vector_space"]
        mock_send_request.return_value = string_billing_response

        result = BillingService.get_info("tenant-type-test")

        assert "next_credit_reset_date" not in result
        assert "vector_space" not in result
        self._assert_billing_info_types(result)

    def test_get_info_with_extra_fields(self, mock_send_request, string_billing_response):
        """Undefined fields are silently stripped by validate_python."""
        string_billing_response["new_feature"] = "something"
        mock_send_request.return_value = string_billing_response

        result = BillingService.get_info("tenant-type-test")

        # extra fields are dropped by TypeAdapter on TypedDict
        assert "new_feature" not in result
        self._assert_billing_info_types(result)

    def test_get_info_missing_required_field_raises(self, mock_send_request, string_billing_response):
        """Missing a required field should raise ValidationError."""
        from pydantic import ValidationError

        del string_billing_response["members"]
        mock_send_request.return_value = string_billing_response

        with pytest.raises(ValidationError):
            BillingService.get_info("tenant-type-test")


def test_pooled_billing_client_carries_bounded_timeout() -> None:
    """Regression for #39874: the pooled billing client must carry a
    read/connect timeout so a stalled Stripe / cloud-billing proxy
    fails fast instead of pinning a worker. Same shape as the
    JinaReader / WaterCrawl hardening that landed in PR #39860 and #39824.
    """
    import services.billing_service as billing_service_module

    client = billing_service_module._http_client
    assert client.timeout is not None
    assert client.timeout.read == 30.0
    assert client.timeout.connect == 5.0
