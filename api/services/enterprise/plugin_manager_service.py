import enum
import logging

from pydantic import BaseModel

from services.enterprise.base import EnterprisePluginManagerRequest
from services.errors.base import BaseServiceError


class PluginCredentialType(enum.Enum):
    MODEL = 0
    TOOL = 1

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
            f"Credential policy compliance checked for {body.provider} with credential {body.dify_credential_id}, result: {ret.get('result', False)}"
        )
