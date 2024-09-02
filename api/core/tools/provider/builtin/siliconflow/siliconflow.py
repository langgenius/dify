import requests

from core.tools.errors import ToolProviderCredentialValidationError
from core.tools.provider.builtin_tool_provider import BuiltinToolProviderController


class SiliconflowProvider(BuiltinToolProviderController):
    def _validate_credentials(self, credentials: dict) -> None:
        url = "https://api.siliconflow.cn/v1/models"
        headers = {
            "accept": "application/json",
            "authorization": f"Bearer {credentials.get('siliconFlow_api_key')}",
        }

        response = requests.get(url, headers=headers)
        if response.status_code != 200:
            raise ToolProviderCredentialValidationError(
                "SiliconFlow API key is invalid"
            )
