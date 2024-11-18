from typing import Any

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool
from core.tools.utils.lark_api_utils import LarkRequest


class SearchRecordsTool(BuiltinTool):
    def _invoke(self, user_id: str, tool_parameters: dict[str, Any]) -> ToolInvokeMessage:
        app_id = self.runtime.credentials.get("app_id")
        app_secret = self.runtime.credentials.get("app_secret")
        client = LarkRequest(app_id, app_secret)

        app_token = tool_parameters.get("app_token")
        table_id = tool_parameters.get("table_id")
        table_name = tool_parameters.get("table_name")
        view_id = tool_parameters.get("view_id")
        field_names = tool_parameters.get("field_names")
        sort = tool_parameters.get("sort")
        filters = tool_parameters.get("filter")
        page_token = tool_parameters.get("page_token")
        automatic_fields = tool_parameters.get("automatic_fields", False)
        user_id_type = tool_parameters.get("user_id_type", "open_id")
        page_size = tool_parameters.get("page_size", 20)

        res = client.search_record(
            app_token,
            table_id,
            table_name,
            view_id,
            field_names,
            sort,
            filters,
            page_token,
            automatic_fields,
            user_id_type,
            page_size,
        )
        return self.create_json_message(res)
