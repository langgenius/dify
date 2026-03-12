"""Unit tests for PluginManagerService.

This module covers the pre-uninstall plugin hook behavior:
- Successful API call: no exception raised, correct request sent
- API failure: soft-fail (logs and does not re-raise)
"""

from unittest.mock import patch

from httpx import HTTPStatusError

from services.enterprise.plugin_manager_service import (
    PluginManagerService,
    PreUninstallPluginRequest,
)

_FAKE_TIMEOUT = 30


_SEND_REQUEST_PATH = (
    "services.enterprise.plugin_manager_service.EnterprisePluginManagerRequest.send_request"
)
_DIFY_CONFIG_PATH = "services.enterprise.plugin_manager_service.dify_config"
_LOGGER_PATH = "services.enterprise.plugin_manager_service.logger"


class TestTryPreUninstallPlugin:
    @patch(_DIFY_CONFIG_PATH)
    @patch(_SEND_REQUEST_PATH)
    def test_try_pre_uninstall_plugin_success(self, mock_send_request, mock_config):
        body = PreUninstallPluginRequest(
            tenant_id="tenant-123",
            plugin_unique_identifier="com.example.my_plugin",
        )
        mock_config.ENTERPRISE_REQUEST_TIMEOUT = _FAKE_TIMEOUT
        mock_send_request.return_value = {}

        PluginManagerService.try_pre_uninstall_plugin(body)

        mock_send_request.assert_called_once_with(
            "POST",
            "/pre-uninstall-plugin",
            json={"tenant_id": "tenant-123", "plugin_unique_identifier": "com.example.my_plugin"},
            timeout=_FAKE_TIMEOUT,
        )

    @patch(_DIFY_CONFIG_PATH)
    @patch(_LOGGER_PATH)
    @patch(_SEND_REQUEST_PATH)
    def test_try_pre_uninstall_plugin_http_error_soft_fails(
        self, mock_send_request, mock_logger, mock_config
    ):
        body = PreUninstallPluginRequest(
            tenant_id="tenant-456",
            plugin_unique_identifier="com.example.other_plugin",
        )
        mock_config.ENTERPRISE_REQUEST_TIMEOUT = _FAKE_TIMEOUT
        mock_send_request.side_effect = HTTPStatusError(
            "502 Bad Gateway",
            request=None,
            response=None,
        )

        PluginManagerService.try_pre_uninstall_plugin(body)

        mock_send_request.assert_called_once_with(
            "POST",
            "/pre-uninstall-plugin",
            json={"tenant_id": "tenant-456", "plugin_unique_identifier": "com.example.other_plugin"},
            timeout=_FAKE_TIMEOUT,
        )
        mock_logger.exception.assert_called_once()

    @patch(_DIFY_CONFIG_PATH)
    @patch(_LOGGER_PATH)
    @patch(_SEND_REQUEST_PATH)
    def test_try_pre_uninstall_plugin_generic_exception_soft_fails(
        self, mock_send_request, mock_logger, mock_config
    ):
        body = PreUninstallPluginRequest(
            tenant_id="tenant-789",
            plugin_unique_identifier="com.example.failing_plugin",
        )
        mock_config.ENTERPRISE_REQUEST_TIMEOUT = _FAKE_TIMEOUT
        mock_send_request.side_effect = ConnectionError("network unreachable")

        PluginManagerService.try_pre_uninstall_plugin(body)

        mock_send_request.assert_called_once_with(
            "POST",
            "/pre-uninstall-plugin",
            json={"tenant_id": "tenant-789", "plugin_unique_identifier": "com.example.failing_plugin"},
            timeout=_FAKE_TIMEOUT,
        )
        mock_logger.exception.assert_called_once()
