"""Unit tests for PluginEndpointClient functionality.

This test module covers the endpoint client operations including:
- Successful endpoint deletion
- Idempotent delete behavior (record not found)
- Non-idempotent delete behavior (other errors)

Tests follow the Arrange-Act-Assert pattern for clarity.
"""

from unittest.mock import MagicMock, patch

import pytest

from core.plugin.impl.endpoint import PluginEndpointClient
from core.plugin.impl.exc import PluginDaemonInternalServerError


class TestPluginEndpointClientDelete:
    """Unit tests for PluginEndpointClient delete_endpoint operation.

    Tests cover:
    - Successful endpoint deletion
    - Idempotent behavior when endpoint is already deleted (record not found)
    - Non-idempotent behavior for other errors
    """

    @pytest.fixture
    def endpoint_client(self):
        """Create a PluginEndpointClient instance for testing."""
        return PluginEndpointClient()

    @pytest.fixture
    def mock_config(self):
        """Mock plugin daemon configuration."""
        with (
            patch("core.plugin.impl.base.dify_config.PLUGIN_DAEMON_URL", "http://127.0.0.1:5002"),
            patch("core.plugin.impl.base.dify_config.PLUGIN_DAEMON_KEY", "test-api-key"),
        ):
            yield

    def test_delete_endpoint_success(self, endpoint_client, mock_config):
        """Test successful endpoint deletion.

        Given:
            - A valid tenant_id, user_id, and endpoint_id
            - The plugin daemon returns success response
        When:
            - delete_endpoint is called
        Then:
            - The method should return True
            - The request should be made with correct parameters
        """
        # Arrange
        tenant_id = "tenant-123"
        user_id = "user-456"
        endpoint_id = "endpoint-789"

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "code": 0,
            "message": "success",
            "data": True,
        }

        with patch("httpx.request", return_value=mock_response):
            # Act
            result = endpoint_client.delete_endpoint(
                tenant_id=tenant_id,
                user_id=user_id,
                endpoint_id=endpoint_id,
            )

            # Assert
            assert result is True

    def test_delete_endpoint_idempotent_record_not_found(self, endpoint_client, mock_config):
        """Test idempotent delete behavior when endpoint is already deleted.

        Given:
            - A valid tenant_id, user_id, and endpoint_id
            - The plugin daemon returns "record not found" error
        When:
            - delete_endpoint is called
        Then:
            - The method should return True (idempotent behavior)
            - No exception should be raised
        """
        # Arrange
        tenant_id = "tenant-123"
        user_id = "user-456"
        endpoint_id = "endpoint-789"

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "code": -1,
            "message": (
                '{"error_type": "PluginDaemonInternalServerError", '
                '"message": "failed to remove endpoint: record not found"}'
            ),
        }

        with patch("httpx.request", return_value=mock_response):
            # Act
            result = endpoint_client.delete_endpoint(
                tenant_id=tenant_id,
                user_id=user_id,
                endpoint_id=endpoint_id,
            )

            # Assert - should return True instead of raising an error
            assert result is True

    def test_delete_endpoint_non_idempotent_other_errors(self, endpoint_client, mock_config):
        """Test non-idempotent delete behavior for other errors.

        Given:
            - A valid tenant_id, user_id, and endpoint_id
            - The plugin daemon returns a different error (not "record not found")
        When:
            - delete_endpoint is called
        Then:
            - The method should raise PluginDaemonInternalServerError
        """
        # Arrange
        tenant_id = "tenant-123"
        user_id = "user-456"
        endpoint_id = "endpoint-789"

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "code": -1,
            "message": (
                '{"error_type": "PluginDaemonInternalServerError", '
                '"message": "failed to remove endpoint: internal server error"}'
            ),
        }

        with patch("httpx.request", return_value=mock_response):
            # Act & Assert
            with pytest.raises(PluginDaemonInternalServerError) as exc_info:
                endpoint_client.delete_endpoint(
                    tenant_id=tenant_id,
                    user_id=user_id,
                    endpoint_id=endpoint_id,
                )

            # Assert - the error message should not be "record not found"
            assert "record not found" not in str(exc_info.value.description)

    def test_delete_endpoint_idempotent_case_insensitive(self, endpoint_client, mock_config):
        """Test idempotent delete behavior with case-insensitive error message.

        Given:
            - A valid tenant_id, user_id, and endpoint_id
            - The plugin daemon returns "Record Not Found" error (different case)
        When:
            - delete_endpoint is called
        Then:
            - The method should return True (idempotent behavior)
        """
        # Arrange
        tenant_id = "tenant-123"
        user_id = "user-456"
        endpoint_id = "endpoint-789"

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "code": -1,
            "message": '{"error_type": "PluginDaemonInternalServerError", "message": "Record Not Found"}',
        }

        with patch("httpx.request", return_value=mock_response):
            # Act
            result = endpoint_client.delete_endpoint(
                tenant_id=tenant_id,
                user_id=user_id,
                endpoint_id=endpoint_id,
            )

            # Assert - should still return True
            assert result is True

    def test_delete_endpoint_multiple_calls_idempotent(self, endpoint_client, mock_config):
        """Test that multiple delete calls are idempotent.

        Given:
            - A valid tenant_id, user_id, and endpoint_id
            - The first call succeeds
            - Subsequent calls return "record not found"
        When:
            - delete_endpoint is called multiple times
        Then:
            - All calls should return True
        """
        # Arrange
        tenant_id = "tenant-123"
        user_id = "user-456"
        endpoint_id = "endpoint-789"

        # First call - success
        mock_response_success = MagicMock()
        mock_response_success.status_code = 200
        mock_response_success.json.return_value = {
            "code": 0,
            "message": "success",
            "data": True,
        }

        # Second call - record not found
        mock_response_not_found = MagicMock()
        mock_response_not_found.status_code = 200
        mock_response_not_found.json.return_value = {
            "code": -1,
            "message": (
                '{"error_type": "PluginDaemonInternalServerError", '
                '"message": "failed to remove endpoint: record not found"}'
            ),
        }

        with patch("httpx.request") as mock_request:
            # Act - first call
            mock_request.return_value = mock_response_success
            result1 = endpoint_client.delete_endpoint(
                tenant_id=tenant_id,
                user_id=user_id,
                endpoint_id=endpoint_id,
            )

            # Act - second call (already deleted)
            mock_request.return_value = mock_response_not_found
            result2 = endpoint_client.delete_endpoint(
                tenant_id=tenant_id,
                user_id=user_id,
                endpoint_id=endpoint_id,
            )

            # Assert - both should return True
            assert result1 is True
            assert result2 is True

    def test_delete_endpoint_non_idempotent_unauthorized_error(self, endpoint_client, mock_config):
        """Test that authorization errors are not treated as idempotent.

        Given:
            - A valid tenant_id, user_id, and endpoint_id
            - The plugin daemon returns an unauthorized error
        When:
            - delete_endpoint is called
        Then:
            - The method should raise the appropriate error (not return True)
        """
        # Arrange
        tenant_id = "tenant-123"
        user_id = "user-456"
        endpoint_id = "endpoint-789"

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "code": -1,
            "message": '{"error_type": "PluginDaemonUnauthorizedError", "message": "unauthorized access"}',
        }

        with patch("httpx.request", return_value=mock_response):
            # Act & Assert
            with pytest.raises(Exception) as exc_info:
                endpoint_client.delete_endpoint(
                    tenant_id=tenant_id,
                    user_id=user_id,
                    endpoint_id=endpoint_id,
                )

            # Assert - should not return True for unauthorized errors
            assert exc_info.value.__class__.__name__ == "PluginDaemonUnauthorizedError"
