from typing import Any

import requests
from requests.auth import HTTPBasicAuth

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.errors import ToolProviderCredentialValidationError
from core.tools.tool.builtin_tool import BuiltinTool


class FetchPromptTool(BuiltinTool):
    def _invoke(self, user_id: str, tool_parameters: dict[str, Any]) -> ToolInvokeMessage:
        params = {}

        hostUrl = tool_parameters.get("hostUrl")
        publicKey = tool_parameters.get("publicKey")
        secretKey = tool_parameters.get("secretKey")
        page = tool_parameters.get("page")
        limit = tool_parameters.get("limit")

        if all([hostUrl, publicKey, secretKey]):
            print("ok")
        else:
            print("One or more parameters are missing or empty.")
            raise ToolProviderCredentialValidationError("One or more parameters are missing or empty.")

        if page is not None:
            params["page"] = page
        if limit is not None:
            params["limit"] = limit
        requestUrl = hostUrl + "/api/public/v2/datasets"

        response = requests.get(requestUrl, params=params, auth=HTTPBasicAuth(publicKey, secretKey))

        if response.status_code == 200:
            print(response.text)
            return self.create_json_message(response.json())
        else:
            return self.create_text_message(f"API request failed with status code {response.status_code}")
