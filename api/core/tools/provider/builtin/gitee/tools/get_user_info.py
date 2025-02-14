import requests
from typing import Any, Union
from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool


class GiteeUserInfoTool(BuiltinTool):
    def _invoke(
        self, user_id: str, tool_parameters: dict[str, Any]
    ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        access_token = self.runtime.credentials.get("access_tokens")
        host_url = self.runtime.credentials.get("host_url")
        if not access_token:
            return self.create_text_message("Gitee API Access Token is required.")

        user_info = self.fetch_user_info(host_url, access_token)

        if user_info:
            return self.create_json_message(user_info)
        else:
            return self.create_text_message("Failed to fetch user information.")

    def fetch_user_info(self, host_url: str, access_token: str) -> dict[str, Any]:
        headers = {"Authorization": f"token {access_token}"}
        user_info_url = f"{host_url}/api/v5/user"

        try:
            response = requests.get(user_info_url, headers=headers)
            response.raise_for_status()
            return response.json()
        except requests.RequestException as e:
            print(f"Error fetching data from Gitee: {e}")
            return {}
