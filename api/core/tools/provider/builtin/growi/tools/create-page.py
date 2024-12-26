from typing import Any, Union

import requests

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool


class CreatePageTool(BuiltinTool):
    def _invoke(
        self,
        user_id: str,
        tool_parameters: dict[str, Any]
    ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        # Validate credentials
        growi_url = self.runtime.credentials.get("growi_url")
        access_token = self.runtime.credentials.get("access_token")

        if growi_url is None or access_token is None:
            return self.create_text_message("Growi URL and Access Token is required.")

        # Prepate request data
        parent_path = tool_parameters.get("parent_path")
        path = tool_parameters.get("path")
        body = tool_parameters.get("body", "")

        data = {
            "access_token": access_token,
            "body": body,
        }

        if not (path or parent_path):
            data['parentPath'] = '/'
        else:
            if path:
                data['path'] = path
            if parent_path:
                data['parentPath'] = parent_path

        # Send request
        try:
            endpoint = f"{growi_url}/_api/v3/page"
            res = requests.post(endpoint, data=data)
            res.raise_for_status()
            return self.create_json_message(res.json())
        except requests.RequestException as e:
            print(f"Failed to create page on GROWI: {e}")
            return self.create_text_message(str(e))