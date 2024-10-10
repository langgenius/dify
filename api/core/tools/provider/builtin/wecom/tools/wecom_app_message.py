import json
from typing import Any, Union

import httpx

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool


class WecomAppMessageTool(BuiltinTool):
    def _invoke(self, user_id: str, tool_parameters: dict[str, Any]
                ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        """
            invoke tools
        """
        corp_id = tool_parameters.get('corp_id', '')
        if not corp_id:
            return self.create_text_message('Invalid parameter corp_id')

        corp_secret = tool_parameters.get('corp_secret', '')
        if not corp_secret:
            return self.create_text_message('Invalid parameter corp_secret')

        message_body = tool_parameters.get('message_body', '')
        if not message_body:
            return self.create_text_message('Invalid parameter message_body')
        try:
            payload = json.loads(message_body)
        except Exception as e:
            return self.create_text_message(f'Invalid parameter message_body, {e}')

        # get access token
        get_token_url = 'https://qyapi.weixin.qq.com/cgi-bin/gettoken'
        get_token_params = {
            'corpid': corp_id,
            'corpsecret': corp_secret,
        }

        try:
            res = httpx.get(get_token_url, params=get_token_params)
            res_json = res.json()
            if res.is_success:
                if res_json['errcode'] != 0:
                    return self.create_text_message(f"Failed to get access token, response errmsg: {res_json['errmsg']}")
                access_token = res_json['access_token']
            else:
                return self.create_text_message(
                    f"Failed to get access token, status code: {res.status_code}, response: {res.text}")
        except Exception as e:
            return self.create_text_message("Failed to get access token. {}".format(e))

        # send message
        msg_url = 'https://qyapi.weixin.qq.com/cgi-bin/message/send'
        msg_params = {
            'access_token': access_token,
        }
        headers = {
            'Content-Type': 'application/json',
        }
        try:
            res = httpx.post(msg_url, headers=headers, params=msg_params, json=payload)
            if res.is_success:
                res_json = res.json()
                if res_json["errcode"]:
                    return self.create_text_message(f"Failed to send the message, response: {res_json}")
                return self.create_text_message("message sent successfully")
            else:
                return self.create_text_message(
                    f"Failed to send the message, status code: {res.status_code}, response: {res.text}")
        except Exception as e:
            return self.create_text_message("Failed to send message to app. {}".format(e))
