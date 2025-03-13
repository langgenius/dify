from typing import Any

import requests

from core.tools.errors import ToolProviderCredentialValidationError
from core.tools.provider.builtin.perplexity.tools.perplexity_search import PERPLEXITY_API_URL
from core.tools.provider.builtin_tool_provider import BuiltinToolProviderController


class PerplexityProvider(BuiltinToolProviderController):
    def _validate_credentials(self, credentials: dict[str, Any]) -> None:
        headers = {
            "Authorization": f"Bearer {credentials.get('perplexity_api_key')}",
            "Content-Type": "application/json",
        }

        payload = {
            "model": "llama-3.1-sonar-small-128k-online",
            "messages": [
                {"role": "system", "content": "You are a helpful assistant."},
                {"role": "user", "content": "Hello"},
            ],
            "max_tokens": 5,
            "temperature": 0.1,
            "top_p": 0.9,
            "stream": False,
        }

        try:
            response = requests.post(PERPLEXITY_API_URL, json=payload, headers=headers)
            response.raise_for_status()
        except requests.RequestException as e:
            raise ToolProviderCredentialValidationError(f"Failed to validate Perplexity API key: {str(e)}")

        if response.status_code != 200:
            raise ToolProviderCredentialValidationError(
                f"Perplexity API key is invalid. Status code: {response.status_code}"
            )
