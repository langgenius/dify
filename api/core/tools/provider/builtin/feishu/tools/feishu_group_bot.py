from typing import Any, Union

import httpx

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool
from core.tools.utils.uuid_utils import is_valid_uuid


class FeishuGroupBotTool(BuiltinTool):
    def _invoke(
        self, user_id: str, tool_parameters: dict[str, Any]
    ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        """
        invoke tools
        API document: https://open.feishu.cn/document/client-docs/bot-v3/add-custom-bot
        """

        url = "https://open.feishu.cn/open-apis/bot/v2/hook"

        content = tool_parameters.get("content", "")
        if not content:
            return self.create_text_message("Invalid parameter content")

        hook_key = tool_parameters.get("hook_key", "")
        if not is_valid_uuid(hook_key):
            return self.create_text_message(f"Invalid parameter hook_key ${hook_key}, not a valid UUID")

        msg_type = "text"
        api_url = f"{url}/{hook_key}"
        headers = {
            "Content-Type": "application/json",
        }
        params = {}
        payload = {
            "msg_type": msg_type,
            "content": {
                "text": content,
            },
        }

        try:
            res = httpx.post(api_url, headers=headers, params=params, json=payload)
            if res.is_success:
                return self.create_text_message("Text message sent successfully")
            else:
                return self.create_text_message(
                    f"Failed to send the text message, status code: {res.status_code}, response: {res.text}"
                )
        except Exception as e:
            return self.create_text_message("Failed to send message to group chat bot. {}".format(e))
