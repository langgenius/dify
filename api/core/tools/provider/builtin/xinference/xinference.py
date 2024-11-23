import requests

from core.tools.errors import ToolProviderCredentialValidationError
from core.tools.provider.builtin_tool_provider import BuiltinToolProviderController


class XinferenceProvider(BuiltinToolProviderController):
    def _validate_credentials(self, credentials: dict) -> None:
        base_url = credentials.get("base_url", "").removesuffix("/")
        api_key = credentials.get("api_key", "")
        if not api_key:
            api_key = "abc"
            credentials["api_key"] = api_key
        model = credentials.get("model", "")
        if not base_url or not model:
            raise ToolProviderCredentialValidationError("Xinference base_url and model is required")
        headers = {"Authorization": f"Bearer {api_key}"}
        res = requests.post(
            f"{base_url}/sdapi/v1/options",
            headers=headers,
            json={"sd_model_checkpoint": model},
        )
        if res.status_code != 200:
            raise ToolProviderCredentialValidationError("Xinference API key is invalid")
