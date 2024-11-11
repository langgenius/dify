from typing import Any

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool
from core.tools.utils.lark_api_utils import LarkRequest


class DeleteTablesTool(BuiltinTool):
    def _invoke(self, user_id: str, tool_parameters: dict[str, Any]) -> ToolInvokeMessage:
        app_id = self.runtime.credentials.get("app_id")
        app_secret = self.runtime.credentials.get("app_secret")
        client = LarkRequest(app_id, app_secret)

        app_token = tool_parameters.get("app_token")
        table_ids = tool_parameters.get("table_ids")
        table_names = tool_parameters.get("table_names")

        res = client.delete_tables(app_token, table_ids, table_names)
        return self.create_json_message(res)
