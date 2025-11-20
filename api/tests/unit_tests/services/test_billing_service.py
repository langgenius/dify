import json
from unittest.mock import MagicMock, patch

import httpx
import pytest
from werkzeug.exceptions import InternalServerError

from services.billing_service import BillingService


class TestBillingServiceSendRequest:
    """Unit tests for BillingService._send_request method."""

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
    def test_post_request_non_200_with_valid_json(
        self, mock_httpx_request, mock_billing_config, status_code
    ):
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
    def test_delete_request_non_200_with_valid_json(
        self, mock_httpx_request, mock_billing_config, status_code
    ):
        """Test DELETE request with non-200 status code but valid JSON response.
        
        DELETE doesn't check status code, so it returns the error JSON.
        """
        # Arrange
        error_response = {"detail": "Error message"}
        mock_response = MagicMock()
        mock_response.status_code = status_code
        mock_response.json.return_value = error_response
        mock_httpx_request.return_value = mock_response

        # Act
        result = BillingService._send_request("DELETE", "/test", json={"key": "value"})

        # Assert
        assert result == error_response

    @pytest.mark.parametrize(
        "status_code", [httpx.codes.BAD_REQUEST, httpx.codes.INTERNAL_SERVER_ERROR, httpx.codes.NOT_FOUND]
    )
    def test_post_request_non_200_with_invalid_json(
        self, mock_httpx_request, mock_billing_config, status_code
    ):
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
    def test_delete_request_non_200_with_invalid_json(
        self, mock_httpx_request, mock_billing_config, status_code
    ):
        """Test DELETE request with non-200 status code and invalid JSON response raises exception.

        DELETE doesn't check status code, so it calls response.json() which raises JSONDecodeError
        when the response cannot be parsed as JSON (e.g., empty response).
        """
        # Arrange
        mock_response = MagicMock()
        mock_response.status_code = status_code
        mock_response.text = ""
        mock_response.json.side_effect = json.JSONDecodeError("Expecting value", "", 0)
        mock_httpx_request.return_value = mock_response

        # Act & Assert
        with pytest.raises(json.JSONDecodeError):
            BillingService._send_request("DELETE", "/test", json={"key": "value"})

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
