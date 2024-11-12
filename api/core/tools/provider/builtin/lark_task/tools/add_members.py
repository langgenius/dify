from typing import Any

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool
from core.tools.utils.lark_api_utils import LarkRequest


class AddMembersTool(BuiltinTool):
    def _invoke(self, user_id: str, tool_parameters: dict[str, Any]) -> ToolInvokeMessage:
        app_id = self.runtime.credentials.get("app_id")
        app_secret = self.runtime.credentials.get("app_secret")
        client = LarkRequest(app_id, app_secret)

        task_guid = tool_parameters.get("task_guid")
        member_phone_or_email = tool_parameters.get("member_phone_or_email")
        member_role = tool_parameters.get("member_role", "follower")

        res = client.add_members(task_guid, member_phone_or_email, member_role)

        return self.create_json_message(res)
