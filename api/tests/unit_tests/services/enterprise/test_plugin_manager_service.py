from unittest.mock import patch

import pytest

from services.enterprise.plugin_manager_service import (
    CheckCredentialPolicyComplianceRequest,
    CredentialPolicyViolationError,
    PluginCredentialType,
    PluginManagerService,
)

MODULE = "services.enterprise.plugin_manager_service"


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
