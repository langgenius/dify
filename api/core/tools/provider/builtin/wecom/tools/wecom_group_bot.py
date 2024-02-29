from typing import Any, Union

import httpx

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool


class WecomRepositoriesTool(BuiltinTool):
    def _invoke(self, user_id: str, tool_parameters: dict[str, Any]
                ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        """
            invoke tools
        """
        text = tool_parameters.get('city', '')
        if not text:
            return self.create_text_message('Invalid parameter text')

        try:
            webhook_api_url = 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send'
            bot_key = ''
            headers = {'Content-Type': 'application/json'}
            url = "{url}?key={bot_key}".format(url=webhook_api_url, bot_key=bot_key)
            payload = {
                "msgtype": "text",
                "text": {
                    "content": "hello world"
                }
            }
            response = httpx.post(url, headers=headers, json=payload)
            if response.is_success:
                return self.create_text_message("Text message sent successfully")
            else:
                return self.create_text_message(
                    "Failed to send the text message, status code: {code}, response: {text}"
                    .format(code=response.status_code, text=response.text))
        except Exception as e:
            return self.create_text_message("Github API Key and Api Version is invalid. {}".format(e))
