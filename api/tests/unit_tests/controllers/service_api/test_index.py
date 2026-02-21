"""
Unit tests for Service API Index endpoint
"""

from unittest.mock import MagicMock, patch

import pytest

from controllers.service_api.index import IndexApi


class TestIndexApi:
    """Test suite for IndexApi resource."""

    @patch("controllers.service_api.index.dify_config")
    def test_get_returns_api_info(self, mock_config, app):
        """Test that GET returns API metadata with correct structure."""
        # Arrange
        mock_config.project.version = "1.0.0-test"

        # Act
        with app.test_request_context("/", method="GET"):
            index_api = IndexApi()
            response = index_api.get()
        with patch("controllers.service_api.index.dify_config", mock_config):
            with app.test_request_context("/", method="GET"):
                index_api = IndexApi()
                response = index_api.get()

        # Assert
        assert response["welcome"] == "Dify OpenAPI"
        assert response["api_version"] == "v1"
        assert response["server_version"] == "1.0.0-test"

    def test_get_response_has_required_fields(self, app):
        """Test that response contains all required fields."""
        # Arrange
        mock_config = MagicMock()
        mock_config.project.version = "1.11.4"

        # Act
        with patch("controllers.service_api.index.dify_config", mock_config):
            with app.test_request_context("/", method="GET"):
                index_api = IndexApi()
                response = index_api.get()

        # Assert
        assert "welcome" in response
        assert "api_version" in response
        assert "server_version" in response
        assert isinstance(response["welcome"], str)
        assert isinstance(response["api_version"], str)
        assert isinstance(response["server_version"], str)

    @pytest.mark.parametrize("version", ["0.0.1", "1.0.0", "2.0.0-beta", "1.11.4"])
    def test_get_returns_correct_version(self, app, version):
        """Test that server_version matches config version."""
        # Arrange
        mock_config = MagicMock()
        mock_config.project.version = version

        # Act
        with patch("controllers.service_api.index.dify_config", mock_config):
            with app.test_request_context("/", method="GET"):
                index_api = IndexApi()
                response = index_api.get()

        # Assert
        assert response["server_version"] == version
