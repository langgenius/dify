import requests

from core.tools.errors import ToolProviderCredentialValidationError
from core.tools.provider.builtin_tool_provider import BuiltinToolProviderController


class FalProvider(BuiltinToolProviderController):
    def _validate_credentials(self, credentials: dict) -> None:
        url = "https://fal.run/fal-ai/flux/dev"
        headers = {
            "Authorization": f"Key {credentials.get('fal_api_key')}",
            "Content-Type": "application/json",
        }
        data = {"prompt": "Cat"}

        response = requests.post(url, json=data, headers=headers)
        if response.status_code == 401:
            raise ToolProviderCredentialValidationError("FAL API key is invalid")
        elif response.status_code != 200:
            raise ToolProviderCredentialValidationError(f"FAL API key validation failed: {response.text}")
