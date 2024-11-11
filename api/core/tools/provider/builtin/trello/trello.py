from typing import Any

import requests

from core.tools.errors import ToolProviderCredentialValidationError
from core.tools.provider.builtin_tool_provider import BuiltinToolProviderController


class TrelloProvider(BuiltinToolProviderController):
    def _validate_credentials(self, credentials: dict[str, Any]) -> None:
        """Validate Trello API credentials by making a test API call.

        Args:
            credentials (dict[str, Any]): The Trello API credentials to validate.

        Raises:
            ToolProviderCredentialValidationError: If the credentials are invalid.
        """
        api_key = credentials.get("trello_api_key")
        token = credentials.get("trello_api_token")
        url = f"https://api.trello.com/1/members/me?key={api_key}&token={token}"

        try:
            response = requests.get(url)
            response.raise_for_status()  # Raises an HTTPError for bad responses
        except requests.exceptions.HTTPError as e:
            if response.status_code == 401:
                # Unauthorized, indicating invalid credentials
                raise ToolProviderCredentialValidationError("Invalid Trello credentials: Unauthorized.")
            # Handle other potential HTTP errors
            raise ToolProviderCredentialValidationError("Error validating Trello credentials")
        except requests.exceptions.RequestException as e:
            # Handle other exceptions, such as connection errors
            raise ToolProviderCredentialValidationError("Error validating Trello credentials")
