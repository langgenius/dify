from typing import Any, Union

import requests

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool
from core.tools.utils.uuid_utils import is_valid_uuid


class WpushSendMessageTool(BuiltinTool):
    def _invoke(self, user_id: str, tool_parameters: dict[str, Any]
                ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        """
            invoke tools
            API document: https://docs.wpush.cn/docs/api/message.html
        """

        api_url = "https://api.wpush.cn/api/v1/send"

        title = tool_parameters.get('title', '')
        if not title:
            return self.create_text_message('Please tell me your title')

        if 'api_key' not in self.runtime.credentials or not self.runtime.credentials.get('api_key'):
            return self.create_text_message("WPush API key is required.")

        headers = {
            "Content-Type": "application/json",
        }
        params = {}
        payload = {
            "apikey": self.runtime.credentials.get('api_key'),
            "title": title,
            "content": tool_parameters.get('content', ''),
            "channel": tool_parameters.get('channel', 'wechat'),
        }
        
        try:
            res = requests.post(api_url, headers=headers, params=params, json=payload)
            data = res.json()
            if data["code"] == 0 :
                return self.create_text_message("Text message sent successfully")
            else:
                return self.create_text_message(
                    f"Failed to send the text message, status code: {res.status_code}, response: {res.text}")
        except Exception as e:
            return self.create_text_message("Failed to send message to wpush. {}".format(e))