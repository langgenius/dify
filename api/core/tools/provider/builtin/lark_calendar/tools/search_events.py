from typing import Any

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool
from core.tools.utils.lark_api_utils import LarkRequest


class SearchEventsTool(BuiltinTool):
    def _invoke(self, user_id: str, tool_parameters: dict[str, Any]) -> ToolInvokeMessage:
        app_id = self.runtime.credentials.get("app_id")
        app_secret = self.runtime.credentials.get("app_secret")
        client = LarkRequest(app_id, app_secret)

        query = tool_parameters.get("query")
        start_time = tool_parameters.get("start_time")
        end_time = tool_parameters.get("end_time")
        page_token = tool_parameters.get("page_token")
        user_id_type = tool_parameters.get("user_id_type", "open_id")
        page_size = tool_parameters.get("page_size", 20)

        res = client.search_events(query, start_time, end_time, page_token, user_id_type, page_size)

        return self.create_json_message(res)
