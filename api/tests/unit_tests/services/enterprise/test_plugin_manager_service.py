"""Unit tests for PluginManagerService.

This module covers the pre-uninstall plugin hook behavior:
- Successful API call: no exception raised, correct request sent
- API failure: soft-fail (logs and does not re-raise)
"""

from unittest.mock import patch

from httpx import HTTPStatusError

from configs import dify_config
from services.enterprise.plugin_manager_service import (
    PluginManagerService,
    PreUninstallPluginRequest,
)


class TestTryPreUninstallPlugin:
    def test_try_pre_uninstall_plugin_success(self):
        body = PreUninstallPluginRequest(
            tenant_id="tenant-123",
            plugin_unique_identifier="com.example.my_plugin",
        )

        with patch(
            "services.enterprise.plugin_manager_service.EnterprisePluginManagerRequest.send_request"
        ) as mock_send_request:
            mock_send_request.return_value = {}

            PluginManagerService.try_pre_uninstall_plugin(body)

            mock_send_request.assert_called_once_with(
                "POST",
                "/pre-uninstall-plugin",
                json={"tenant_id": "tenant-123", "plugin_unique_identifier": "com.example.my_plugin"},
                raise_for_status=True,
                timeout=dify_config.ENTERPRISE_REQUEST_TIMEOUT,
            )

    def test_try_pre_uninstall_plugin_http_error_soft_fails(self):
        body = PreUninstallPluginRequest(
            tenant_id="tenant-456",
            plugin_unique_identifier="com.example.other_plugin",
        )

        with (
            patch(
                "services.enterprise.plugin_manager_service.EnterprisePluginManagerRequest.send_request"
            ) as mock_send_request,
            patch("services.enterprise.plugin_manager_service.logger") as mock_logger,
        ):
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
                raise_for_status=True,
                timeout=dify_config.ENTERPRISE_REQUEST_TIMEOUT,
            )
            mock_logger.exception.assert_called_once()

    def test_try_pre_uninstall_plugin_generic_exception_soft_fails(self):
        body = PreUninstallPluginRequest(
            tenant_id="tenant-789",
            plugin_unique_identifier="com.example.failing_plugin",
        )

        with (
            patch(
                "services.enterprise.plugin_manager_service.EnterprisePluginManagerRequest.send_request"
            ) as mock_send_request,
            patch("services.enterprise.plugin_manager_service.logger") as mock_logger,
        ):
            mock_send_request.side_effect = ConnectionError("network unreachable")

            PluginManagerService.try_pre_uninstall_plugin(body)

            mock_send_request.assert_called_once_with(
                "POST",
                "/pre-uninstall-plugin",
                json={"tenant_id": "tenant-789", "plugin_unique_identifier": "com.example.failing_plugin"},
                raise_for_status=True,
                timeout=dify_config.ENTERPRISE_REQUEST_TIMEOUT,
            )
            mock_logger.exception.assert_called_once()
