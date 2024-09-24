import requests

from core.tools.errors import ToolProviderCredentialValidationError
from core.tools.provider.builtin_tool_provider import BuiltinToolProviderController


class XinferenceProvider(BuiltinToolProviderController):
    def _validate_credentials(self, credentials: dict) -> None:
        base_url = credentials.get("base_url")
        api_key = credentials.get("api_key")
        model = credentials.get("model")
        res = requests.post(
            f"{base_url}/sdapi/v1/options",
            headers={"Authorization": f"Bearer {api_key}"},
            json={"sd_model_checkpoint": model},
        )
        if res.status_code != 200:
            raise ToolProviderCredentialValidationError("Xinference API key is invalid")
