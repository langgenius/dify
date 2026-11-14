from typing import Any, override

from pydantic import BaseModel, Field
from sqlalchemy import select

from core.db.session_factory import session_factory
from core.extension.api_based_extension_requestor import APIBasedExtensionPoint, APIBasedExtensionRequestor
from core.helper.encrypter import decrypt_token
from core.moderation.base import Moderation, ModerationAction, ModerationInputsResult, ModerationOutputsResult
from models.api_based_extension import APIBasedExtension


class ModerationInputParams(BaseModel):
    app_id: str = ""
    inputs: dict[str, Any] = Field(default_factory=dict)
    query: str = ""


class ModerationOutputParams(BaseModel):
    app_id: str = ""
    text: str


class ApiModeration(Moderation):
    name: str = "api"

    @classmethod
    @override
    def validate_config(cls, tenant_id: str, config: dict[str, Any]) -> None:
        """Validate form settings and require an extension owned by the workspace.

        Return without external I/O when the settings and tenant-owned extension exist.
        Invalid settings or a missing extension raise ValueError; lookup errors propagate.
        """
        cls._validate_inputs_and_outputs_config(config, False)

        api_based_extension_id = config.get("api_based_extension_id")
        if not api_based_extension_id:
            raise ValueError("api_based_extension_id is required")

        if cls._get_api_based_extension(tenant_id, api_based_extension_id) is None:
            raise ValueError("API-based Extension not found. Please check it again.")

    @override
    def moderation_for_inputs(self, inputs: dict[str, Any], query: str = "") -> ModerationInputsResult:
        flagged = False
        preset_response = ""
        if self.config is None:
            raise ValueError("The config is not set.")

        if self.config["inputs_config"]["enabled"]:
            params = ModerationInputParams(app_id=self.app_id, inputs=inputs, query=query)

            result = self._get_config_by_requestor(APIBasedExtensionPoint.APP_MODERATION_INPUT, params.model_dump())
            return ModerationInputsResult.model_validate(result)

        return ModerationInputsResult(
            flagged=flagged, action=ModerationAction.DIRECT_OUTPUT, preset_response=preset_response
        )

    @override
    def moderation_for_outputs(self, text: str) -> ModerationOutputsResult:
        flagged = False
        preset_response = ""
        if self.config is None:
            raise ValueError("The config is not set.")

        if self.config["outputs_config"]["enabled"]:
            params = ModerationOutputParams(app_id=self.app_id, text=text)

            result = self._get_config_by_requestor(APIBasedExtensionPoint.APP_MODERATION_OUTPUT, params.model_dump())
            return ModerationOutputsResult.model_validate(result)

        return ModerationOutputsResult(
            flagged=flagged, action=ModerationAction.DIRECT_OUTPUT, preset_response=preset_response
        )

    def _get_config_by_requestor(
        self, extension_point: APIBasedExtensionPoint, params: dict[str, Any]
    ) -> dict[str, object]:
        """Request moderation from the configured extension after releasing the lookup session.

        Return the extension response for the supplied point and parameters.
        Missing config or a missing tenant-owned extension raises ValueError; lookup,
        decryption, and request failures propagate unchanged.
        """
        if self.config is None:
            raise ValueError("The config is not set.")
        extension = self._get_api_based_extension(self.tenant_id, self.config.get("api_based_extension_id", ""))
        if extension is None:
            raise ValueError("API-based Extension not found. Please check it again.")
        endpoint, encrypted_key = extension
        requestor = APIBasedExtensionRequestor(endpoint, decrypt_token(self.tenant_id, encrypted_key))

        result = requestor.request(extension_point, params)
        return result

    @staticmethod
    def _get_api_based_extension(tenant_id: str, api_based_extension_id: str) -> tuple[str, str] | None:
        """Read the tenant's endpoint and encrypted key using the configured session factory.

        Return None if the extension is absent. Close the owned session before returning
        or propagating a lookup error.
        """
        stmt = select(APIBasedExtension.api_endpoint, APIBasedExtension.api_key).where(
            APIBasedExtension.tenant_id == tenant_id, APIBasedExtension.id == api_based_extension_id
        )
        with session_factory.create_session() as session:
            row = session.execute(stmt).tuples().one_or_none()
            if row is None:
                return None
            endpoint, encrypted_key = row
            return endpoint, encrypted_key
