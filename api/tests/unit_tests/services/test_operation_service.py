from unittest.mock import MagicMock, patch

import httpx
import pytest

from services.operation_service import OperationService


class TestOperationService:
    """Test suite for OperationService"""

    # ===== Internal Method Tests =====

    @patch("httpx.request")
    def test_should_call_with_correct_parameters_when__send_request_invoked(
        self, mock_request: MagicMock, monkeypatch: pytest.MonkeyPatch
    ):
        """Test that _send_request calls httpx.request with the correct URL, headers, and data"""
        # Arrange
        monkeypatch.setattr(OperationService, "base_url", "https://billing.example")
        monkeypatch.setattr(OperationService, "secret_key", "s3cr3t")

        mock_response = MagicMock()
        mock_response.json.return_value = {"status": "success"}
        mock_request.return_value = mock_response

        method = "POST"
        endpoint = "/test_endpoint"
        json_data = {"key": "value"}

        # Act
        result = OperationService._send_request(method, endpoint, json=json_data)

        # Assert
        assert result == {"status": "success"}

        # Verify call parameters
        expected_url = "https://billing.example/test_endpoint"
        mock_request.assert_called_once()
        args, kwargs = mock_request.call_args
        assert args[0] == method
        assert args[1] == expected_url
        assert kwargs["json"] == json_data
        assert kwargs["headers"]["Billing-Api-Secret-Key"] == "s3cr3t"
        assert kwargs["headers"]["Content-Type"] == "application/json"

    @patch("httpx.request")
    def test_should_propagate_httpx_error_when__send_request_raises(
        self, mock_request: MagicMock, monkeypatch: pytest.MonkeyPatch
    ):
        """Test that _send_request handles httpx raising an error"""
        # Arrange
        monkeypatch.setattr(OperationService, "base_url", "https://billing.example")
        mock_request.side_effect = httpx.RequestError("network error")

        # Act & Assert
        with pytest.raises(httpx.RequestError):
            OperationService._send_request("POST", "/test")

    # ===== Public Method Tests =====

    @pytest.mark.parametrize(
        ("utm_info", "expected_params"),
        [
            (
                {
                    "utm_source": "google",
                    "utm_medium": "cpc",
                    "utm_campaign": "spring_sale",
                    "utm_content": "ad_1",
                    "utm_term": "ai_agent",
                },
                {
                    "tenant_id": "tenant-123",
                    "utm_source": "google",
                    "utm_medium": "cpc",
                    "utm_campaign": "spring_sale",
                    "utm_content": "ad_1",
                    "utm_term": "ai_agent",
                },
            ),
            (
                {},  # Empty utm_info
                {
                    "tenant_id": "tenant-123",
                    "utm_source": "",
                    "utm_medium": "",
                    "utm_campaign": "",
                    "utm_content": "",
                    "utm_term": "",
                },
            ),
            (
                {"utm_source": "newsletter"},  # Partial utm_info
                {
                    "tenant_id": "tenant-123",
                    "utm_source": "newsletter",
                    "utm_medium": "",
                    "utm_campaign": "",
                    "utm_content": "",
                    "utm_term": "",
                },
            ),
        ],
    )
    @patch.object(OperationService, "_send_request")
    def test_should_map_parameters_correctly_when_record_utm_called(
        self, mock_send: MagicMock, utm_info: dict, expected_params: dict
    ):
        """Test that record_utm correctly maps utm_info to parameters and calls _send_request"""
        # Arrange
        tenant_id = "tenant-123"
        mock_send.return_value = {"status": "recorded"}

        # Act
        result = OperationService.record_utm(tenant_id, utm_info)

        # Assert
        assert result == {"status": "recorded"}
        mock_send.assert_called_once_with("POST", "/tenant_utms", params=expected_params)
