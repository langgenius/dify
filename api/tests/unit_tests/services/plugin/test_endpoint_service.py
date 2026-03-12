"""Tests for services.plugin.endpoint_service.EndpointService.

Smoke tests to confirm delegation to PluginEndpointClient.
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

from services.plugin.endpoint_service import EndpointService


class TestEndpointServiceDelegation:
    @patch("services.plugin.endpoint_service.PluginEndpointClient")
    def test_create_delegates_correctly(self, mock_client_cls):
        expected = MagicMock()
        mock_client_cls.return_value.create_endpoint.return_value = expected

        result = EndpointService.create_endpoint("t1", "u1", "uid-1", "my-endpoint", {"key": "val"})

        assert result is expected
        mock_client_cls.return_value.create_endpoint.assert_called_once_with(
            tenant_id="t1", user_id="u1", plugin_unique_identifier="uid-1", name="my-endpoint", settings={"key": "val"}
        )

    @patch("services.plugin.endpoint_service.PluginEndpointClient")
    def test_list_delegates_correctly(self, mock_client_cls):
        expected = MagicMock()
        mock_client_cls.return_value.list_endpoints.return_value = expected

        result = EndpointService.list_endpoints("t1", "u1", 1, 10)

        assert result is expected

    @patch("services.plugin.endpoint_service.PluginEndpointClient")
    def test_enable_disable_delegates(self, mock_client_cls):
        EndpointService.enable_endpoint("t1", "u1", "ep-1")
        mock_client_cls.return_value.enable_endpoint.assert_called_once()

        EndpointService.disable_endpoint("t1", "u1", "ep-2")
        mock_client_cls.return_value.disable_endpoint.assert_called_once()
