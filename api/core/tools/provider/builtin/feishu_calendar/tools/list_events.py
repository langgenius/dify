from typing import Any

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool
from core.tools.utils.feishu_api_utils import FeishuRequest


class ListEventsTool(BuiltinTool):
    def _invoke(self, user_id: str, tool_parameters: dict[str, Any]) -> ToolInvokeMessage:
        app_id = self.runtime.credentials.get("app_id")
        app_secret = self.runtime.credentials.get("app_secret")
        client = FeishuRequest(app_id, app_secret)

        start_time = tool_parameters.get("start_time")
        end_time = tool_parameters.get("end_time")
        page_token = tool_parameters.get("page_token")
        page_size = tool_parameters.get("page_size")

        res = client.list_events(start_time, end_time, page_token, page_size)

        return self.create_json_message(res)
