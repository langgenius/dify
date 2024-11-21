from typing import Any

import requests
from yarl import URL

from core.tools.errors import ToolProviderCredentialValidationError
from core.tools.provider.builtin_tool_provider import BuiltinToolProviderController


class SlideSpeakProvider(BuiltinToolProviderController):
    def _validate_credentials(self, credentials: dict[str, Any]) -> None:
        api_key = credentials.get("slidespeak_api_key")
        base_url = credentials.get("base_url")

        if not api_key:
            raise ToolProviderCredentialValidationError("API key is missing")

        if base_url:
            base_url = str(URL(base_url) / "v1")

        headers = {"Content-Type": "application/json", "X-API-Key": api_key}

        test_task_id = "xxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
        url = f"{base_url or 'https://api.slidespeak.co/api/v1'}/task_status/{test_task_id}"

        response = requests.get(url, headers=headers)
        if response.status_code != 200:
            raise ToolProviderCredentialValidationError("Invalid SlidePeak API key")
