import base64
import hashlib
import hmac
import logging
import time
import urllib.parse
from typing import Any, Optional, Union

import httpx

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool


class DingTalkGroupBotTool(BuiltinTool):
    """
    invoke tools
    Dingtalk custom group robot API docs:
    https://open.dingtalk.com/document/orgapp/custom-robot-access
    """

    MSGTYPE_TEXT = 'text'
    MSGTYPE_MARKDOWN = 'markdown'
    supported_msgtypes = [MSGTYPE_TEXT, MSGTYPE_MARKDOWN]

    def _invoke(self, user_id: str, tool_parameters: dict[str, Any]
                ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:

        content = tool_parameters.get('content')
        if not content:
            return self.create_text_message('Invalid parameter content')

        # title for markdown message
        title = tool_parameters.get('title')

        access_token = tool_parameters.get('access_token')
        if not access_token:
            return self.create_text_message('Invalid parameter access_token. '
                                            'Regarding information about security details,'
                                            'please refer to the DingTalk docs:'
                                            'https://open.dingtalk.com/document/robots/customize-robot-security-settings')

        sign_secret = tool_parameters.get('sign_secret')
        if not sign_secret:
            return self.create_text_message('Invalid parameter sign_secret. '
                                            'Regarding information about security details,'
                                            'please refer to the DingTalk docs:'
                                            'https://open.dingtalk.com/document/robots/customize-robot-security-settings')

        msgtype = 'text'
        api_url = 'https://oapi.dingtalk.com/robot/send'
        headers = {
            'Content-Type': 'application/json',
        }
        params = {
            'access_token': access_token,
        }

        self._apply_security_mechanism(params, sign_secret)

        try:
            payload = self.assemble_payload(msgtype, content, title)

            res = httpx.post(api_url, headers=headers, params=params, json=payload)
            if res.is_success:
                return self.create_text_message("Text message sent successfully")
            else:
                return self.create_text_message(
                    f"Failed to send the text message, status code: {res.status_code}, response: {res.text}")
        except Exception as e:
            return self.create_text_message("Failed to send message to group chat bot. {}".format(e))

    @staticmethod
    def _apply_security_mechanism(params: dict[str, Any], sign_secret: str):
        try:
            timestamp = str(round(time.time() * 1000))
            secret_enc = sign_secret.encode('utf-8')
            string_to_sign = f'{timestamp}\n{sign_secret}'
            string_to_sign_enc = string_to_sign.encode('utf-8')
            hmac_code = hmac.new(secret_enc, string_to_sign_enc, digestmod=hashlib.sha256).digest()
            sign = urllib.parse.quote_plus(base64.b64encode(hmac_code))

            params['timestamp'] = timestamp
            params['sign'] = sign
        except Exception:
            msg = "Failed to apply security mechanism to the request."
            logging.exception(msg)

    def assemble_payload(self, msgtype: str, content: str, title: Optional[str]) -> dict[str, Any]:
        # doc ref:
        # https://open.dingtalk.com/document/orgapp/custom-robot-access#title-72m-8ag-pqw
        match msgtype:
            case self.MSGTYPE_TEXT:
                payload = {
                    'msgtype': msgtype,
                    'text': {
                        'content': content,
                    }
                }
            case self.MSGTYPE_MARKDOWN:
                payload = {
                    'msgtype': msgtype,
                    'markdown': {
                        'title': title or 'New Message',
                        'text': content,
                    }
                }
            case _:
                raise ValueError(f"Unsupported msgtype: {msgtype}")

        return payload
