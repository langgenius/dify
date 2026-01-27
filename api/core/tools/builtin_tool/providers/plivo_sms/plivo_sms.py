from typing import Any

import plivo

from core.tools.builtin_tool.provider import BuiltinToolProviderController
from core.tools.errors import ToolProviderCredentialValidationError


class PlivoSmsProvider(BuiltinToolProviderController):
    def _validate_credentials(self, user_id: str, credentials: dict[str, Any]) -> None:
        """
        Validate Plivo credentials by making a test API call.

        :param user_id: the user id
        :param credentials: the credentials containing auth_id and auth_token
        :raises ToolProviderCredentialValidationError: if credentials are invalid
        """
        auth_id = credentials.get("auth_id", "")
        auth_token = credentials.get("auth_token", "")

        if not auth_id or not auth_token:
            raise ToolProviderCredentialValidationError("Plivo Auth ID and Auth Token are required.")

        try:
            # Create Plivo client and validate credentials by fetching account details
            client = plivo.RestClient(auth_id=auth_id, auth_token=auth_token)
            # This API call will fail if credentials are invalid
            client.account.get()
        except plivo.exceptions.AuthenticationError:
            raise ToolProviderCredentialValidationError("Invalid Plivo Auth ID or Auth Token.")
        except Exception as e:
            raise ToolProviderCredentialValidationError(f"Failed to validate Plivo credentials: {str(e)}")
