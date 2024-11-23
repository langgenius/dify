from typing import Any, Union

import requests
from yarl import URL

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool


class SendPrivateMsg(BuiltinTool):
    """OneBot v11 Tool: Send Private Message"""

    def _invoke(
        self, user_id: str, tool_parameters: dict[str, Any]
    ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        # Get parameters
        send_user_id = tool_parameters.get("user_id", "")

        message = tool_parameters.get("message", "")
        if not message:
            return self.create_json_message({"error": "Message is empty."})

        auto_escape = tool_parameters.get("auto_escape", False)

        try:
            url = URL(self.runtime.credentials["ob11_http_url"]) / "send_private_msg"

            resp = requests.post(
                url,
                json={"user_id": send_user_id, "message": message, "auto_escape": auto_escape},
                headers={"Authorization": "Bearer " + self.runtime.credentials["access_token"]},
            )

            if resp.status_code != 200:
                return self.create_json_message({"error": f"Failed to send private message: {resp.text}"})

            return self.create_json_message({"response": resp.json()})
        except Exception as e:
            return self.create_json_message({"error": f"Failed to send private message: {e}"})
