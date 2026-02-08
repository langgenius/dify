"""Unit tests for traceparent header propagation in EnterpriseRequest.

This test module verifies that the W3C traceparent header is properly
generated and included in HTTP requests made by EnterpriseRequest.
"""

from unittest.mock import MagicMock, patch

import pytest

from services.enterprise.base import EnterpriseRequest


class TestTraceparentPropagation:
    """Unit tests for traceparent header propagation."""

    @pytest.fixture
    def mock_enterprise_config(self):
        """Mock EnterpriseRequest configuration."""
        with (
            patch.object(EnterpriseRequest, "base_url", "https://enterprise-api.example.com"),
            patch.object(EnterpriseRequest, "secret_key", "test-secret-key"),
            patch.object(EnterpriseRequest, "secret_key_header", "Enterprise-Api-Secret-Key"),
        ):
            yield

    @pytest.fixture
    def mock_httpx_client(self):
        """Mock httpx.Client for testing."""
        with patch("services.enterprise.base.httpx.Client") as mock_client_class:
            mock_client = MagicMock()
            mock_client_class.return_value.__enter__.return_value = mock_client
            mock_client_class.return_value.__exit__.return_value = None

            # Setup default response
            mock_response = MagicMock()
            mock_response.json.return_value = {"result": "success"}
            mock_client.request.return_value = mock_response

            yield mock_client

    def test_traceparent_header_included_when_generated(self, mock_enterprise_config, mock_httpx_client):
        """Test that traceparent header is included when successfully generated."""
        # Arrange
        expected_traceparent = "00-5b8aa5a2d2c872e8321cf37308d69df2-051581bf3bb55c45-01"

        with patch("services.enterprise.base.generate_traceparent_header", return_value=expected_traceparent):
            # Act
            EnterpriseRequest.send_request("GET", "/test")

            # Assert
            mock_httpx_client.request.assert_called_once()
            call_args = mock_httpx_client.request.call_args
            headers = call_args[1]["headers"]

            assert "traceparent" in headers
            assert headers["traceparent"] == expected_traceparent
            assert headers["Content-Type"] == "application/json"
            assert headers["Enterprise-Api-Secret-Key"] == "test-secret-key"
