"""
Unit tests for Service API Index endpoint
"""

from unittest.mock import patch

import pytest
from flask import Flask

from controllers.service_api import index as index_module
from controllers.service_api.index import IndexApi


def _get_index_response(app: Flask, version: str) -> dict[str, str]:
    with patch.object(index_module.dify_config.project, "version", version):
        with app.test_request_context("/", method="GET"):
            index_api = IndexApi()
            return index_api.get()


class TestIndexApi:
    """Test suite for IndexApi resource."""

    def test_get_returns_api_info(self, app: Flask):
        """Test that GET returns API metadata with correct structure."""
        # Act
        response = _get_index_response(app, "1.0.0-test")

        # Assert
        assert response["welcome"] == "Dify OpenAPI"
        assert response["api_version"] == "v1"
        assert response["server_version"] == "1.0.0-test"

    def test_get_response_has_required_fields(self, app: Flask):
        """Test that response contains all required fields."""
        # Act
        response = _get_index_response(app, "1.11.4")

        # Assert
        assert "welcome" in response
        assert "api_version" in response
        assert "server_version" in response
        assert isinstance(response["welcome"], str)
        assert isinstance(response["api_version"], str)
        assert isinstance(response["server_version"], str)

    @pytest.mark.parametrize("version", ["0.0.1", "1.0.0", "2.0.0-beta", "1.11.4"])
    def test_get_returns_correct_version(self, app: Flask, version):
        """Test that server_version matches config version."""
        # Act
        response = _get_index_response(app, version)

        # Assert
        assert response["server_version"] == version
