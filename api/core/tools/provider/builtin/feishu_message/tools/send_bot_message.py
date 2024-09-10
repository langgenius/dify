from typing import Any

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool
from core.tools.utils.feishu_api_utils import FeishuRequest


class SendBotMessageTool(BuiltinTool):
    def _invoke(self, user_id: str, tool_parameters: dict[str, Any]) -> ToolInvokeMessage:
        app_id = self.runtime.credentials.get('app_id')
        app_secret = self.runtime.credentials.get('app_secret')
        client = FeishuRequest(app_id, app_secret)

        receive_id_type = tool_parameters.get('receive_id_type')
        receive_id = tool_parameters.get('receive_id')
        msg_type = tool_parameters.get('msg_type')
        content = tool_parameters.get('content')

        res = client.send_bot_message(receive_id_type, receive_id, msg_type, content)
        return self.create_json_message(res)
