from typing import Any

import requests

from core.tools.errors import ToolProviderCredentialValidationError
from core.tools.provider.builtin_tool_provider import BuiltinToolProviderController


class GitlabProvider(BuiltinToolProviderController):
    def _validate_credentials(self, credentials: dict[str, Any]) -> None:
        try:
            if "access_tokens" not in credentials or not credentials.get("access_tokens"):
                raise ToolProviderCredentialValidationError("Gitlab Access Tokens is required.")

            if "site_url" not in credentials or not credentials.get("site_url"):
                site_url = "https://gitlab.com"
            else:
                site_url = credentials.get("site_url")

            try:
                headers = {
                    "Content-Type": "application/vnd.text+json",
                    "Authorization": f"Bearer {credentials.get('access_tokens')}",
                }

                response = requests.get(url=f"{site_url}/api/v4/user", headers=headers)
                if response.status_code != 200:
                    raise ToolProviderCredentialValidationError((response.json()).get("message"))
            except Exception as e:
                raise ToolProviderCredentialValidationError("Gitlab Access Tokens is invalid. {}".format(e))
        except Exception as e:
            raise ToolProviderCredentialValidationError(str(e))
