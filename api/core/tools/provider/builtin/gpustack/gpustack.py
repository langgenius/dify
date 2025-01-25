import requests

from core.tools.errors import ToolProviderCredentialValidationError
from core.tools.provider.builtin_tool_provider import BuiltinToolProviderController


class GPUStackProvider(BuiltinToolProviderController):
    def _validate_credentials(self, credentials: dict) -> None:
        base_url = credentials.get("base_url", "").removesuffix("/").removesuffix("/v1-openai")
        api_key = credentials.get("api_key", "")
        tls_verify = credentials.get("tls_verify", True)

        if not base_url:
            raise ToolProviderCredentialValidationError("GPUStack base_url is required")
        if not api_key:
            raise ToolProviderCredentialValidationError("GPUStack api_key is required")
        headers = {
            "accept": "application/json",
            "authorization": f"Bearer {api_key}",
        }

        response = requests.get(f"{base_url}/v1-openai/models", headers=headers, verify=tls_verify)
        if response.status_code != 200:
            raise ToolProviderCredentialValidationError(
                f"Failed to validate GPUStack API key, status code: {response.status_code}-{response.text}"
            )
