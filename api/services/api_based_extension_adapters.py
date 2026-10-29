"""Runtime adapters for the API-based extension application service."""

from typing import override

from core.extension.api_based_extension_requestor import APIBasedExtensionRequestor
from core.helper.encrypter import decrypt_token, encrypt_token
from models.api_based_extension import APIBasedExtensionPoint
from services.api_based_extension_application_service import (
    APIBasedExtensionConnectionError,
    APIBasedExtensionEndpointProbe,
    APIBasedExtensionSecretCipher,
)


class WorkspaceTokenCipher(APIBasedExtensionSecretCipher):
    """Encrypts API keys with the workspace key provider used by the rest of the platform."""

    @override
    def encrypt(self, workspace_id: str, value: str) -> str:
        return encrypt_token(workspace_id, value)

    @override
    def decrypt(self, workspace_id: str, value: str) -> str:
        return decrypt_token(workspace_id, value)


class APIBasedExtensionPingProbe(APIBasedExtensionEndpointProbe):
    """Sends the ``ping`` extension point through the SSRF-guarded extension requestor."""

    @override
    def ping(self, api_endpoint: str, api_key: str) -> None:
        try:
            response = APIBasedExtensionRequestor(api_endpoint, api_key).request(
                point=APIBasedExtensionPoint.PING, params={}
            )
        except Exception as error:
            raise APIBasedExtensionConnectionError(str(error)) from error
        # The requestor only promises JSON; an endpoint may answer with a list or null instead of an object.
        if not isinstance(response, dict) or response.get("result") != "pong":
            raise APIBasedExtensionConnectionError(str(response))
