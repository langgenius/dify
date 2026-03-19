import enum
import logging

from pydantic import BaseModel

from configs import dify_config
from services.enterprise.base import EnterprisePluginManagerRequest
from services.errors.base import BaseServiceError

logger = logging.getLogger(__name__)


class PluginCredentialType(enum.Enum):
    MODEL = 0  # must be 0 for API contract compatibility
    TOOL = 1  # must be 1 for API contract compatibility

    def to_number(self):
        return self.value


class CheckCredentialPolicyComplianceRequest(BaseModel):
    dify_credential_id: str
    provider: str
    credential_type: PluginCredentialType

    def model_dump(self, **kwargs):
        data = super().model_dump(**kwargs)
        data["credential_type"] = self.credential_type.to_number()
        return data


class PreUninstallPluginRequest(BaseModel):
    tenant_id: str
    plugin_unique_identifier: str


class CredentialPolicyViolationError(BaseServiceError):
    pass


class PluginManagerService:
    @classmethod
    def check_credential_policy_compliance(cls, body: CheckCredentialPolicyComplianceRequest):
        try:
            ret = EnterprisePluginManagerRequest.send_request(
                "POST", "/check-credential-policy-compliance", json=body.model_dump()
            )
            if not isinstance(ret, dict) or "result" not in ret:
                raise ValueError("Invalid response format from plugin manager API")
        except Exception as e:
            raise CredentialPolicyViolationError(
                f"error occurred while checking credential policy compliance: {e}"
            ) from e

        if not ret.get("result", False):
            raise CredentialPolicyViolationError("Credentials not available: Please use ENTERPRISE global credentials")

        logging.debug(
            "Credential policy compliance checked for %s with credential %s, result: %s",
            body.provider,
            body.dify_credential_id,
            ret.get("result", False),
        )

    @classmethod
    def try_pre_uninstall_plugin(cls, body: PreUninstallPluginRequest):
        try:
            # the invocation must be synchronous.
            EnterprisePluginManagerRequest.send_request(
                "POST",
                "/pre-uninstall-plugin",
                json=body.model_dump(),
                timeout=dify_config.ENTERPRISE_REQUEST_TIMEOUT,
            )
        except Exception:
            logger.exception(
                "failed to perform pre uninstall plugin hook. tenant_id: %s, plugin_unique_identifier: %s",
                body.tenant_id,
                body.plugin_unique_identifier,
            )
