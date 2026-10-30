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
from types import SimpleNamespace
from unittest.mock import MagicMock, call, patch

import httpx
import pytest
import tenacity
from werkzeug.exceptions import InternalServerError

from services.billing_client import billing, transport
from services.billing_service import BillingService, _BillingHTTPStatusError
from services.errors.billing import (
    BillingUpstreamInvalidResponseError,
    BillingUpstreamUnavailableError,
)
from tests.helpers import billing_builders as builders

TENANT_ID = "11111111-1111-1111-1111-111111111111"
ACCOUNT_ID = "33333333-3333-3333-3333-333333333333"


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
        with pytest.raises(ValueError, match="Invalid arguments\\.") as exc_info:
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
            with pytest.raises(
                ValueError,
                match=(
                    "Unable to process delete request https://billing\\-api\\.example\\.com"
                    "/test\\. Please try again later or contact support\\."
                ),
            ) as exc_info:
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
            with pytest.raises(
                ValueError,
                match=(
                    "Unable to process delete request https://billing\\-api\\.example\\.com"
                    "/test\\. Please try again later or contact support\\."
                ),
            ) as exc_info:
                BillingService._send_request("DELETE", "/test", json={"key": "value"})
            assert "Unable to process delete request" in str(exc_info.value)
            assert "DELETE response" in caplog.text

    @pytest.fixture
    def retry_sleep(self, monkeypatch: pytest.MonkeyPatch) -> MagicMock:
        """Advance a virtual clock while retaining the production retry policy."""
        elapsed = 0.0

        def advance(seconds: float) -> None:
            nonlocal elapsed
            elapsed += seconds

        sleep = MagicMock(side_effect=advance)
        # Replace tenacity's module reference, not the process-wide time module.
        monkeypatch.setattr(tenacity, "time", SimpleNamespace(monotonic=lambda: elapsed))
        monkeypatch.setattr("services.billing_service.BillingService._send_request.retry.sleep", sleep)
        return sleep

    def test_retry_on_request_error(
        self, mock_httpx_request: MagicMock, mock_billing_config: None, retry_sleep: MagicMock
    ) -> None:
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
        retry_sleep.assert_called_once_with(2)

    def test_retry_exhausted_raises_exception(
        self, mock_httpx_request: MagicMock, mock_billing_config: None, retry_sleep: MagicMock
    ) -> None:
        """Test that _send_request raises exception after retries are exhausted."""
        # Arrange
        mock_httpx_request.side_effect = httpx.RequestError("Network error")

        # Act & Assert
        with pytest.raises(httpx.RequestError):
            BillingService._send_request("GET", "/test")

        # The next two-second wait would reach the ten-second stop boundary.
        assert mock_httpx_request.call_count == 5
        assert retry_sleep.call_args_list == [call(2)] * 4


class TestBillingServiceSubscriptionInfo:
    """Subscription and usage reads delegate to the generated billing client."""

    def test_get_info_returns_the_generated_reply(self):
        reply = builders.subscription_info("team", vector_space=builders.vector_space(size=1.5, limit=50))

        with patch.object(billing, "subscription_get_subscription_info", return_value=reply) as get_info:
            result = BillingService.get_info(TENANT_ID, exclude_vector_space=True)

        assert result is reply
        get_info.assert_called_once_with(tenant_id=TENANT_ID, exclude_vector_space=True)

    @pytest.mark.parametrize("bypass_cache", [False, True])
    def test_get_vector_space_forwards_bypass_cache(self, bypass_cache: bool):
        reply = builders.vector_space(size=12.5, limit=50, usage_unknown=True)

        with patch.object(billing, "subscription_get_subscription_vector_space", return_value=reply) as get:
            result = BillingService.get_vector_space(TENANT_ID, bypass_cache=bypass_cache)

        assert result is reply
        get.assert_called_once_with(tenant_id=TENANT_ID, bypass_cache=bypass_cache)

    def test_get_knowledge_rate_limit_returns_the_generated_reply(self):
        reply = billing.GetKnowledgeRateLimitReply(subscription_plan="professional", limit=100)

        with patch.object(billing, "subscription_get_knowledge_rate_limit", return_value=reply) as get:
            result = BillingService.get_knowledge_rate_limit(TENANT_ID)

        assert result is reply
        get.assert_called_once_with(tenant_id=TENANT_ID)

    def test_get_subscription_returns_the_portal_link(self):
        reply = billing.GetSubscriptionPaymentLinkReply(url="https://payment.example.com/checkout")

        with patch.object(billing, "subscription_get_subscription_payment_link", return_value=reply) as get:
            result = BillingService.get_subscription("professional", "month", "user@example.com", TENANT_ID)

        assert result == {"url": "https://payment.example.com/checkout"}
        get.assert_called_once_with(
            plan="professional", interval="month", prefilled_email="user@example.com", tenant_id=TENANT_ID
        )

    def test_get_invoices_returns_the_portal_link(self):
        reply = billing.GetInvoicesReply(url="https://billing.example.com/invoices")

        with patch.object(billing, "invoice_get_invoices", return_value=reply) as get:
            result = BillingService.get_invoices("user@example.com", TENANT_ID)

        assert result == {"url": "https://billing.example.com/invoices"}
        get.assert_called_once_with(prefilled_email="user@example.com", tenant_id=TENANT_ID)

    def test_get_model_provider_payment_link_returns_the_generated_reply(self):
        reply = billing.GetModelProviderPaymentLinkReply(url="https://payment.example.com/provider")

        with patch.object(billing, "model_provider_get_model_provider_payment_link", return_value=reply) as get:
            # pyrefly: ignore [deprecated]
            result = BillingService.get_model_provider_payment_link("anthropic", TENANT_ID, ACCOUNT_ID, "a@b.com")

        assert result is reply
        get.assert_called_once_with(
            provider_name="anthropic", tenant_id=TENANT_ID, account_id=ACCOUNT_ID, prefilled_email="a@b.com"
        )

    def test_get_plan_bulk_chunks_requests_and_skips_failed_batches(self):
        tenant_ids = [f"tenant-{i}" for i in range(450)]

        def batch(*, body: billing.BatchGetSubscriptionPlanReq) -> billing.BatchGetSubscriptionPlanReply:
            if body.tenant_ids[0] == "tenant-200":
                raise BillingUpstreamUnavailableError("POST /subscription/plan/batch failed")
            return billing.BatchGetSubscriptionPlanReply(
                data={tenant_id: builders.plan_item("team", 1735689600) for tenant_id in body.tenant_ids}
            )

        with patch.object(billing, "subscription_batch_get_subscription_plan", side_effect=batch) as get:
            result = BillingService.get_plan_bulk(tenant_ids)

        assert [len(c.kwargs["body"].tenant_ids) for c in get.call_args_list] == [200, 200, 50]
        assert set(result) == set(tenant_ids[:200] + tenant_ids[400:])
        assert result["tenant-0"] == builders.plan_item("team", 1735689600)

    def test_get_plan_bulk_skips_invalid_items_from_http_response(self, monkeypatch: pytest.MonkeyPatch) -> None:
        payload = {
            "data": {
                "valid": {"plan": "sandbox", "expiration_date": "-1"},
                "missing_expiration": {"plan": "sandbox"},
                "invalid_expiration": {"plan": "sandbox", "expiration_date": "invalid"},
                "missing_plan": {"expiration_date": -1},
                "invalid_item": "not-an-object",
                "null_item": None,
            }
        }
        monkeypatch.setenv("BILLING_API_URL", "http://billing/v1")
        with httpx.Client(transport=httpx.MockTransport(lambda _: httpx.Response(200, json=payload))) as client:
            monkeypatch.setattr(transport, "_http_client", client)

            plans = BillingService.get_plan_bulk(list(payload["data"]))

        assert plans == {"valid": builders.plan_item("sandbox", -1)}

    def test_get_expired_subscription_cleanup_whitelist_returns_tenant_ids(self):
        reply = billing.ListSubscriptionCleanupWhitelistReply(
            data=[
                billing.SubscriptionCleanupWhitelist(
                    id=f"wl-{tenant_id}",
                    tenant_id=tenant_id,
                    contact="ops@example.com",
                    expired_at="2026-01-01T00:00:00Z",
                    created_at="2025-01-01T00:00:00Z",
                    updated_at="2025-01-01T00:00:00Z",
                )
                for tenant_id in ("tenant-a", "tenant-b")
            ]
        )

        with patch.object(billing, "subscription_list_subscription_cleanup_whitelist", return_value=reply):
            assert BillingService.get_expired_subscription_cleanup_whitelist() == ["tenant-a", "tenant-b"]

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


class TestBillingServiceUsageCalculation:
    """Unit tests for usage calculation and credit management.

    Tests cover:
    - Quota information retrieval
    """

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

    @pytest.mark.parametrize(
        ("status_code", "error_type"),
        [
            (409, BillingUpstreamInvalidResponseError),
            (429, BillingUpstreamUnavailableError),
            (503, BillingUpstreamUnavailableError),
        ],
    )
    def test_quota_commit_classifies_permanent_and_retryable_http_errors(
        self,
        mock_send_request,
        status_code,
        error_type,
    ):
        mock_send_request.side_effect = _BillingHTTPStatusError("quota settlement failed", status_code)

        with pytest.raises(error_type):
            BillingService.quota_commit(
                tenant_id="t1",
                feature_key="trigger_event",
                reservation_id="rid-1",
                actual_amount=1,
            )

    def test_quota_commit_treats_unknown_response_as_retryable(self, mock_send_request):
        mock_send_request.return_value = {"unexpected": "response"}

        with pytest.raises(BillingUpstreamUnavailableError):
            BillingService.quota_commit(
                tenant_id="t1",
                feature_key="trigger_event",
                reservation_id="rid-1",
                actual_amount=1,
            )

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
