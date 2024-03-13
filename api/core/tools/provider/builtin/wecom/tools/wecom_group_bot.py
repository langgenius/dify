from typing import Any, Union

import httpx

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool
from core.tools.utils.uuid_utils import is_valid_uuid


class WecomGroupBotTool(BuiltinTool):
    """
        Wecom group bot API docs:
        https://developer.work.weixin.qq.com/document/path/91770
    """

    MSGTYPE_TEXT = 'text'
    MSGTYPE_MARKDOWN = 'markdown'
    supported_msgtypes = [MSGTYPE_TEXT, MSGTYPE_MARKDOWN]

    def _invoke(self, user_id: str, tool_parameters: dict[str, Any]
                ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:

        msgtype = tool_parameters.get('msgtype', self.MSGTYPE_TEXT)
        if msgtype not in supported_msgtypes:
            return self.create_text_message(
                f'Invalid parameter msg_type ${msgtype}, not in supported msg types {self.supported_msgtypes}')

        content = tool_parameters.get('content', '')
        if not content:
            return self.create_text_message('Invalid parameter content')

        hook_key = tool_parameters.get('hook_key', '')
        if not is_valid_uuid(hook_key):
            return self.create_text_message(
                f'Invalid parameter hook_key ${hook_key}, not a valid UUID')

        api_url = 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send'
        headers = {
            'Content-Type': 'application/json',
        }
        params = {
            'key': hook_key,
        }

        try:
            payload = self.assemble_payload(msgtype, content)

            res = httpx.post(api_url, headers=headers, params=params, json=payload)
            if res.is_success:
                return self.create_text_message("Text message sent successfully")
            else:
                return self.create_text_message(
                    f"Failed to send the text message, status code: {res.status_code}, response: {res.text}")
        except Exception as e:
            return self.create_text_message("Failed to send message to group chat bot. {}".format(e))

    def assemble_payload(self, msgtype: str, content: str) -> dict[str, Any]:
        match msgtype:
            case self.MSGTYPE_TEXT:
                # doc ref:
                # https://developer.work.weixin.qq.com/document/path/91770#%E6%96%87%E6%9C%AC%E7%B1%BB%E5%9E%8B
                payload = {
                    'msgtype': msgtype,
                    'text': {
                        'content': content,
                    }
                }
            case self.MSGTYPE_MARKDOWN:
                # doc ref:
                # https://developer.work.weixin.qq.com/document/path/91770#markdown%E7%B1%BB%E5%9E%8B
                payload = {
                    'msgtype': msgtype,
                    'markdown': {
                        'content': content,
                    }
                }
            case _:
                raise ValueError(f"Unsupported msgtype: {msgtype}")

        return payload
