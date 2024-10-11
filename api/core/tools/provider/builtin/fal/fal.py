import requests

from core.tools.errors import ToolProviderCredentialValidationError
from core.tools.provider.builtin_tool_provider import BuiltinToolProviderController


class FalProvider(BuiltinToolProviderController):
    def _validate_credentials(self, credentials: dict) -> None:
        url = "https://queue.fal.run/fal-ai/flux/schnell"
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Key {credentials.get('fal_api_key')}",
        }
        data = {"prompt": "cute girl, blue eyes, white hair, anime style."}
        response = requests.post(url, headers=headers, data=data)
        if response.status_code != 200:
            raise ToolProviderCredentialValidationError("Fal API key is invalid")
