from typing import Any, Union

import requests

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.errors import ToolInvokeError, ToolProviderCredentialValidationError
from core.tools.tool.builtin_tool import BuiltinTool


class GooglenewsTool(BuiltinTool):
    def _invoke(
        self,
        user_id: str,
        tool_parameters: dict[str, Any],
    ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        """
        invoke tools
        """
        key = self.runtime.credentials.get("x-rapidapi-key", "")
        host = self.runtime.credentials.get("x-rapidapi-host", "")
        if not all([key, host]):
            raise ToolProviderCredentialValidationError("Please input correct x-rapidapi-key and x-rapidapi-host")
        headers = {"x-rapidapi-key": key, "x-rapidapi-host": host}
        lr = tool_parameters.get("language_region", "")
        url = f"https://{host}/latest?lr={lr}"
        response = requests.get(url, headers=headers)
        if response.status_code != 200:
            raise ToolInvokeError(f"Error {response.status_code}: {response.text}")
        return self.create_text_message(response.text)

    def validate_credentials(self, parameters: dict[str, Any]) -> None:
        parameters["validate"] = True
        self._invoke(parameters)
