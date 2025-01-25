from typing import Any

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool
from core.tools.utils.lark_api_utils import LarkRequest


class ReadColsTool(BuiltinTool):
    def _invoke(self, user_id: str, tool_parameters: dict[str, Any]) -> ToolInvokeMessage:
        app_id = self.runtime.credentials.get("app_id")
        app_secret = self.runtime.credentials.get("app_secret")
        client = LarkRequest(app_id, app_secret)

        spreadsheet_token = tool_parameters.get("spreadsheet_token")
        sheet_id = tool_parameters.get("sheet_id")
        sheet_name = tool_parameters.get("sheet_name")
        start_col = tool_parameters.get("start_col")
        num_cols = tool_parameters.get("num_cols")
        user_id_type = tool_parameters.get("user_id_type", "open_id")

        res = client.read_cols(spreadsheet_token, sheet_id, sheet_name, start_col, num_cols, user_id_type)

        return self.create_json_message(res)
