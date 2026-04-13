"""Unit tests for PluginManagerService.

This module covers the pre-uninstall plugin hook behavior:
- Successful API call: no exception raised, correct request sent
- API failure: soft-fail (logs and does not re-raise)
"""

from unittest.mock import patch

import pytest
from httpx import HTTPStatusError

from configs import dify_config
from services.enterprise.plugin_manager_service import (
    CheckCredentialPolicyComplianceRequest,
    CredentialPolicyViolationError,
    PluginCredentialType,
    PluginManagerService,
    PreUninstallPluginRequest,
)

MODULE = "services.enterprise.plugin_manager_service"


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
                timeout=dify_config.ENTERPRISE_REQUEST_TIMEOUT,
            )
            mock_logger.exception.assert_called_once()


class TestCheckCredentialPolicyCompliance:
    def _request(self, cred_type=PluginCredentialType.MODEL):
        return CheckCredentialPolicyComplianceRequest(
            dify_credential_id="cred-1", provider="openai", credential_type=cred_type
        )

    def test_passes_when_result_true(self):
        with patch(f"{MODULE}.EnterprisePluginManagerRequest") as req:
            req.send_request.return_value = {"result": True}
            PluginManagerService.check_credential_policy_compliance(self._request())

        req.send_request.assert_called_once()

    def test_raises_violation_when_result_false(self):
        with patch(f"{MODULE}.EnterprisePluginManagerRequest") as req:
            req.send_request.return_value = {"result": False}
            with pytest.raises(CredentialPolicyViolationError, match="Credentials not available"):
                PluginManagerService.check_credential_policy_compliance(self._request())

    def test_raises_violation_on_invalid_response_format(self):
        with patch(f"{MODULE}.EnterprisePluginManagerRequest") as req:
            req.send_request.return_value = "not-a-dict"
            with pytest.raises(CredentialPolicyViolationError, match="error occurred"):
                PluginManagerService.check_credential_policy_compliance(self._request())

    def test_raises_violation_on_api_exception(self):
        with patch(f"{MODULE}.EnterprisePluginManagerRequest") as req:
            req.send_request.side_effect = ConnectionError("network fail")
            with pytest.raises(CredentialPolicyViolationError, match="error occurred"):
                PluginManagerService.check_credential_policy_compliance(self._request())

    def test_model_dump_serializes_credential_type_as_number(self):
        body = self._request(PluginCredentialType.TOOL)
        data = body.model_dump()

        assert data["credential_type"] == 1
        assert data["dify_credential_id"] == "cred-1"

    def test_model_credential_type_values(self):
        assert PluginCredentialType.MODEL.to_number() == 0
        assert PluginCredentialType.TOOL.to_number() == 1
