from core.tools.provider.builtin_tool_provider import BuiltinToolProviderController
from core.tools.errors import ToolProviderCredentialValidationError

from typing import Any

import requests

class GiteeProvider(BuiltinToolProviderController):
    def _validate_credentials(self, credentials: dict[str, Any]) -> None:
        try:
            if "access_tokens" not in credentials or not credentials.get("access_tokens"):
                raise ToolProviderCredentialValidationError("Gitee personal access token is required.")
            
            if "host_url" not in credentials or not credentials.get("host_url"):
                host_url = "https://gitee.com"
            else:
                host_url = credentials.get("host_url")

            try:
                headers = {
                    "Content-Type": "application/json;charset=utf-8",
                    "Authorization": f"Bearer {credentials.get('access_tokens')}",
                }

                response = requests.get(url=f"{host_url}/api/v5/user", headers=headers)
                if response.status_code != 200:
                    raise ToolProviderCredentialValidationError((response.json()).get("message"))
            except Exception as ex:
                raise ToolProviderCredentialValidationError("Gitee personal access token is invalid. {}".format(ex))
        except Exception as ex:
            raise ToolProviderCredentialValidationError(str(ex))