from typing import Any

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool
from core.tools.utils.feishu_api_utils import FeishuRequest


class AddEventAttendeesTool(BuiltinTool):
    def _invoke(self, user_id: str, tool_parameters: dict[str, Any]) -> ToolInvokeMessage:
        if not self.runtime or not self.runtime.credentials:
            raise ValueError("Runtime is not set")
        app_id = self.runtime.credentials.get("app_id")
        app_secret = self.runtime.credentials.get("app_secret")
        if not app_id or not app_secret:
            raise ValueError("app_id and app_secret are required")
        client = FeishuRequest(app_id, app_secret)

        event_id = tool_parameters.get("event_id", "")
        attendee_phone_or_email = tool_parameters.get("attendee_phone_or_email", "")
        need_notification = tool_parameters.get("need_notification", True)

        res = client.add_event_attendees(event_id, attendee_phone_or_email, need_notification)

        return self.create_json_message(res)
