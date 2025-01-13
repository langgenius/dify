from typing import Any

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool
from core.tools.utils.lark_api_utils import LarkRequest


class SendWebhookMessageTool(BuiltinTool):
    def _invoke(self, user_id: str, tool_parameters: dict[str, Any]) -> ToolInvokeMessage:
        app_id = self.runtime.credentials.get("app_id")
        app_secret = self.runtime.credentials.get("app_secret")
        client = LarkRequest(app_id, app_secret)

        webhook = tool_parameters.get("webhook")
        msg_type = tool_parameters.get("msg_type")
        content = tool_parameters.get("content")

        res = client.send_webhook_message(webhook, msg_type, content)
        return self.create_json_message(res)
